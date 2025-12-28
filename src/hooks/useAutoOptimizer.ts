import { useState } from 'react';
import { analyzePhotosBatch, editImageWithGemini } from '@/lib/gemini';
import { db, PhotoMetadata } from '@/lib/db';
import { logger } from '@/lib/logger';
import { toast } from 'sonner';

const TARGET_SCORE = 8.0;
const MAX_ITERATIONS = 3;

export function useAutoOptimizer() {
    const [isOptimizing, setIsOptimizing] = useState(false);

    const startOptimization = async (photo: PhotoMetadata) => {
        if (isOptimizing) return;
        setIsOptimizing(true);

        const toastId = toast.loading("启动 AI 自动化精修流水线...");

        try {
            // 1. 准备初始素材
            let currentBlob = photo.analysisBlob || photo.previewBlob;
            if (!currentBlob && photo.file) {
                currentBlob = new Blob([photo.file], { type: photo.file.type });
            }
            if (!currentBlob) throw new Error("无法获取原图数据");

            // --- 关键修复：备份原图 ---
            // 如果还没有备份过 originalBlob，说明这是第一次精修，把当前图存为原图
            let originalBlob = photo.originalBlob;
            if (!originalBlob) {
                originalBlob = currentBlob;
                logger.info("已创建原图备份 (Original Blob Saved)");
                // 立即写入 DB 以防中途失败
                await db.photos.update(photo.id, { originalBlob: currentBlob });
            }
            // ------------------------

            // 2. 初始化状态
            let currentScore = photo.score || 0;
            let currentReason = photo.reason || "General improvement for professional look";

            if (!photo.score) {
                toast.loading("正在进行初始评分 (Gemini 3 Flash)...", { id: toastId });
                const initRes = await analyzePhotosBatch([{ id: 'init', blob: currentBlob }]);
                currentScore = initRes[0].score;
                currentReason = initRes[0].reason;
            }

            let iteration = 0;

            // --- 核心循环 ---
            while (currentScore < TARGET_SCORE && iteration < MAX_ITERATIONS) {
                iteration++;
                logger.info(`>>> [迭代 ${iteration}] 当前分数: ${currentScore}. 改进目标: ${currentReason}`);

                // A. 修图
                toast.loading(`[第 ${iteration} 轮] Nano Banana 正在修图...\n目标: "${currentReason.slice(0, 30)}..."`, { id: toastId });
                const newBlob = await editImageWithGemini(currentBlob, currentReason);

                // B. 评分
                toast.loading(`[第 ${iteration} 轮] Gemini 3 Flash 正在验收评分...`, { id: toastId });
                const analysisResult = await analyzePhotosBatch([{ id: `iter-${iteration}`, blob: newBlob }]);
                const result = analysisResult[0];

                logger.info(`<<< [迭代 ${iteration}] 结果: ${result.score}分 (原 ${currentScore}分)`);

                currentScore = result.score;
                currentReason = result.reason;
                currentBlob = newBlob;
            }

            // --- 结果处理 ---
            const isSuccess = currentScore >= TARGET_SCORE;
            const finalMsg = isSuccess
                ? `🎉 优化成功！最终分数: ${currentScore}`
                : `⚠️ 迭代结束. 最终: ${currentScore}`;

            if (isSuccess) toast.success(finalMsg, { id: toastId });
            else toast.warning(finalMsg, { id: toastId });

            // 写入数据库
            await db.transaction('rw', db.photos, async () => {
                await db.photos.update(photo.id, {
                    // analysisBlob 更新为 AI 的新图
                    analysisBlob: currentBlob,
                    // previewBlob 也更新
                    previewBlob: currentBlob,

                    // originalBlob 已经在前面保存过了，这里不需要动，它永远是原图

                    score: currentScore,
                    reason: currentReason,
                    status: 'scored',
                    updatedAt: Date.now(),

                    // 清除 Magic Fix 的 CSS 参数，因为我们已经像素级重绘了
                    magicEdits: undefined
                });
            });

            window.dispatchEvent(new CustomEvent('pipeline-wakeup'));

        } catch (error) {
            console.error(error);
            const errMsg = error instanceof Error ? error.message : String(error);
            toast.error("自动化精修中断: " + errMsg, { id: toastId });
        } finally {
            setIsOptimizing(false);
        }
    };

    return { startOptimization, isOptimizing };
}
