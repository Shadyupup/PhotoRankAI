import { useState, useRef, useEffect } from 'react';
import { db, resetDatabase } from '@/lib/db';
import { analyzePhotosBatch, AIEngine } from '@/lib/local-scorer';
import { logger } from '@/lib/logger';
import { toast } from 'sonner';

// Electron uses Chromium — no WebKit memory limitations
const BATCH_SIZE = 8;
const RATE_LIMIT_DELAY_MS = 200;
const CONCURRENCY = 3;

let hasRecovered = false;

export function useAIPipeline(paused = false, engine: AIEngine = 'local-fast') {
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const mountedRef = useRef(true);
    const lastAnalysisTimeRef = useRef<number>(0);
    const pausedRef = useRef(paused);
    const isRunningRef = useRef(false);
    const engineRef = useRef<AIEngine>(engine);

    // Keep refs in sync with props
    useEffect(() => { pausedRef.current = paused; }, [paused]);
    useEffect(() => { engineRef.current = engine; }, [engine]);


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
        } catch (e: unknown) { // Use unknown instead of any
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const err = e as any;
            // CRITICAL: Handle Dexie DatabaseClosedError/UnknownError
            if (err?.name === 'DatabaseClosedError' || err?.message?.includes('backing store') || err?.name === 'UnknownError') {
                logger.error("[Critical] Database corruption during recovery. Stopping.", err);
                // No need to toast here if processQueue also toasts, but to be safe:
                // We just abort recovery.
                return;
            }
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
        mountedRef.current = true;

        // Listen for "Wake Up" calls
        const wakeUp = () => {
            console.log("Pipeline: Received wake-up signal");
            processQueue();
        };
        window.addEventListener('pipeline-wakeup', wakeUp);

        // Start Loop
        recoverStuckTasks();
        processQueue();
        const intervalId = setInterval(processQueue, 2000);

        return () => {
            mountedRef.current = false;
            clearInterval(intervalId);
            window.removeEventListener('pipeline-wakeup', wakeUp);
        };
         
    }, []);

    const processQueue = async () => {
        // Detailed log entry to verify pipeline is being called
        console.log(`[Pipeline Entry] Mounted: ${mountedRef.current}, Paused: ${pausedRef.current}, Running: ${isRunningRef.current}`);

        if (!mountedRef.current) return;
        if (pausedRef.current) return;
        if (isRunningRef.current) return;

        isRunningRef.current = true;
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

            // Log status whenever there are pending or active tasks
            if (queuedCount > 0 || activeCount > 0) {
                logger.info(`Pipeline Status: queued=${queuedCount}, active=${activeCount}`);
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
                    // 1. Separate valid items from invalid ones (missing blob or size 0)
                    const validItems: { id: string, blob?: Blob, path?: string }[] = [];
                    const invalidIds: string[] = [];

                    tasks.forEach(t => {
                        // DB stores ArrayBuffer; convert to Blob for API consumption
                        let blobToUse: Blob | undefined;
                        const bufToUse = t.analysisBlob || t.previewBlob || t.originalBlob;
                        if (bufToUse && bufToUse instanceof ArrayBuffer && bufToUse.byteLength > 0) {
                            blobToUse = new Blob([bufToUse], { type: 'image/jpeg' });
                        } else if (bufToUse && bufToUse instanceof Blob && bufToUse.size > 0) {
                            // Legacy fallback (data written before migration)
                            blobToUse = bufToUse as Blob;
                        }
                        const absolutePath = t.filePath;

                        if (blobToUse || absolutePath) {
                            validItems.push({
                                id: t.id,
                                blob: blobToUse,
                                path: absolutePath
                            });
                        } else {
                            invalidIds.push(t.id);
                        }
                    });

                    // 2. Handle Invalid Items immediately (Mark as Error)
                    if (invalidIds.length > 0) {
                        logger.error(`Pipeline: Found ${invalidIds.length} tasks with missing/empty image data: [${invalidIds.join(', ')}]. Marking as error.`);
                        await db.transaction('rw', db.photos, async () => {
                            for (const id of invalidIds) {
                                await db.photos.update(id, {
                                    status: 'error',
                                    reason: 'Image data lost or corrupted (0 bytes)',
                                    updatedAt: Date.now()
                                });
                            }
                        });
                    }

                    // 3. Process Valid Items
                    if (validItems.length > 0) {
                        try {
                            const results = await analyzePhotosBatch(validItems, engineRef.current);
                            logger.info("AI returned results:", results);

                            // Create a Map for O(1) Lookup by ID
                            const resultMap = new Map(results.map(r => [r.file_id, r]));

                            await db.transaction('rw', db.photos, async () => {
                                for (const item of validItems) {
                                    const res = resultMap.get(item.id);

                                    if (res) {
                                        await db.photos.update(item.id, {
                                            score: parseFloat(String(res.score)) || 0,
                                            reason: res.reason || "No reason provided",
                                            tags: res.tags,
                                            clip_embedding: res.clip_embedding,
                                            status: 'scored',
                                            analysisBlob: undefined, // Free up space!
                                            updatedAt: Date.now()
                                        });
                                    } else {
                                        logger.warn(`Missing result for ID: ${item.id} - Re-queuing`);
                                        await db.photos.update(item.id, {
                                            status: 'queued',
                                            updatedAt: Date.now()
                                        });
                                    }
                                }
                            });
                            logger.success(`Pipeline: Successfully scored batch of ${validItems.length}`);
                        } catch (err) {
                            // If the batch API call fails, we should probably retry later or mark as error
                            // For now, letting the outer catch handle it (which keeps them in 'analyzing' until watchdog resets them) is okay,
                            // OR we can explicitly reset them to queued.
                            logger.error("Batch Analysis Failed", err);
                            throw err; // Re-throw to trigger outer catch
                        }
                    } else {
                        logger.warn("Pipeline: No valid items to process in this batch.");
                    }
                    logger.info(`Pipeline: DB Update Verified. notifying UI...`);
                }
            }


            // Sync analyzing status
            setIsAnalyzing(activeCount > 0);

        } catch (error: unknown) { // Use unknown instead of any
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const err = error as any;
            // CRITICAL: Handle Dexie DatabaseClosedError/UnknownError/ModifyError to prevent crash loops
            const isCriticalDBError =
                err?.name === 'DatabaseClosedError' ||
                err?.name === 'UnknownError' ||
                err?.name === 'ModifyError' ||
                err?.message?.includes('backing store') ||
                err?.message?.includes('Blob/File');

            if (isCriticalDBError) {
                logger.error("[Critical] Database corruption detected. Stopping pipeline.", err);

                // Stop the recursion
                mountedRef.current = false;

                // Show a persistent error toast
                toast.error("Database needs reset (schema updated)", {
                    duration: Infinity,
                    description: "Old data is incompatible. Click 'Fix' to clear and reimport.",
                    action: {
                        label: 'Fix & Reload',
                        onClick: async () => {
                            await resetDatabase();
                            window.location.reload();
                        }
                    }
                });
                return;
            }
            logger.error("Pipeline runtime error", error);
        } finally {
            isRunningRef.current = false;
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
