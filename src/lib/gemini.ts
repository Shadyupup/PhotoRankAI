import { GoogleGenerativeAI, SchemaType, Part } from "@google/generative-ai";
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
    "gemini-3-flash-preview",
    "gemini-2.0-flash",
    "gemini-1.5-pro",
];

async function tryGenerate(modelName: string, items: { id: string, data: string, mimeType: string }[], signal?: AbortSignal) {
    if (signal?.aborted) throw new Error("Aborted before generation");

    const model = getGenAI().getGenerativeModel({
        model: modelName,
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: batchSchema,
        },
    });

    const promptMessages = [
        `Analyze the aesthetic quality of these ${items.length} images.
         If an image is a BACKGROUND (no subject), rate its composition, lighting, and texture as a standalone landscape/scene.
         The photos correspond to the following IDs in order: ${JSON.stringify(items.map(i => i.id))}.
         Return JSON with "results" array.`,
        ...items.map(item => ({ inlineData: { data: item.data, mimeType: item.mimeType } }))
    ];

    logger.info(`Sending request to ${modelName} with ${items.length} images...`);

    if (signal?.aborted) throw new Error("Aborted");

    const start = Date.now();

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

    const validItems = items.filter(i => i.blob.size > 0);
    if (validItems.length === 0) throw new Error("No valid image data to analyze");

    const images = await Promise.all(validItems.map(async item => {
        const b64 = await blobToBase64(item.blob);
        if (!b64) throw new Error(`Base64 conversion failed for ${item.id}`);
        return {
            id: item.id,
            data: b64,
            mimeType: item.blob.type || "image/jpeg"
        };
    }));

    let lastError;

    for (const modelName of MODELS) {
        if (signal?.aborted) throw new Error("Aborted");
        try {
            const result = await tryGenerate(modelName, images, signal);
            const text = result.response.text();

            let parsed;
            try {
                parsed = JSON.parse(text);
            } catch { // Ignore parse error, handle below
                throw new Error(`Invalid JSON response`);
            }

            if (!parsed.results || !Array.isArray(parsed.results)) {
                throw new Error("Invalid batch response structure");
            }

            return parsed.results;
        } catch (err: unknown) {
            const error = err instanceof Error ? err : new Error(String(err));
            lastError = error;
            await new Promise(r => setTimeout(r, 500));
            continue;
        }
    }
    throw new Error(`AI Batch Analysis Failed: ${lastError?.message || "Unknown"}`);
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
        const reader = new FileReader();
        reader.onloadend = () => {
            const dataUrl = reader.result as string;
            // Handle both with and without prefix for safety, though split(',')[1] is standard
            resolve(dataUrl.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}



// --- 核心修改：支持 configOverrides ---
async function generateImageInternal(
    modelName: string,
    inputs: (string | Blob)[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    configOverrides?: any
): Promise<Blob> {
    // Fix: Filter out thinkingConfig for image models that don't support it (like gemini-3-pro-image-preview)
    // The API returns 400 Bad Request if thinkingLevel is passed to an unsupported model.
    const isImageModel = modelName.includes('image');
    const finalConfig = { ...configOverrides };

    if (isImageModel && finalConfig.thinkingConfig) {
        logger.warn(`[Nano Banana] ⚠️ Thinking Mode disabled for ${modelName} (not supported by API).`);
        delete finalConfig.thinkingConfig;
    } else if (configOverrides?.thinkingConfig) {
        logger.info(`[Nano Banana] 🧠 Thinking Mode Enabled: ${configOverrides.thinkingConfig.thinkingLevel}`);
    } else {
        logger.info(`[Nano Banana] Calling ${modelName}...`);
    }

    const model = getGenAI().getGenerativeModel({
        model: modelName,
        generationConfig: finalConfig
    });

    try {
        const promptParts: Part[] = [];
        for (const input of inputs) {
            if (typeof input === 'string') {
                promptParts.push({ text: input });
            } else {
                const b64 = await blobToBase64(input);
                promptParts.push({
                    inlineData: {
                        mimeType: input.type || "image/jpeg",
                        data: b64
                    }
                });
            }
        }

        const result = await model.generateContent(promptParts);
        const response = await result.response;
        const imagePart = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);

        if (!imagePart || !imagePart.inlineData) {
            throw new Error(`Model ${modelName} did not return an image.`);
        }

        return base64ToBlob(imagePart.inlineData.data, imagePart.inlineData.mimeType || "image/jpeg");
    } catch (error) {
        logger.error(`[${modelName}] Generation failed`, error);
        throw error;
    }
}

// === 新增：背景评价结构 ===
const critiqueSchema = {
    type: SchemaType.OBJECT,
    properties: {
        critique: {
            type: SchemaType.STRING,
            description: "Critique the image's lighting, composition, and clutter. Be harsh like a pro photographer.",
            nullable: false,
        },
        fixPrompt: {
            type: SchemaType.STRING,
            description: "A generative AI prompt to FIX these issues. E.g., 'Add warm Christmas lights, remove the messy table, brighten the room'.",
            nullable: false,
        },
    },
    required: ["critique", "fixPrompt"],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

/**
 * 步骤 4.1: 让 AI 思考背景有什么问题 (对应截图里的 "评价一下...有 feedback")
 */
export async function generateBackgroundFixPrompt(bgBlob: Blob): Promise<{ critique: string, fixPrompt: string }> {
    const model = getGenAI().getGenerativeModel({
        model: "gemini-2.0-flash", // 使用 Flash 进行快速文本推理
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: critiqueSchema
        }
    });

    const b64 = await blobToBase64(bgBlob);
    const prompt = `
    Act as a professional interior photographer. 
    Analyze this background image (which has no subject currently).
    1. Identify issues: Lighting (too dark?), Clutter (messy items?), Composition (unbalanced?).
    2. Provide a specific prompt to transform this into a "Masterpiece" background while keeping the general room structure.
    
    Target Vibe: Warm, High-end, Cinematic, Clean.
    `;

    const result = await model.generateContent([
        prompt,
        { inlineData: { data: b64, mimeType: "image/jpeg" } }
    ]);

    return JSON.parse(result.response.text());
}

/**
 * 步骤 2: 提取人像 (Image A)
 */
// 统一使用的图像生成模型
const IMAGE_MODEL = "gemini-3-pro-image-preview";

/**
 * 步骤 0: 光影侦探
 * 分析原图的主体光照方向、硬度（直射/漫射）和色温
 */
export async function analyzeLightingCondition(originalBlob: Blob): Promise<string> {
    const model = getGenAI().getGenerativeModel({ model: "gemini-2.0-flash" }); // 用 Flash 够快
    const b64 = await blobToBase64(originalBlob);

    const prompt = `
    Analyze the lighting on the MAIN SUBJECT in this photo.
    Return a concise description (max 30 words) covering:
    1. Light Direction (e.g., from top-left, backlit, flat front light).
    2. Light Quality (e.g., harsh sunlight, soft window light, neon, dark moody).
    3. Color Temperature (e.g., warm golden hour, cool fluorescent, neutral).
    
    Format: "Subject is lit by [Direction] with [Quality] [Temperature] light."
    `;

    const result = await model.generateContent([prompt, { inlineData: { data: b64, mimeType: "image/jpeg" } }]);
    return result.response.text();
}

// ... (之前的 imports 和 常量保持不变)


/**
 * 步骤 A (Loop): 风景评委 (使用 Flash 极速推理)
 * 返回：分数 + 下一步的修改指令
 */
export async function evaluateLandscape(blob: Blob): Promise<{ score: number, critique: string, improvementPrompt: string }> {
    const critiqueSchema = {
        type: SchemaType.OBJECT,
        properties: {
            score: { type: SchemaType.NUMBER, description: "Aesthetic score 1-10" },
            critique: { type: SchemaType.STRING, description: "Short critique of flaws" },
            improvementPrompt: { type: SchemaType.STRING, description: "Specific instructions for the AI image generator to fix these flaws and reach 10/10." }
        },
        required: ["score", "critique", "improvementPrompt"],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const model = getGenAI().getGenerativeModel({
        model: "gemini-2.0-flash", // Flash 速度快，适合循环中多次调用
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: critiqueSchema
        }
    });

    const b64 = await blobToBase64(blob);
    const prompt = `
    Act as a strict National Geographic Photo Editor. 
    Analyze this landscape photo.
    1. Score it from 1.0 to 10.0 based on technical quality, lighting, and composition.
    2. Identify MAJOR flaws (e.g. hazy, flat lighting, noise, bad cropping).
    3. Write a precise "improvementPrompt" that I can send to an AI Image Enhancer to fix these specific issues.
    `;

    const result = await model.generateContent([prompt, { inlineData: { data: b64, mimeType: "image/jpeg" } }]);
    return JSON.parse(result.response.text());
}

/**
 * 步骤 B (Loop): 针对性精修 (使用 Image Pro)
 */
export async function optimizeLandscape(blob: Blob, instruction: string): Promise<Blob> {
    const prompt = `
    Act as a Professional Retoucher.
    Task: Improve this image based on the specific feedback.
    
    Feedback/Instruction: "${instruction}"
    
    Constraints:
    - Maintain photorealism.
    - Improve Dynamic Range (HDR style) and Clarity.
    - Keep the original scene structure, do not hallucinate new objects.
    - Target: High-End Fine Art Landscape.
    `;

    return await generateImageInternal(IMAGE_MODEL, [prompt, blob]);
}

/**
 * 步骤 2: 提取人像 (Image A)
 * 极简指令：只要人，背景全白/透明
 */
export async function extractSubjectWithGemini(originalBlob: Blob): Promise<Blob> {
    const prompt = `
    Task: Extract Subject.
    Action: Extract the main person from the image onto a pure WHITE background.
    Constraint: Keep the edges sharp and precise. Do not change the person's pose or lighting.
    `;

    // 这里不再传 thinking config，Image 模型通常不需要 text thinking
    return await generateImageInternal(IMAGE_MODEL, [prompt, originalBlob]);
}

/**
 * 步骤 3: 移除主体 (Image B)
 * 极简指令：把人擦掉，补全背景
 */
export async function removeSubjectFromImage(originalBlob: Blob): Promise<Blob> {
    const prompt = `
    Task: Remove Subject.
    Action: Remove the person from the image. Inpaint the missing area to match the background texture naturally.
    Constraint: Do not add new objects. Just fill the hole.
    `;

    return await generateImageInternal(IMAGE_MODEL, [prompt, originalBlob]);
}

/**
 * 步骤 4 (Pro): 基于光影分析的背景重绘
 */
export async function optimizeBackground(bgBlob: Blob, lightingContext: string): Promise<Blob> {
    // 增加景深控制 (Depth of Field) 和 光影匹配
    const prompt = `
    Task: Remaster this background to match a specific lighting context.
    
    Target Lighting Context: "${lightingContext}"
    
    Instructions:
    1. Upscale and denoise the background.
    2. **Crucial**: Adjust the background lighting to MATCH the Target Lighting Context strictly. 
       - If subject is backlit, the background needs to be brighter (the source of light).
       - If subject has side light, shadows in the room must fall in the same direction.
    3. **Depth of Field**: Apply a subtle "Bokeh" (f/2.8 lens blur) to distant objects to make the subject pop later.
    4. Style: High-end architectural photography, clean, cinematic.
    
    Constraint: Keep the original room structure/layout. Do not add random furniture.
    `;

    return await generateImageInternal(IMAGE_MODEL, [prompt, bgBlob]);
}

/**
 * 步骤 5 (Pro): 影楼级融合
 */
export async function mergeAndHarmonize(
    originalBlob: Blob,
    personBlob: Blob,
    backgroundBlob: Blob,
    lightingContext: string // 传入光影信息
): Promise<Blob> {

    const prompt = `
    Act as a Professional High-End Photo Retoucher using Photoshop.
    Task: Composite the person (Image B) into the environment (Image C).
    
    Inputs:
    - IMAGE A (Reference): The original photo. USE THIS FOR FACE IDENTITY.
    - IMAGE B (Layer 1): The Cutout Subject.
    - IMAGE C (Layer 2): The New Background.
    - Context: ${lightingContext}
    
    EXECUTION STEPS:
    1. **Global Harmonization**: Apply a Color Grading Lookup Table (LUT) to the subject so their skin tones match the ambient light of the Background (Image C).
    2. **Contact Shadows**: Generate realistic "Ambient Occlusion" shadows where the person touches the floor/chair to ground them. No floating people.
    3. **Light Wrap**: Add a very subtle "Light Wrap" effect on the edges of the subject where the background light is brightest.
    4. **Identity Protection Protocol**: 
       - DO NOT RE-GENERATE THE FACE. 
       - The pixels of the face MUST look exactly like Image A. 
       - Do not apply "beauty filters" that change bone structure.
    
    Output: A photorealistic photograph. No illustration style.
    `;

    return await generateImageInternal(
        IMAGE_MODEL,
        [originalBlob, personBlob, backgroundBlob, prompt]
        // 降低一点 creativity/temperature 可能有助于保真，但 Gemini API 对图像参数控制有限
        // 重点靠 Prompt 的 "Identity Protection Protocol"
    );
}

// 兼容旧接口
export async function editImageWithGemini(originalBlob: Blob, instruction: string): Promise<Blob> {
    return generateImageInternal("gemini-3-pro-image-preview", [`Edit: ${instruction}`, originalBlob]);
}

export interface ContentAnalysis {
    hasLivingBeings: boolean;
    subjectType: 'person' | 'animal' | 'landscape' | 'object';
    description: string;
}

export async function detectImageContent(blob: Blob): Promise<ContentAnalysis> {
    const model = getGenAI().getGenerativeModel({
        model: "gemini-3-flash-preview",
        generationConfig: { responseMimeType: "application/json" }
    });
    const prompt = `Analyze this image. Return JSON: { "hasLivingBeings": boolean, "subjectType": string, "description": string }`;
    try {
        const imageBase64 = await blobToBase64(blob);
        const result = await model.generateContent([prompt, { inlineData: { data: imageBase64, mimeType: "image/jpeg" } }]);
        return JSON.parse(result.response.text()) as ContentAnalysis;
    } catch {
        return { hasLivingBeings: false, subjectType: 'landscape', description: "Detection failed" };
    }
}

export async function testGeminiConnection(): Promise<string> {
    return "OK";
}
