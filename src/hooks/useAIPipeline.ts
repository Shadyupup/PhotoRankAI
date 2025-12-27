import { useState, useRef, useEffect } from 'react';
import { db } from '@/lib/db';
import { analyzePhoto } from '@/lib/gemini';
import { logger } from '@/lib/logger';

const CONCURRENCY = 3;

export function useAIPipeline() {
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const activeRequests = useRef(0);
    const mountedRef = useRef(true);

    useEffect(() => {
        return () => { mountedRef.current = false; };
    }, []);

    const processQueue = async () => {
        if (!mountedRef.current) return;

        if (activeRequests.current >= CONCURRENCY) {
            setTimeout(processQueue, 500);
            return;
        }

        try {
            const task = await db.photos.where('status').equals('queued').first();

            if (!task) {
                if (activeRequests.current === 0) setIsAnalyzing(false);
                setTimeout(processQueue, 1000);
                return;
            }

            setIsAnalyzing(true);
            activeRequests.current++;

            logger.info(`Starting analysis for ${task.id}`);
            await db.photos.update(task.id, { status: 'analyzing' });

            (async () => {
                try {
                    if (!task.analysisBlob) throw new Error("No analysis blob");

                    const start = Date.now();
                    const result = await analyzePhoto(task.analysisBlob);
                    const duration = Date.now() - start;

                    if (mountedRef.current) {
                        await db.photos.update(task.id, {
                            score: result.score,
                            reason: result.reason,
                            status: 'scored'
                        });
                        logger.success(`Analyzed`, { id: task.id, score: result.score });
                    }
                } catch (err: any) {
                    console.error("Analysis failed", err);
                    logger.error(`Analysis failed for ${task.id}`, err);
                    if (mountedRef.current) {
                        await db.photos.update(task.id, { status: 'error', reason: err.message });
                    }
                } finally {
                    activeRequests.current--;
                    if (mountedRef.current) processQueue();
                }
            })();

            if (activeRequests.current < CONCURRENCY) {
                processQueue();
            }

        } catch (error) {
            console.warn("Queue processing error", error);
            setTimeout(processQueue, 2000);
        }
    };

    useEffect(() => {
        processQueue();
    }, []);

    const queueAll = async () => {
        const candidates = await db.photos.where('status').equals('done').toArray();
        await db.transaction('rw', db.photos, async () => {
            for (const p of candidates) {
                await db.photos.update(p.id, { status: 'queued' as const });
            }
        });
        setIsAnalyzing(true);
        processQueue();
    };

    return { queueAll, isAnalyzing };
}
