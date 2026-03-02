import { qwenAnalyzeImage, qwenEditImage } from "./qwen";
import { analyzePhotosBatch } from "./local-scorer";
import { logger } from "./logger";
import { toast } from "sonner";

// 1. 人像分析
export async function analyzePortraitForGen(originalBlob: Blob): Promise<{ description: string, suggestions: string }> {
    const prompt = `分析这张人像照片。返回严格 JSON（无 markdown）:
{
  "description": "对主体和光照的简短描述（最多20字）",
  "suggestions": "3条具体的艺术建议，提升至高端杂志品质。关注光照、肤色质感和清晰度。"
}`;

    const result = await qwenAnalyzeImage(originalBlob, prompt, true);
    const cleaned = result.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleaned);
}

// 2. 杰作生成
export async function generatePortraitMasterpiece(
    originalBlob: Blob,
    analysis: { description: string, suggestions: string }
): Promise<Blob> {
    const finalPrompt = `
    编辑这张图片，创建一张高端摄影杰作。
    
    关键指令：保持身份特征。
    - 不要改变面部结构、骨骼形状或五官特征。
    - 不要将独特特征"美化"为千篇一律的样子。
    - 保持皮肤纹理真实（毛孔可见），严禁塑料/光滑皮肤。
    
    增强任务：
    1. 提升光照质量（电影感但自然）。
    2. 修复噪点和模糊（恢复眼睛和头发的锐度）。
    3. 色彩调整至专业工作室标准。
    4. 执行具体修复: ${analysis.suggestions}。

    背景信息: ${analysis.description}。
    
    输出写实风格的高品质照片。
    `;

    return await qwenEditImage(originalBlob, finalPrompt);
}

// 人像评审（专业模式迭代精炼）
async function evaluatePortrait(blob: Blob): Promise<{ critique: string, fixPrompt: string }> {
    const prompt = `作为高端美妆修图师。评审这张图片。
关注发现"AI痕迹"：塑料皮肤、死鱼眼等问题。
返回严格 JSON（无 markdown）:
{ "critique": "对皮肤纹理、光照和眼睛的评审", "fixPrompt": "修复这些缺陷的指令，严格保持身份特征" }`;

    const result = await qwenAnalyzeImage(blob, prompt, true);
    const cleaned = result.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleaned);
}

// 人像精炼（专业模式）
async function refinePortrait(blob: Blob, instructions: string): Promise<Blob> {
    const prompt = `
    根据反馈精炼这张人像照片。
    
    需要修复的反馈: ${instructions}
    
    约束:
    - 严格保持身份特征。不要改变面部形状。
    - 仅专注于纹理和光照调整。
    - 输出写实风格高品质照片。
    `;
    return await qwenEditImage(blob, prompt);
}

// 3. 工作流管理
export async function runPortraitWorkflow(
    analysisBlob: Blob,
    generationBlob: Blob,
    mode: 'instant' | 'iterative',
    toastId: string | number
): Promise<{ blob: Blob, score: number, reason: string }> {
    logger.info(`🚀 人像模式: ${mode.toUpperCase()}`);

    // === 阶段 1: 基础增强 ===
    toast.loading(mode === 'instant' ? "步骤 1: 快速增强中..." : "第 1 轮: 构建高保真底图...", { id: toastId });

    const analysisResult = await analyzePortraitForGen(analysisBlob);
    let currentBlob = await generatePortraitMasterpiece(generationBlob, analysisResult);
    let currentReason = `[基础] ${analysisResult.suggestions}`;

    // === 阶段 2: 迭代精炼（仅专业模式） ===
    if (mode === 'iterative') {
        const MAX_LOOPS = 2;

        for (let i = 1; i <= MAX_LOOPS; i++) {
            toast.loading(`第 ${i + 1} 轮: AI 审查纹理和光照...`, { id: toastId });

            // 1. 评审
            const critique = await evaluatePortrait(currentBlob);
            logger.info(`[人像第 ${i} 轮] 评审: ${critique.critique}`);

            // 2. 修复
            toast.loading(`第 ${i + 1} 轮: 修复中: ${critique.fixPrompt.slice(0, 15)}...`, { id: toastId });
            try {
                currentBlob = await refinePortrait(currentBlob, critique.fixPrompt);
                currentReason = `[专业精炼] ${critique.critique}`;
            } catch (e) {
                logger.error("人像迭代失败", e);
                break; // 失败时保留上一轮的好结果
            }
        }
    }

    // 步骤 4: 评分
    const finalRes = await analyzePhotosBatch([{ id: 'final', blob: currentBlob }], 'local-fast');
    return { blob: currentBlob, score: finalRes[0].score, reason: currentReason };
}
