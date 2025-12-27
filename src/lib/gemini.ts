import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { logger } from "./logger";

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

let genAI: GoogleGenerativeAI | null = null;

function getGenAI() {
    if (!genAI) {
        if (!API_KEY) throw new Error("VITE_GEMINI_API_KEY is not defined in your environment variables (.env file).");
        genAI = new GoogleGenerativeAI(API_KEY);
    }
    return genAI;
}

const resultSchema = {
    type: SchemaType.OBJECT,
    properties: {
        score: {
            type: SchemaType.NUMBER,
            description: "Aesthetic score from 1.0 to 10.0",
            nullable: false,
        },
        reason: {
            type: SchemaType.STRING,
            description: "Concise reason for the score (max 15 words). Focus on composition, lighting, and sharpness.",
            nullable: false,
        },
    },
    required: ["score", "reason"],
};

const batchSchema = {
    description: "A list of aesthetic scores and reasons for multiple photos",
    type: SchemaType.OBJECT,
    properties: {
        results: {
            type: SchemaType.ARRAY,
            items: resultSchema,
            description: "Scores and reasons for each photo in the provided order"
        }
    },
    required: ["results"],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;


const MODELS = [
    "gemini-3-flash-preview", // User requested newest model
    "gemini-2.0-flash",     // Stable fast model
    "gemini-2.5-flash",     // Newer fast model
    "gemini-2.0-flash-exp", // Experimental
    "gemini-2.5-pro",       // High quality fallback
];

async function tryGenerate(modelName: string, images: { data: string, mimeType: string }[]) {
    const model = getGenAI().getGenerativeModel({
        model: modelName,
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: batchSchema,
        },
    });

    const promptMessages = [
        `Analyze the aesthetic quality of these ${images.length} photos for a professional photographer. 
         Return a JSON object with a "results" array containing the score and reason for each photo in the sequence provided. 
         Strictly follow the JSON schema.`,
        ...images.map(img => ({ inlineData: img }))
    ];

    logger.info(`Sending request to ${modelName} with ${images.length} images...`);
    const start = Date.now();
    const result = await model.generateContent(promptMessages);
    logger.info(`Received response from ${modelName} in ${Date.now() - start}ms`);
    return result;
}

export async function analyzePhotosBatch(blobs: Blob[]): Promise<{ score: number; reason: string }[]> {
    return Promise.race([
        analyzeInternalBatch(blobs),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Global analysis timeout (60s)")), 60000))
    ]);
}

async function analyzeInternalBatch(blobs: Blob[]): Promise<{ score: number; reason: string }[]> {
    if (!API_KEY) throw new Error("API Key not found");

    const images = await Promise.all(blobs.map(async blob => ({
        data: await blobToBase64(blob),
        mimeType: "image/jpeg"
    })));

    let lastError;

    for (const modelName of MODELS) {
        try {
            logger.info(`Attempting analysis with model: ${modelName}`);
            const result = await tryGenerate(modelName, images);

            logger.info(`Raw response received. Extracting text...`);
            const text = result.response.text();
            logger.info(`Gemini Raw Output (First 200 chars): ${text.substring(0, 200)}...`);

            let parsed;
            try {
                parsed = JSON.parse(text);
                console.log("AI 原始响应对象:", parsed); // 核心调试：看看 AI 到底返回了什么结构
            } catch (e) {
                logger.error(`JSON Parse Error: ${e}`);
                throw new Error(`Invalid JSON response: ${text.substring(0, 100)}...`);
            }

            if (!parsed.results || parsed.results.length !== blobs.length) {
                logger.error(`Invalid structure: results=${parsed?.results?.length}, expected=${blobs.length}`);
                throw new Error("Invalid batch response length");
            }
            return parsed.results;
        } catch (err: unknown) {
            const error = err instanceof Error ? err : new Error(String(err));
            lastError = error;

            // Check for Rate Limit (429) - Retry logic could be added here, 
            // but for now we fallback to next model or wait.
            // If it's a 429, we should probably wait a bit longer before trying next model.
            if (error.message.includes("429") || error.message.includes("Too Many Requests")) {
                logger.warn(`Rate limit hit on ${modelName}, waiting 2s...`);
                await new Promise(r => setTimeout(r, 2000));
            } else {
                logger.warn(`Model ${modelName} failed: ${error.message}`);
                // Use a smaller delay for other errors
                await new Promise(r => setTimeout(r, 500));
            }
            continue;
        }
    }

    throw new Error(`AI Batch Analysis Failed (All Models): ${lastError?.message || "Unknown"}`);
}


function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const dataUrl = reader.result as string;
            const base64 = dataUrl.split(',')[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

export async function testGeminiConnection(): Promise<string> {
    try {
        if (!API_KEY) throw new Error("API Key is missing");

        // Step 1: Try to list models to see what we have access to
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(`ListModels failed: ${data.error?.message || response.statusText}`);
        }

        const models = (data.models || []).map((m: any) => m.name.replace('models/', ''));
        logger.info("Available Models:", models);

        // Step 2: Check if our target models exist
        const hasFlash3 = models.includes('gemini-3-flash-preview');
        const hasFlash2 = models.includes('gemini-2.0-flash');
        const hasFlash20Exp = models.includes('gemini-2.0-flash-exp');
        const hasFlash25 = models.includes('gemini-2.5-flash');

        if (!hasFlash3 && !hasFlash2 && !hasFlash25 && !hasFlash20Exp) {
            return `Connected, but missing expected models. Available: ${models.slice(0, 5).join(', ')}...`;
        }

        // Step 3: Try a real generation with an existing model
        const targetModel = hasFlash3 ? 'gemini-3-flash-preview' : (hasFlash2 ? 'gemini-2.0-flash' : (hasFlash25 ? 'gemini-2.5-flash' : models[0]));
        const model = getGenAI().getGenerativeModel({ model: targetModel });
        const result = await model.generateContent("Hello, reply 'Yes'.");

        return `Success! (Using ${targetModel}). Response: ${result.response.text()}`;

    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error("Gemini Connection Test Failed", msg);
        throw new Error(msg);
    }
}
