import { SchemaType } from "@google/generative-ai";
import { getGenAI, blobToBase64, generateImageInternal, IMAGE_MODEL } from "./gemini";
import { analyzePhotosBatch } from "./local-scorer";
import { logger } from "./logger";
import { toast } from "sonner";

// 1. Mod Analysis
export async function analyzePortraitForGen(originalBlob: Blob): Promise<{ description: string, suggestions: string }> {
    const model = getGenAI().getGenerativeModel({
        model: "gemini-3.1-pro-preview",
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
                type: SchemaType.OBJECT,
                properties: {
                    description: {
                        type: SchemaType.STRING,
                        description: "A brief, factual description of the main subject and lighting (e.g. 'Close up of a man in a suit, soft window light'). Max 20 words."
                    },
                    suggestions: {
                        type: SchemaType.STRING,
                        description: "Specific, short artistic suggestions to improve this specific image to high-end magazine quality. (e.g. 'Brighten eyes, smooth skin slightly, warm up the lighting')."
                    }
                },
                required: ["description", "suggestions"]
            }
        }
    });

    const b64 = await blobToBase64(originalBlob);
    const instruction = `
    Analyze this portrait. 
    Provide a brief visual description and 3 specific suggestions to make it a masterpiece photo.
    Focus on lighting, skin texture, and clarity.
    `;

    const result = await model.generateContent([
        instruction,
        { inlineData: { data: b64, mimeType: "image/jpeg" } }
    ]);

    return JSON.parse(result.response.text());
}

// 2. Mod Generation
export async function generatePortraitMasterpiece(
    originalBlob: Blob,
    analysis: { description: string, suggestions: string }
): Promise<Blob> {
    // Key changes:
    // 1. Removed "Beautify" (causes facial distortion)
    // 2. Emphasize "High Fidelity"
    // 3. Emphasize "Enhance Texture" (not redraw)

    const finalPrompt = `
    Edit this image to create a high-end photography masterpiece.
    
    CRITICAL INSTRUCTION: PRESERVE IDENTITY.
    - Do NOT change facial structure, bone shape, or features. 
    - Do NOT "beautify" distinct features into generic ones.
    - Keep the skin texture realistic (pores visible), strictly NO plastic/smooth skin.
    
    Enhancement Tasks:
    1. Improve lighting quality (make it cinematic but natural).
    2. Fix noise and blurriness (restore sharpness to eyes and hair).
    3. Color grade to professional studio standards.
    4. Execute specific fixes: ${analysis.suggestions}.

    Context: ${analysis.description}.
    
    Output a photorealistic, 8k resolution photograph.
    `;

    return await generateImageInternal(
        "gemini-3.1-flash-image-preview",
        [finalPrompt, originalBlob],
        {
            // If API supports, can add safetySettings, but web SDK mainly relies on prompt
        }
    );
}

// Portrait critic (for Pro mode iterative refinement)
async function evaluatePortrait(blob: Blob): Promise<{ critique: string, fixPrompt: string }> {
    const model = getGenAI().getGenerativeModel({
        model: "gemini-3.1-pro-preview",
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
                type: SchemaType.OBJECT,
                properties: {
                    critique: { type: SchemaType.STRING, description: "Critique the skin texture, lighting, and eyes. Is it too smooth (plastic)? Is the lighting flat?" },
                    fixPrompt: { type: SchemaType.STRING, description: "Instructions to fix these flaws while strictly preserving identity." }
                },
                required: ["critique", "fixPrompt"]
            }
        }
    });

    const b64 = await blobToBase64(blob);
    const result = await model.generateContent([
        "Act as a high-end beauty retoucher. Critique this image. Focus on finding 'AI look' flaws like plastic skin or dead eyes.",
        { inlineData: { data: b64, mimeType: "image/jpeg" } }
    ]);
    return JSON.parse(result.response.text());
}

// Portrait refiner (for Pro mode, fine-tune based on previous round)
async function refinePortrait(blob: Blob, instructions: string): Promise<Blob> {
    const prompt = `
    Refine this portrait based on feedback.
    
    Feedback to Fix: ${instructions}
    
    Constraints:
    - STRICTLY PRESERVE IDENTITY. Do not change the face shape.
    - Focus on TEXTURE and LIGHTING adjustments only.
    - Output Photorealistic 8K.
    `;
    return await generateImageInternal(IMAGE_MODEL, [prompt, blob]);
}

// 3. Workflow Runner
export async function runPortraitWorkflow(
    analysisBlob: Blob,
    generationBlob: Blob,
    mode: 'instant' | 'iterative',
    toastId: string | number
): Promise<{ blob: Blob, score: number, reason: string }> {
    logger.info(`🚀 Portrait Mode: ${mode.toUpperCase()}`);

    // === Phase 1: Foundation (MasterLens Core) ===
    // Both Instant and Iterative start with MasterLens strategy

    toast.loading(mode === 'instant' ? "Step 1: MasterLens quick enhance..." : "Round 1: Building high-fidelity base...", { id: toastId });

    const analysisResult = await analyzePortraitForGen(analysisBlob);
    let currentBlob = await generatePortraitMasterpiece(generationBlob, analysisResult);
    let currentReason = `[Base] ${analysisResult.suggestions}`;

    // === Phase 2: Iterative refinement (Iterative only) ===
    if (mode === 'iterative') {
        const MAX_LOOPS = 2; // Portrait doesn't need many rounds, 2 more is enough

        for (let i = 1; i <= MAX_LOOPS; i++) {
            toast.loading(`Round ${i + 1}: AI reviewing texture and lighting...`, { id: toastId });

            // 1. Critique
            const critique = await evaluatePortrait(currentBlob);
            logger.info(`[Portrait Loop ${i}] Critique: ${critique.critique}`);

            // 2. Fix
            toast.loading(`Round ${i + 1}: Applying fix: ${critique.fixPrompt.slice(0, 15)}...`, { id: toastId });
            try {
                currentBlob = await refinePortrait(currentBlob, critique.fixPrompt);
                currentReason = `[Pro Refined] ${critique.critique}`;
            } catch (e) {
                logger.error("Portrait loop failed", e);
                break; // If failed, keep the previous round's good result
            }
        }
    }

    // Step 4: Scoring
    const finalRes = await analyzePhotosBatch([{ id: 'final', blob: currentBlob }], 'local-fast');
    return { blob: currentBlob, score: finalRes[0].score, reason: currentReason };
}
