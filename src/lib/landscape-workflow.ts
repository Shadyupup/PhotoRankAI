import { SchemaType } from "@google/generative-ai";
import { getGenAI, blobToBase64, generateImageInternal, IMAGE_MODEL } from "./gemini";
import { analyzePhotosBatch } from "./local-scorer";
import { logger } from "./logger";
import { toast } from "sonner";

// 1. Mod Analysis
export async function evaluateLandscape(blob: Blob): Promise<{ score: number, critique: string, improvementPrompt: string }> {
    const critiqueSchema = {
        type: SchemaType.OBJECT,
        properties: {
            score: { type: SchemaType.NUMBER, description: "Aesthetic score 1-10" },
            critique: { type: SchemaType.STRING, description: "Short critique of flaws" },
            improvementPrompt: { type: SchemaType.STRING, description: "Specific instructions for the AI image generator to fix these flaws and reach 10/10." }
        },
        required: ["score", "critique", "improvementPrompt"],
    };

    const model = getGenAI().getGenerativeModel({
        model: "gemini-3.1-pro-preview",
        generationConfig: {
            responseMimeType: "application/json",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            responseSchema: critiqueSchema as any
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

// 2. Mod Optimization
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

// 3. Workflow Runner
export async function runLandscapeWorkflow(
    analysisBlob: Blob,
    generationBlob: Blob,
    mode: 'instant' | 'iterative',
    toastId: string | number
): Promise<{ blob: Blob, score: number, reason: string }> {
    logger.info(`🏞️ Landscape Mode: ${mode.toUpperCase()}`);

    let loopBlob = generationBlob;
    let loopScore = 0;
    let loopReason = "Initial Capture";
    let iteration = 0;

    // Core control: if instant, max loops = 1
    const MAX_LOOPS = mode === 'instant' ? 1 : 3;
    const TARGET_SCORE_LANDSCAPE = 9.0; // Pro mode requires higher score

    while (iteration < MAX_LOOPS) {
        iteration++;

        // UI toast differentiation
        if (mode === 'instant') {
            toast.loading("Rendering single-pass National Geographic quality...", { id: toastId });
        } else {
            toast.loading(`Round ${iteration}/${MAX_LOOPS}: AI review and iteration...`, { id: toastId });
        }

        // 1. Evaluate
        const blobToEvaluate = (iteration === 1 && analysisBlob) ? analysisBlob : loopBlob;
        const evalResult = await evaluateLandscape(blobToEvaluate);

        loopScore = evalResult.score;
        loopReason = evalResult.critique;

        logger.info(`[Loop ${iteration}] Score: ${loopScore}, Fix: ${evalResult.improvementPrompt}`);

        // If score is sufficient, exit early (iterative only, instant must run once)
        if (mode === 'iterative' && loopScore >= TARGET_SCORE_LANDSCAPE) {
            toast.success(`Target met! Score: ${loopScore}`, { id: toastId });
            break;
        }

        // 2. Optimize
        // Key: passing highRes loopBlob so output is also high-res
        toast.loading(`Round ${iteration}: Fixing: ${evalResult.critique.slice(0, 20)}...`, { id: toastId });
        try {
            loopBlob = await optimizeLandscape(loopBlob, evalResult.improvementPrompt);
        } catch (e) {
            logger.error("Generation failed", e);
            break;
        }

        // Instant mode: break after one round
        if (mode === 'instant') break;

        // If iterative mode and max loops reached, but target not met
        if (iteration === MAX_LOOPS) {
            toast("Max loops reached", { id: toastId });
            break;
        }
    }

    // Final scoring via local scorer (normalized 0-100, consistent with portrait workflow)
    const finalRes = await analyzePhotosBatch([{ id: 'final', blob: loopBlob }], 'local-fast');
    return { blob: loopBlob, score: finalRes[0].score, reason: loopReason };
}
