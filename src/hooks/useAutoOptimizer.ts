import { useState } from 'react';
import { db, PhotoMetadata } from '@/lib/db';
import {
    analyzePhotosBatch,
    detectImageContent,
    extractSubjectWithGemini,
    removeSubjectFromImage,
    optimizeBackground,
    mergeAndHarmonize,
    analyzeLightingCondition,
    optimizeLandscape,
    evaluateLandscape // 新增
} from '@/lib/gemini';
import { logger } from '@/lib/logger';
import { toast } from 'sonner';

export function useAutoOptimizer() {
    const [isOptimizing, setIsOptimizing] = useState(false);

    const startOptimization = async (photo: PhotoMetadata) => {
        if (isOptimizing) return;
        setIsOptimizing(true);
        const toastId = toast.loading("AI 极简精修中...");

        try {
            // 0. 准备数据
            let currentBlob = photo.analysisBlob || photo.previewBlob;
            if (!currentBlob && photo.file) currentBlob = new Blob([photo.file], { type: photo.file.type });
            if (!currentBlob) throw new Error("无法获取图片数据");

            // 备份原图
            if (!photo.originalBlob) {
                await db.photos.update(photo.id, { originalBlob: currentBlob });
            } else {
                currentBlob = photo.originalBlob;
            }

            // Step 0: 侦测光影 DNA
            toast.loading("Step 0: 侦测光影 DNA...", { id: toastId });
            const lightingInfo = await analyzeLightingCondition(currentBlob);
            logger.info(`光影分析: ${lightingInfo}`);

            // 1. 判断是否是人像
            toast.loading("Step 1: 分析画面内容...", { id: toastId });
            const contentInfo = await detectImageContent(currentBlob);

            let finalResultBlob = currentBlob;
            let currentReason = "Optimization complete";
            let currentScore = 0;

            if (contentInfo.hasLivingBeings && contentInfo.subjectType === 'person') {
                logger.info("🚀 人像模式 (极简流程)");

                // 2. 提出人像 (Layer A)
                toast.loading("Step 2: 提取人像...", { id: toastId });
                const personLayer = await extractSubjectWithGemini(currentBlob);

                // 3. 生成无人背景 (Layer B)
                toast.loading("Step 3: 移除主体...", { id: toastId });
                const cleanBackground = await removeSubjectFromImage(currentBlob);

                // 4. 优化背景 (Layer C) - 传入光影信息
                toast.loading("Step 4: 匹配环境光...", { id: toastId });
                const optimizedBackground = await optimizeBackground(cleanBackground, lightingInfo);

                // 5. 融合 (Merge) - 传入光影信息
                toast.loading("Step 5: 影楼级合成...", { id: toastId });
                finalResultBlob = await mergeAndHarmonize(
                    currentBlob,        // 原图 (保真)
                    personLayer,        // 形状
                    optimizedBackground, // 氛围
                    lightingInfo        // 光影上下文
                );

                // 评分
                const finalRes = await analyzePhotosBatch([{ id: 'final', blob: finalResultBlob }]);
                currentScore = finalRes[0].score;
                currentReason = "Enhanced portrait with preserved identity.";

            } else {
                // --- 风景模式：智能迭代循环 (Feedback Loop) ---
                logger.info("🏞️ 风景模式 (智能迭代版)");

                let loopBlob = currentBlob;
                let loopScore = 0;
                let loopReason = "Initial Capture";
                let iteration = 0;
                const MAX_LOOPS = 3;    // 最多跑3轮
                const TARGET_SCORE_LANDSCAPE = 8.0; // 目标分

                // 循环开始
                while (iteration < MAX_LOOPS) {
                    iteration++;
                    toast.loading(`Round ${iteration}: AI 正在评审 & 思考...`, { id: toastId });

                    // 1. 评分 & 获取修改意见 (Flash)
                    const evalResult = await evaluateLandscape(loopBlob);
                    loopScore = evalResult.score;
                    loopReason = evalResult.critique;

                    logger.info(`[Loop ${iteration}] Score: ${loopScore}, Fix: ${evalResult.improvementPrompt}`);

                    // 达标检测：如果分数够了，或者已经在最后一轮了，就跳出
                    if (loopScore >= TARGET_SCORE_LANDSCAPE) {
                        toast.success(`达标! 分数: ${loopScore}`, { id: toastId });
                        break;
                    }
                    if (iteration === MAX_LOOPS) {
                        toast("已达到最大优化次数", { id: toastId });
                        break;
                    }

                    // 2. 执行精修 (Image Pro)
                    toast.loading(`Round ${iteration}: 正在执行: ${evalResult.critique.slice(0, 20)}...`, { id: toastId });
                    try {
                        loopBlob = await optimizeLandscape(loopBlob, evalResult.improvementPrompt);
                    } catch (e) {
                        logger.error("生成失败，保留上一轮结果", e);
                        break; // 如果生成挂了，就用上一次的好图
                    }
                }

                // 循环结束，赋值给最终结果
                finalResultBlob = loopBlob;
                currentScore = loopScore;
                currentReason = `[Loop x${iteration}] ${loopReason}`;
            }

            // 保存
            await db.photos.update(photo.id, {
                analysisBlob: finalResultBlob,
                previewBlob: finalResultBlob,
                score: currentScore,
                // 如果之前没存过原分，且当前有分，则备份当前分；否则保持原样
                originalScore: photo.originalScore ?? photo.score,
                reason: currentReason,
                status: 'scored',
                updatedAt: Date.now()
            });

            toast.success(`精修完成: ${currentScore.toFixed(1)}`, { id: toastId });
            window.dispatchEvent(new CustomEvent('pipeline-wakeup'));

        } catch (error) {
            console.error(error);
            toast.error("处理失败: " + (error instanceof Error ? error.message : "未知错误"), { id: toastId });
        } finally {
            setIsOptimizing(false);
        }
    };

    return { startOptimization, isOptimizing };
}
