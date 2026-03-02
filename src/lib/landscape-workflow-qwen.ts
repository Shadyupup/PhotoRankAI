import { qwenAnalyzeImage, qwenEditImage } from "./qwen";
import { analyzePhotosBatch } from "./local-scorer";
import { logger } from "./logger";
import { toast } from "sonner";

// 1. 风景评估
export async function evaluateLandscape(blob: Blob): Promise<{ score: number, critique: string, improvementPrompt: string }> {
    const prompt = `你是一位严格的国家地理杂志图片编辑。
分析这张风景照片。
1. 从 1.0 到 10.0 评分（技术质量、光照、构图）。
2. 指出主要缺陷（如：雾霾、光线平淡、噪点、裁剪不当）。
3. 写一个精确的改进指令，用于 AI 图像增强器修复这些具体问题。

返回严格 JSON，不要用 markdown:
{ "score": 7.5, "critique": "简短的缺陷说明", "improvementPrompt": "具体的改进指令" }`;

    const result = await qwenAnalyzeImage(blob, prompt, true);
    const cleaned = result.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleaned);
}

// 2. 风景优化
export async function optimizeLandscape(blob: Blob, instruction: string): Promise<Blob> {
    const prompt = `
    作为专业修图师。
    任务：根据具体反馈改进这张图片。
    
    反馈/指令："${instruction}"
    
    约束：
    - 保持照片写实感。
    - 提升动态范围（HDR风格）和清晰度。
    - 保持原始场景结构，不要臆造新物体。
    - 目标：高端艺术风景摄影。
    `;

    return await qwenEditImage(blob, prompt);
}

// 3. 工作流管理
export async function runLandscapeWorkflow(
    analysisBlob: Blob,
    generationBlob: Blob,
    mode: 'instant' | 'iterative',
    toastId: string | number
): Promise<{ blob: Blob, score: number, reason: string }> {
    logger.info(`🏞️ 风景模式: ${mode.toUpperCase()}`);

    let loopBlob = generationBlob;
    let loopScore = 0;
    let loopReason = "原始拍摄";
    let iteration = 0;

    // 控制：快速模式最多1轮，专业模式最多3轮
    const MAX_LOOPS = mode === 'instant' ? 1 : 3;
    const TARGET_SCORE_LANDSCAPE = 9.0;

    while (iteration < MAX_LOOPS) {
        iteration++;

        // UI toast
        if (mode === 'instant') {
            toast.loading("正在渲染国家地理级别画质...", { id: toastId });
        } else {
            toast.loading(`第 ${iteration}/${MAX_LOOPS} 轮：AI 审查与迭代优化...`, { id: toastId });
        }

        // 1. 评估
        const blobToEvaluate = (iteration === 1 && analysisBlob) ? analysisBlob : loopBlob;
        const evalResult = await evaluateLandscape(blobToEvaluate);

        loopScore = evalResult.score;
        loopReason = evalResult.critique;

        logger.info(`[第 ${iteration} 轮] 分数: ${loopScore}, 修复: ${evalResult.improvementPrompt}`);

        // 提前退出（仅专业模式）
        if (mode === 'iterative' && loopScore >= TARGET_SCORE_LANDSCAPE) {
            toast.success(`已达标！分数: ${loopScore}`, { id: toastId });
            break;
        }

        // 2. 优化
        toast.loading(`第 ${iteration} 轮：修复中: ${evalResult.critique.slice(0, 20)}...`, { id: toastId });
        try {
            loopBlob = await optimizeLandscape(loopBlob, evalResult.improvementPrompt);
        } catch (e) {
            logger.error("生成失败", e);
            break;
        }

        // 快速模式：一轮后退出
        if (mode === 'instant') break;

        // 专业模式：达到最大轮数
        if (iteration === MAX_LOOPS) {
            toast("已达最大迭代轮数", { id: toastId });
            break;
        }
    }

    // Final scoring via local scorer (normalized 0-100, consistent with portrait workflow)
    const finalRes = await analyzePhotosBatch([{ id: 'final', blob: loopBlob }], 'local-fast');
    return { blob: loopBlob, score: finalRes[0].score, reason: loopReason };
}
