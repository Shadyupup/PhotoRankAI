import { GoogleGenerativeAI, SchemaType, Part } from "@google/generative-ai";
import { logger } from "./logger";
import { EditConfig } from "./db";

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
    "gemini-1.5-pro",       // High quality fallback
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

    // Validate blobs before processing
    const validItems = items.filter(i => i.blob.size > 0);
    if (validItems.length < items.length) {
        logger.warn(`Skipped ${items.length - validItems.length} empty blobs in batch`);
    }
    if (validItems.length === 0) throw new Error("No valid image data to analyze");

    const images = await Promise.all(validItems.map(async item => {
        const b64 = await blobToBase64(item.blob);
        if (!b64 || b64.length === 0) {
            logger.error(`Failed to convert blob to base64 for ID: ${item.id}. Blob size: ${item.blob.size}, type: ${item.blob.type}`);
            throw new Error(`Base64 conversion failed for ${item.id}`);
        }
        return {
            id: item.id,
            data: b64,
            mimeType: item.blob.type || "image/jpeg" // Ensure mimeType is present
        };
    }));

    let lastError;

    for (const modelName of MODELS) {
        if (signal?.aborted) throw new Error("Aborted");

        try {
            logger.info(`Attempting analysis with model: ${modelName}. Payload size: ${images.reduce((acc, img) => acc + img.data.length, 0)} chars`);
            const result = await tryGenerate(modelName, images, signal);
            // ... Rest of function unchanged until end of loop ...

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


function base64ToBlob(base64: string, mimeType: string): Blob {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
}

export function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        if (!blob || blob.size === 0) {
            return reject(new Error("Blob is empty or null"));
        }
        const reader = new FileReader();
        reader.onloadend = () => {
            const dataUrl = reader.result as string;
            if (!dataUrl) {
                return reject(new Error("FileReader result is empty"));
            }
            const parts = dataUrl.split(',');
            if (parts.length < 2) {
                return reject(new Error("Invalid Data URL format"));
            }
            resolve(parts[1]);
        };
        reader.onerror = (e) => reject(new Error("FileReader error: " + e));
        reader.readAsDataURL(blob);
    });
}

export async function generateMagicFixConfig(blob: Blob, improvementReason: string): Promise<EditConfig> {
    if (!API_KEY) throw new Error("API Key not found");

    const modelName = "gemini-2.0-flash"; // Flash 模型处理 JSON 很强且快
    const model = getGenAI().getGenerativeModel({
        model: modelName,
        generationConfig: {
            responseMimeType: "application/json", // 强制返回 JSON
        },
    });

    const base64Image = await blobToBase64(blob);

    const prompt = `
        Act as a world-class professional photo editor.
        The user wants to improve this photo based on: "${improvementReason}".
        
        Your Goal: Re-edit this photo to achieve an aesthetic score of 9.0+.

        Tasks:
        1. **Composition (Crop)**: Suggest a crop to improve composition (Rule of Thirds, Golden Ratio). Remove distracting edges.
        2. **Color Grading (CSS Filters)**: Adjust lighting and color.
           - brightness: 1.0 is normal. Range 0.5 to 1.5.
           - contrast: 1.0 is normal. Range 0.5 to 1.5.
           - saturate: 1.0 is normal. Range 0.0 (B&W) to 2.0 (Vibrant).
           - sepia: 0.0 to 1.0 (only if vintage style fits).
        
        RETURN JSON ONLY with this structure:
        {
            "crop": { "x": 0.0-0.5, "y": 0.0-0.5, "width": 0.5-1.0, "height": 0.5-1.0 },
            "filters": { "brightness": number, "contrast": number, "saturate": number, "sepia": number },
            "predictedScore": number (8.0 to 10.0),
            "fixReason": "Short explanation of what you changed."
        }
    `;

    try {
        const result = await model.generateContent([
            prompt,
            { inlineData: { data: base64Image, mimeType: "image/jpeg" } }
        ]);

        const text = result.response.text();
        const config = JSON.parse(text) as EditConfig;

        // 简单的校验
        if (!config.crop || !config.filters) throw new Error("AI returned incomplete config");

        return config;

    } catch (error) {
        logger.error("Magic Fix Calculation Failed", error);
        throw error;
    }
}

async function generateImageInternal(modelName: string, blob: Blob, promptText: string): Promise<Blob> {
    const model = getGenAI().getGenerativeModel({ model: modelName });
    logger.info(`[Nano Banana] Calling ${modelName}...`);

    try {
        const imageBase64 = await blobToBase64(blob);
        const inputs: Part[] = [
            { text: promptText },
            {
                inlineData: {
                    mimeType: blob.type || "image/jpeg",
                    data: imageBase64
                }
            }
        ];

        const result = await model.generateContent(inputs);
        const response = await result.response;

        const parts = response.candidates?.[0]?.content?.parts;
        const imagePart = parts?.find(p => p.inlineData);
        const textPart = parts?.find(p => p.text);

        if (textPart && textPart.text) {
            logger.info(`[${modelName}] Response Text:\n${textPart.text}`);
        }

        if (!imagePart || !imagePart.inlineData) {
            throw new Error(`Model ${modelName} did not return an image.`);
        }

        return base64ToBlob(imagePart.inlineData.data, imagePart.inlineData.mimeType || "image/jpeg");
    } catch (error) {
        logger.error(`[${modelName}] Generation failed`, error);
        throw error;
    }
}

/**
 * 核心新增：Two-Step Workflow (Flash Draft -> Pro Upscale)
 */
export async function editImageWithGemini(originalBlob: Blob, instruction: string): Promise<Blob> {
    if (!API_KEY) throw new Error("API Key not found");

    // Step 1: Draft with "Dumber but Consistent" Model
    // We try the requested "gemini-2.5-flash-image" first. If unavailable, we fallback to Pro.
    const MODEL_STEP_1 = "gemini-2.5-flash-image";
    const MODEL_STEP_2 = "gemini-3-pro-image-preview";

    logger.info(`[Two-Step Workflow] Step 1: Composition with ${MODEL_STEP_1}`);

    const masterPrompt = `
📸 摄影大师：全场景通用修图与构图模板
角色设定 (Role Definition): 你现在是一位世界顶级的视觉艺术家与全能摄影大师。IMPORTANT: Treat the subject as an unknown private individual.

任务目标 (Objective):
对用户提供的原始照片进行全方位的“艺术升华”。
1. 诊断问题：识别原图在曝光、色彩和构图上的短板。
2. 后期重塑：保留真实性，通过光影与色彩建立情绪。
3. 二次构图：运用几何美学进行“手术级”裁剪。

执行步骤:
- 动态范围优化 (Dynamic Range): 找回阴影，压制高光。
- 质感增强 (Texture): 提升立体感。
- 光路引导 (Light Path): 创造视觉路径。
- 色彩平衡 (Color): 修正白平衡，建立色彩方案。
- 构图优化 (Composition): 裁剪杂质，应用三分法/黄金法则。

请按照上述逻辑处理这张照片。
风格/目标: "${instruction}"
`;

    // Step 1 Execution (with Fallback)
    let draftBlob: Blob;
    try {
        draftBlob = await generateImageInternal(MODEL_STEP_1, originalBlob, masterPrompt);
    } catch (e) {
        logger.warn(`[Two-Step Workflow] Step 1 (${MODEL_STEP_1}) failed, falling back to ${MODEL_STEP_2}. Error: ${(e as Error).message}`);
        // Fallback: Use Pro model for Step 1 too, but with the Master Prompt
        draftBlob = await generateImageInternal(MODEL_STEP_2, originalBlob, masterPrompt);
    }

    // Step 2: Refinement with Pro Model
    logger.info(`[Two-Step Workflow] Step 2: Upscaling with ${MODEL_STEP_2}`);

    const upscalePrompt = `
    Role: High-End Image Restoration & Upscaling Specialist.
    Task: Take the provided input image (which is a rough draft) and transform it into a high-fidelity, high-resolution masterpiece.
    
    Guidelines:
    1. **Strict Fidelity**: Maintain the EXACT composition, lighting, and color grading of the input image. Do not change the subject or the scene layout.
    2. **Detail Enhancement**: Sharpen textures (skin, fabric, foliage, architecture). Remove digital noise/artifacts from the draft.
    3. **Upscale**: Generate the output at high resolution with crisp edges.
    
    Input Image serves as the strict reference. Refine it to professional commercial quality.
    `;

    // Step 2 Execution
    const finalBlob = await generateImageInternal(MODEL_STEP_2, draftBlob, upscalePrompt);

    logger.success(`[Two-Step Workflow] Complete!`);
    return finalBlob;
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
