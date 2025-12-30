import { SchemaType } from "@google/generative-ai";
import { getGenAI, blobToBase64, generateImageInternal, IMAGE_MODEL } from "./gemini";
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
        model: "gemini-3-flash-preview",
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

// 3. Workflow Runner 【这里是修改重点！】
export async function runLandscapeWorkflow(
    analysisBlob: Blob,   // <--- 接收低清图 (用于第一轮快速分析)
    generationBlob: Blob, // <--- 接收高清图 (用于生成，这才是重点！)
    toastId: string | number
): Promise<{ blob: Blob, score: number, reason: string }> {
    logger.info("🏞️ Landscape Mode (Iterative Loop - High Res)");

    // 【关键】：初始化循环用的 Blob 为高清图！
    let loopBlob = generationBlob;

    let loopScore = 0;
    let loopReason = "Initial Capture";
    let iteration = 0;
    const MAX_LOOPS = 3;
    const TARGET_SCORE_LANDSCAPE = 8.0;

    while (iteration < MAX_LOOPS) {
        iteration++;
        toast.loading(`Round ${iteration}: AI Critic & Plan...`, { id: toastId });

        // 1. Evaluate (评分)
        // 技巧：第一轮为了快，可以用 analysisBlob (低清) 去评分。
        // 但从第二轮开始，因为图已经修过了，必须评测修过后的 loopBlob (虽然它很大，但必须评测它才能知道修得怎么样)。
        const blobToEvaluate = (iteration === 1 && analysisBlob) ? analysisBlob : loopBlob;

        const evalResult = await evaluateLandscape(blobToEvaluate);
        loopScore = evalResult.score;
        loopReason = evalResult.critique;

        logger.info(`[Loop ${iteration}] Score: ${loopScore}, Fix: ${evalResult.improvementPrompt}`);

        if (loopScore >= TARGET_SCORE_LANDSCAPE) {
            toast.success(`Target Met! Score: ${loopScore}`, { id: toastId });
            break;
        }
        if (iteration === MAX_LOOPS) {
            toast("Max loops reached", { id: toastId });
            break;
        }

        // 2. Optimize (精修)
        toast.loading(`Round ${iteration}: Fixing: ${evalResult.critique.slice(0, 20)}...`, { id: toastId });
        try {
            // 【关键】：这里传入的是 loopBlob (高清图)，所以生成出来的也会是高清图
            loopBlob = await optimizeLandscape(loopBlob, evalResult.improvementPrompt);
        } catch (e) {
            logger.error("Landscape generation failed", e);
            break;
        }
    }

    const currentReason = `[Loop x${iteration}] ${loopReason}`;

    return { blob: loopBlob, score: loopScore, reason: currentReason };
}
