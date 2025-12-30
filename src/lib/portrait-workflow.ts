import { SchemaType } from "@google/generative-ai";
import { getGenAI, blobToBase64, generateImageInternal, analyzePhotosBatch } from "./gemini";
import { logger } from "./logger";
import { toast } from "sonner";

// 1. Mod Analysis
export async function analyzePortraitForGen(originalBlob: Blob): Promise<{ description: string, suggestions: string }> {
    const model = getGenAI().getGenerativeModel({
        model: "gemini-3-flash-preview",
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
    // 【关键修改】：
    // 1. 去掉 "Beautify" (这词会导致整容)
    // 2. 强调 "High Fidelity" (高保真)
    // 3. 强调 "Enhance Texture" (增强质感而不是重绘)

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
        "gemini-3-pro-image-preview",
        [finalPrompt, originalBlob],
        {
            // 如果 API 支持，可以加 safetySettings，但在 web sdk 里主要靠 prompt
        }
    );
}

// 3. Workflow Runner
export async function runPortraitWorkflow(
    analysisBlob: Blob,   // <--- 接收低清图
    generationBlob: Blob, // <--- 接收高清图
    toastId: string | number
): Promise<{ blob: Blob, score: number, reason: string }> {
    logger.info("🚀 Portrait Mode (MasterLens Core)");

    // Step 2: Analysis (使用 analysisBlob，省流量省钱)
    toast.loading("Step 2: Analyzing Face & Light...", { id: toastId });

    // 这里传 analysisBlob
    const analysisResult = await analyzePortraitForGen(analysisBlob);

    logger.info(`Description: ${analysisResult.description}`);
    logger.info(`Suggestions: ${analysisResult.suggestions}`);

    // Step 3: Generation (必须使用 generationBlob，保人脸)
    toast.loading("Step 3: Mastering Portrait...", { id: toastId });
    let finalResultBlob: Blob;
    let currentReason = "";

    try {
        // 这里传 generationBlob
        finalResultBlob = await generatePortraitMasterpiece(generationBlob, analysisResult);
        currentReason = `[MasterLens Edit] ${analysisResult.suggestions}`;
    } catch (e) {
        logger.error("Portrait Generation Failed", e);
        throw new Error("AI Generation Service Busy");
    }

    // Step 4: Scoring (评分可以用生成后的图，大小无所谓，Gemini Vision 对分辨率不敏感)
    // 这里用 finalResultBlob 没问题
    const finalRes = await analyzePhotosBatch([{ id: 'final', blob: finalResultBlob }]); // This calls back to gemini.ts
    const currentScore = finalRes[0].score;

    return { blob: finalResultBlob, score: currentScore, reason: currentReason };
}
