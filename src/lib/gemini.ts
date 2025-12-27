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
        file_id: {
            type: SchemaType.STRING,
            description: "The unique ID of the photo as provided in the prompt",
            nullable: false,
        },
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
    required: ["file_id", "score", "reason"],
};

const batchSchema = {
    description: "A list of aesthetic scores and reasons for multiple photos",
    type: SchemaType.OBJECT,
    properties: {
        results: {
            type: SchemaType.ARRAY,
            items: resultSchema,
            description: "Scores and reasons for each photo, including their IDs"
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

async function tryGenerate(modelName: string, items: { id: string, data: string, mimeType: string }[], signal?: AbortSignal) {
    if (signal?.aborted) throw new Error("Aborted before generation");

    const model = getGenAI().getGenerativeModel({
        model: modelName,
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: batchSchema,
        },
        // Note: The SDK might not fully support AbortSignal in all environments yet, 
        // but checking it explicitly helps save resources if already cancelled.
    });

    const promptMessages = [
        `Analyze the aesthetic quality of these ${items.length} photos for a professional photographer. 
         The photos correspond to the following IDs in order: ${JSON.stringify(items.map(i => i.id))}.
         Return a JSON object with a "results" array containing the 'file_id', 'score', and 'reason' for each photo. 
         IMPORTANT: You must include the correct 'file_id' provided for each result.
         Strictly follow the JSON schema.`,
        ...items.map(item => ({ inlineData: { data: item.data, mimeType: item.mimeType } }))
    ];

    logger.info(`Sending request to ${modelName} with ${items.length} images...`);

    if (signal?.aborted) throw new Error("Aborted");

    const start = Date.now();

    // We can't cancel the HTTP request easily with this SDK version, 
    // but we can reject early if the signal fires during the await.
    const result = await Promise.race([
        model.generateContent(promptMessages),
        new Promise<never>((_, reject) => {
            if (signal) {
                signal.addEventListener("abort", () => reject(new Error("Request Aborted")));
            }
        })
    ]);

    logger.info(`Received response from ${modelName} in ${Date.now() - start}ms`);
    return result;
}

export async function analyzePhotosBatch(items: { id: string, blob: Blob }[], signal?: AbortSignal): Promise<{ file_id: string; score: number; reason: string }[]> {
    return Promise.race([
        analyzeInternalBatch(items, signal),
        new Promise<never>((_, reject) => {
            const timer = setTimeout(() => reject(new Error("Global analysis timeout (60s)")), 60000);
            if (signal) {
                signal.addEventListener("abort", () => {
                    clearTimeout(timer);
                    reject(new Error("Analysis Aborted"));
                });
            }
        })
    ]);
}

async function analyzeInternalBatch(items: { id: string, blob: Blob }[], signal?: AbortSignal): Promise<{ file_id: string; score: number; reason: string }[]> {
    if (!API_KEY) throw new Error("API Key not found");
    if (signal?.aborted) throw new Error("Aborted");

    const images = await Promise.all(items.map(async item => ({
        id: item.id,
        data: await blobToBase64(item.blob),
        mimeType: "image/jpeg"
    })));

    let lastError;

    for (const modelName of MODELS) {
        if (signal?.aborted) throw new Error("Aborted");

        try {
            logger.info(`Attempting analysis with model: ${modelName}`);
            const result = await tryGenerate(modelName, images, signal);

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

            if (!parsed.results || !Array.isArray(parsed.results)) {
                logger.error(`Invalid structure: results is missing or not an array`);
                throw new Error("Invalid batch response structure");
            }

            // Optional: Verify IDs exist? Or just leave it to the caller to match.
            // Let's at least check length roughly matches or is non-empty.
            if (parsed.results.length === 0 && items.length > 0) {
                throw new Error("AI returned empty results array");
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
