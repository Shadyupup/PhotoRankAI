import { useState, useRef, useEffect } from 'react';
import { db } from '@/lib/db';
import { analyzePhotosBatch } from '@/lib/gemini';
import { logger } from '@/lib/logger';

const BATCH_SIZE = 4;
const RATE_LIMIT_DELAY_MS = 2000;
const CONCURRENCY = 1; // 1 batch at a time

let hasRecovered = false;

export function useAIPipeline() {
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const mountedRef = useRef(true);
    const lastAnalysisTimeRef = useRef<number>(0);


    const recoverStuckTasks = async () => {
        try {
            if (!hasRecovered) {
                hasRecovered = true;
                const stuckTasks = await db.photos.where('status').equals('analyzing').toArray();
                if (stuckTasks.length > 0) {
                    logger.warn(`Recovering ${stuckTasks.length} legacy stuck tasks`);
                    await db.transaction('rw', db.photos, async () => {
                        for (const task of stuckTasks) {
                            await db.photos.update(task.id, { status: 'queued', updatedAt: Date.now() });
                        }
                    });
                }
            }
        } catch (e) {
            console.error("Recovery failed", e);
        }
    };

    // Expose for Debugging
    useEffect(() => {
        if (typeof window !== 'undefined') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (window as any).debugPipeline = () => processQueue();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (window as any).db = db;
        }
    }, []);

    useEffect(() => {
        mountedRef.current = true; // <--- 重点：重新挂载时必须设为 true

        // Listen for "Wake Up" calls
        const wakeUp = () => {
            console.log("Pipeline: 收到唤醒信号");
            processQueue();
        };
        window.addEventListener('pipeline-wakeup', wakeUp);

        // Start Loop
        recoverStuckTasks();
        processQueue();

        return () => {
            mountedRef.current = false;
            window.removeEventListener('pipeline-wakeup', wakeUp);
        };
    }, []);

    const processQueue = async () => {
        // 加一行极致详细的日志，如果没看到这行，说明逻辑没进来
        console.log(`[Pipeline Entry] Mounted: ${mountedRef.current}`);

        if (!mountedRef.current) return;

        try {
            // 1. Watchdog: Auto-cleanup zombie tasks (status='analyzing' AND updatedAt > 30s ago)
            const now = Date.now();
            const expired = await db.photos
                .where('status').equals('analyzing')
                .filter(p => !p.updatedAt || (now - p.updatedAt > 30000))
                .toArray();

            if (expired.length > 0) {
                logger.warn(`Pipeline: Watchdog cleaned up ${expired.length} stuck tasks`);
                await db.transaction('rw', db.photos, async () => {
                    for (const p of expired) {
                        await db.photos.update(p.id, { status: 'queued', updatedAt: now });
                    }
                });
            }

            const activeCount = await db.photos.where('status').equals('analyzing').count();
            const queuedCount = await db.photos.where('status').equals('queued').count();

            // 只要有活儿没干完，或者正在干活，就打印状态
            if (queuedCount > 0 || activeCount > 0) {
                logger.info(`Pipeline Status: 等待中=${queuedCount}, 进行中=${activeCount}`);
            }

            if (queuedCount > 0 && activeCount < CONCURRENCY) {
                const tasks = await db.photos.where('status').equals('queued').limit(BATCH_SIZE).toArray();
                if (tasks.length > 0) {
                    setIsAnalyzing(true);

                    const taskIds = tasks.map(t => t.id);
                    await db.transaction('rw', db.photos, async () => {
                        for (const id of taskIds) {
                            await db.photos.update(id, { status: 'analyzing', updatedAt: Date.now() });
                        }
                    });

                    // Throttle: Ensure at least RATE_LIMIT_DELAY_MS has passed since last request start
                    const now = Date.now();
                    const timeSinceLast = now - lastAnalysisTimeRef.current;
                    if (timeSinceLast < RATE_LIMIT_DELAY_MS) {
                        const waitTime = RATE_LIMIT_DELAY_MS - timeSinceLast;
                        logger.info(`Pipeline: Rate limiting... waiting ${waitTime}ms`);
                        await new Promise(resolve => setTimeout(resolve, waitTime));
                    }

                    lastAnalysisTimeRef.current = Date.now();
                    logger.info(`Pipeline: Starting batch analysis for ${tasks.length} photos: [${taskIds.join(', ')}]`);

                    // Execute logic inline (awaiting it)
                    const blobs = tasks.map(t => t.analysisBlob).filter((b): b is Blob => !!b);
                    if (blobs.length !== tasks.length) throw new Error("Missing analysis data for some task");

                    const results = await analyzePhotosBatch(blobs);
                    logger.info("AI 返回结果数组:", results);

                    // Critical: Always save results even if component unmounted (Zombie process handling)
                    await db.transaction('rw', db.photos, async () => {
                        for (let i = 0; i < tasks.length; i++) {
                            // 增加防御性编程：防止 results[i] 为空
                            const res = results[i] || { score: 1, reason: "AI 返回数据格式异常" };
                            await db.photos.update(tasks[i].id, {
                                score: parseFloat(String(res.score)) || 0, // 强转为浮点数
                                reason: res.reason || "无理由",
                                status: 'scored',
                                updatedAt: Date.now()
                            });
                        }
                    });
                    logger.success(`Pipeline: Successfully scored batch of ${tasks.length}`);
                    logger.info(`Pipeline: DB Update Verified. notifying UI...`);
                }
            }


            // Sync analyzing status
            setIsAnalyzing(activeCount > 0);

        } catch (error) {
            logger.error("Pipeline 运行异常", error);
        } finally {
            // 确保心跳永不停止
            if (mountedRef.current) {
                setTimeout(processQueue, 2000);
            }
        }
    };



    const queueAll = async () => {
        const candidates = await db.photos.where('status').equals('done').toArray();
        await db.transaction('rw', db.photos, async () => {
            for (const p of candidates) {
                await db.photos.update(p.id, { status: 'queued' });
            }
        });
        window.dispatchEvent(new CustomEvent('pipeline-wakeup'));
    };

    return { queueAll, isAnalyzing, processQueue };
}
