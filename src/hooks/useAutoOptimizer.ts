import { useState } from 'react';
import { db, PhotoMetadata } from '@/lib/db';
import { getProvider, getProviderType } from '@/lib/ai-provider';
import { runPortraitWorkflow } from '@/lib/portrait-workflow';
import { runLandscapeWorkflow } from '@/lib/landscape-workflow';
import { runPortraitWorkflow as runPortraitWorkflowQwen } from '@/lib/portrait-workflow-qwen';
import { runLandscapeWorkflow as runLandscapeWorkflowQwen } from '@/lib/landscape-workflow-qwen';
import { logger } from '@/lib/logger';
import { toast } from 'sonner';
import { LOCAL_SCORER_URL } from '@/lib/local-scorer';

export function useAutoOptimizer() {
    const [isOptimizing, setIsOptimizing] = useState(false);

    // Accept mode parameter (instant | iterative)
    const startOptimization = async (photo: PhotoMetadata, mode: 'instant' | 'iterative' = 'instant') => {
        if (isOptimizing) return;
        setIsOptimizing(true);
        const modeLabels = { instant: "AI quick enhance...", iterative: "Starting iterative refinement..." };
        const toastId = toast.loading(modeLabels[mode]);

        try {
            // ============================================================
            // 1. Prepare dual-track data: separate analysis image from generation image
            // ============================================================

            // A. Get high-res original - used for final generation
            let highResBlob: Blob | undefined;
            // DB stores ArrayBuffer; convert to Blob for API usage
            if (photo.handle) {
                try {
                    highResBlob = await photo.handle.getFile();
                } catch (e) {
                    console.warn("Lost file handle access", e);
                }
            }

            // Electron: read file directly from disk via IPC (bypasses CORS)
            if (!highResBlob && photo.filePath) {
                if (window.electronAPI) {
                    try {
                        console.log(`[AutoOptimizer] Reading high-res via Electron IPC: ${photo.filePath}`);
                        const result = await window.electronAPI.readFile(photo.filePath);
                        if (result.success) {
                            highResBlob = new Blob([new Uint8Array(result.data).buffer], { type: 'image/jpeg' });
                            console.log(`[AutoOptimizer] Got high-res blob via IPC: ${highResBlob.size} bytes`);
                        }
                    } catch (e) {
                        console.warn("[AutoOptimizer] IPC readFile failed", e);
                    }
                } else {
                    // Browser fallback: use backend preview API
                    try {
                        const response = await fetch(`${LOCAL_SCORER_URL}/api/preview?path=${encodeURIComponent(photo.filePath)}`);
                        if (response.ok) {
                            highResBlob = await response.blob();
                        }
                    } catch (e) {
                        console.warn("[AutoOptimizer] Backend preview fetch failed", e);
                    }
                }
            }

            if (!highResBlob && photo.originalBlob) {
                highResBlob = new Blob([photo.originalBlob], { type: 'image/jpeg' });
            }

            // If no high-res image found, throw error - never use thumbnails
            if (!highResBlob) {
                throw new Error("Cannot access the original high-res image. Please ensure the source file is accessible.");
            }

            // Backup original (convert Blob to ArrayBuffer for DB)
            if (!photo.originalBlob) {
                const origBuf = await highResBlob.arrayBuffer();
                await db.photos.update(photo.id, { originalBlob: origBuf });
            }

            // B. Get low-res analysis image - used only for analysis, improves speed
            let lowResBlob: Blob;
            if (photo.analysisBlob) {
                lowResBlob = new Blob([photo.analysisBlob], { type: 'image/jpeg' });
            } else {
                lowResBlob = highResBlob;
            }

            // ============================================================

            // Step 0: Detect lighting conditions (using low-res for speed)
            toast.loading("Step 0: Analyzing lighting...", { id: toastId });
            const provider = getProvider();
            const lightingInfo = await provider.analyzeLightingCondition(lowResBlob);
            logger.info(`Lighting analysis: ${lightingInfo}`);

            // Step 1: Analyze content (using low-res for speed)
            toast.loading("Step 1: Analyzing content...", { id: toastId });
            const contentInfo = await provider.detectImageContent(lowResBlob);

            let finalResultBlob = highResBlob;
            let currentReason = "Optimization complete";
            let currentScore = 0;

            // Dispatch: pass both lowRes and highRes
            const isQwen = getProviderType() === 'qwen';
            if (contentInfo.hasLivingBeings && contentInfo.subjectType === 'person') {
                // Portrait mode
                const runner = isQwen ? runPortraitWorkflowQwen : runPortraitWorkflow;
                const res = await runner(lowResBlob, highResBlob, mode, toastId);
                finalResultBlob = res.blob;
                currentScore = res.score;
                currentReason = res.reason;
            } else {
                // Landscape mode
                const runner = isQwen ? runLandscapeWorkflowQwen : runLandscapeWorkflow;
                const res = await runner(lowResBlob, highResBlob, mode, toastId);
                finalResultBlob = res.blob;
                currentScore = res.score;
                currentReason = res.reason;
            }

            // Save result (convert Blob to ArrayBuffer for DB)
            const resultBuf = await finalResultBlob.arrayBuffer();

            // Score floor: Enhancement should NEVER lower the score.
            // The workflow's NIMA score is unreliable because it scores a low-res blob.
            // Use the higher of: workflow score, or original score.
            const originalScore = photo.originalScore ?? photo.score ?? 0;
            const floorScore = Math.max(currentScore, originalScore);

            await db.photos.update(photo.id, {
                analysisBlob: resultBuf,
                previewBlob: resultBuf, // Update preview
                score: floorScore,
                originalScore: photo.originalScore ?? photo.score,
                reason: currentReason,
                status: 'scored',
                updatedAt: Date.now()
            });

            toast.success(`Done: ${floorScore.toFixed(1)}`, { id: toastId });
            window.dispatchEvent(new CustomEvent('pipeline-wakeup'));

        } catch (error) {
            console.error(error);
            toast.error("Enhancement failed: " + (error instanceof Error ? error.message : "Unknown error"), { id: toastId });
        } finally {
            setIsOptimizing(false);
        }
    };

    return { startOptimization, isOptimizing };
}
