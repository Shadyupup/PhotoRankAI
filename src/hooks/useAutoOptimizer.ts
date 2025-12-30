import { useState } from 'react';
import { db, PhotoMetadata } from '@/lib/db';
import {
    analyzeLightingCondition,
    detectImageContent,
} from '@/lib/gemini';
import { runPortraitWorkflow } from '@/lib/portrait-workflow';
import { runLandscapeWorkflow } from '@/lib/landscape-workflow';
import { logger } from '@/lib/logger';
import { toast } from 'sonner';

export function useAutoOptimizer() {
    const [isOptimizing, setIsOptimizing] = useState(false);

    const startOptimization = async (photo: PhotoMetadata) => {
        if (isOptimizing) return;
        setIsOptimizing(true);
        const toastId = toast.loading("AI 极简精修中...");

        try {
            // ============================================================
            // 1. 【核心修复】准备双轨数据：必须分离“分析用图”和“生成用图”
            // ============================================================

            // A. 获取高清原图 (High Res) - 用于最终生成，拒绝马赛克！
            let highResBlob: Blob | undefined;

            if (photo.file) {
                highResBlob = new Blob([photo.file], { type: photo.file.type });
            } else if (photo.handle) {
                try {
                    highResBlob = await photo.handle.getFile();
                } catch (e) {
                    console.warn("Lost file handle access", e);
                }
            } else if (photo.originalBlob) {
                highResBlob = photo.originalBlob;
            }

            // 如果找不到高清图，抛出错误，绝对不用缩略图凑合
            if (!highResBlob) {
                throw new Error("无法获取高清原图，为了画质，请确保原始文件可访问。");
            }

            // 备份原图
            if (!photo.originalBlob) {
                await db.photos.update(photo.id, { originalBlob: highResBlob });
            }

            // B. 获取低清分析图 (Low Res) - 仅用于分析，提升速度
            const lowResBlob = photo.analysisBlob || highResBlob;

            // ============================================================

            // Step 0: 侦测光影 (用低清图快)
            toast.loading("Step 0: 侦测光影 DNA...", { id: toastId });
            const lightingInfo = await analyzeLightingCondition(lowResBlob);
            logger.info(`光影分析: ${lightingInfo}`);

            // Step 1: 分析内容 (用低清图快)
            toast.loading("Step 1: 分析画面内容...", { id: toastId });
            const contentInfo = await detectImageContent(lowResBlob);

            let finalResultBlob = highResBlob;
            let currentReason = "Optimization complete";
            let currentScore = 0;

            // 分发逻辑：同时传入 lowRes 和 highRes
            if (contentInfo.hasLivingBeings && contentInfo.subjectType === 'person') {
                // 人像模式 (假设你之前已经改好了支持双参数)
                const res = await runPortraitWorkflow(lowResBlob, highResBlob, toastId);
                finalResultBlob = res.blob;
                currentScore = res.score;
                currentReason = res.reason;
            } else {
                // 【重点】风景模式：传入两个 Blob
                const res = await runLandscapeWorkflow(lowResBlob, highResBlob, toastId);
                finalResultBlob = res.blob;
                currentScore = res.score;
                currentReason = res.reason;
            }

            // 保存结果
            await db.photos.update(photo.id, {
                analysisBlob: finalResultBlob,
                previewBlob: finalResultBlob, // 更新预览图
                score: currentScore,
                originalScore: photo.originalScore ?? photo.score,
                reason: currentReason,
                status: 'scored',
                updatedAt: Date.now()
            });

            toast.success(`Done: ${currentScore.toFixed(1)}`, { id: toastId });
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
