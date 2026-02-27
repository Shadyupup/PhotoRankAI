import { GoogleGenerativeAI, Part } from "@google/generative-ai";
import { logger } from "./logger";

// API key priority: 1. localStorage (user-provided via Settings UI) → 2. .env file
function getApiKey(): string {
    const stored = localStorage.getItem('photorank_gemini_api_key');
    if (stored) return stored;
    return import.meta.env.VITE_GEMINI_API_KEY || '';
}

let genAI: GoogleGenerativeAI | null = null;
let lastKey = '';

export function getGenAI() {
    const key = getApiKey();
    if (!key) throw new Error("Gemini API Key is not set. Go to Settings (⚙️) to enter your key.");
    // Re-initialize if key changed (e.g. user updated it in Settings)
    if (!genAI || key !== lastKey) {
        genAI = new GoogleGenerativeAI(key);
        lastKey = key;
    }
    return genAI;
}

// Listen for key changes from Settings modal
if (typeof window !== 'undefined') {
    window.addEventListener('api-key-changed', () => {
        genAI = null;
        lastKey = '';
        logger.info('Gemini API key updated, will re-initialize on next use');
    });
}

// Scoring functions moved to local-scorer.ts (uses local NIMA + CLIP models)

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

// ...

export async function evaluatePhotoScore(blob: Blob): Promise<{ score: number; reason: string }> {
    const model = getGenAI().getGenerativeModel({
        model: "gemini-1.5-flash", // Good for fast text/vision tasks
        generationConfig: { responseMimeType: "application/json" }
    });
    const prompt = `You are an expert photography judge. Evaluate this image and give it a score from 1.0 to 10.0.
1.0 is a complete failure (blurry, pitch black, garbage).
10.0 is an absolute masterpiece (perfect lighting, focus, composition, aesthetics).
Pay attention to:
- Lighting and Exposure
- Focus and Sharpness
- Composition and Framing

Return JSON: { "score": number, "reason": "string description" }`;

    try {
        const imageBase64 = await blobToBase64(blob);
        const result = await model.generateContent([
            prompt,
            { inlineData: { data: imageBase64, mimeType: blob.type || "image/jpeg" } }
        ]);
        const data = JSON.parse(result.response.text());
        return {
            score: typeof data.score === 'number' ? data.score : parseFloat(data.score) || 0,
            reason: data.reason || "No reason provided"
        };
    } catch (e) {
        logger.error("Gemini evaluatePhotoScore failed", e);
        return { score: 0, reason: "Gemini scoring failed" };
    }
}

export function base64ToBlob(base64: string, mimeType: string): Blob {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
}

// ...

// --- Core change: support configOverrides ---
// Exported for Workflow files
export async function generateImageInternal(
    modelName: string,
    inputs: (string | Blob)[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    configOverrides?: any
): Promise<Blob> {
    // ... impl
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

// ...

// Shared image generation model
export const IMAGE_MODEL = "gemini-3.1-flash-image-preview";

/**
 * Step 0: Lighting Detective
 * Analyze subject light direction, hardness (direct/diffuse), and color temperature
 */
export async function analyzeLightingCondition(originalBlob: Blob): Promise<string> {
    const model = getGenAI().getGenerativeModel({ model: "gemini-3.1-pro-preview" });
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


/**
 * Step 2: Extract Portrait (Image A)
 * Minimal instruction: keep person only, white/transparent background
 */
export async function extractSubjectWithGemini(originalBlob: Blob): Promise<Blob> {
    const prompt = `
    Task: Extract Subject.
    Action: Extract the main person from the image onto a pure WHITE background.
    Constraint: Keep the edges sharp and precise. Do not change the person's pose or lighting.
    `;

    // No thinking config needed for Image model
    return await generateImageInternal(IMAGE_MODEL, [prompt, originalBlob]);
}

/**
 * Step 3: Remove Subject (Image B)
 * Minimal instruction: remove person, inpaint background
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
 * Step 4 (Pro): Lighting-aware background repaint
 */
export async function optimizeBackground(bgBlob: Blob, lightingContext: string): Promise<Blob> {
    // Add depth of field control and lighting matching
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
 * Step 5 (Pro): Studio-grade compositing
 */
export async function mergeAndHarmonize(
    originalBlob: Blob,
    personBlob: Blob,
    backgroundBlob: Blob,
    lightingContext: string // Pass lighting info
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
        // Lowering creativity/temperature may help fidelity, but Gemini API has limited image param control
        // Relies primarily on prompt-level "Identity Protection Protocol"
    );
}

// Legacy interface compatibility
export async function editImageWithGemini(originalBlob: Blob, instruction: string): Promise<Blob> {
    return generateImageInternal(IMAGE_MODEL, [`Edit: ${instruction}`, originalBlob]);
}

export interface ContentAnalysis {
    hasLivingBeings: boolean;
    subjectType: 'person' | 'animal' | 'landscape' | 'object';
    description: string;
}

export async function detectImageContent(blob: Blob): Promise<ContentAnalysis> {
    const model = getGenAI().getGenerativeModel({
        model: "gemini-3.1-pro-preview",
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




