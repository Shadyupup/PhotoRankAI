import { useState, useCallback } from 'react';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import type { PhotoMetadata } from '@/lib/db';

export interface FileEntry {
    id: string;
    name: string;
    path: string;
}

/**
 * Resize an image file to target size and return as ArrayBuffer.
 * Runs on main thread using OffscreenCanvas (when available) or regular canvas.
 */
async function createThumbnail(file: File, targetSize: number): Promise<ArrayBuffer> {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(targetSize / bitmap.width, targetSize / bitmap.height, 1);
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close(); // Release memory immediately

    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
    return blob.arrayBuffer();
}

export function useDirectoryLoader() {
    const [isLoading, setIsLoading] = useState(false);
    const [files, setFiles] = useState<FileEntry[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

    const loadFiles = useCallback(async (fileList: File[]) => {
        logger.info('Processing files...', { count: fileList.length });
        setIsLoading(true);
        setError(null);

        try {
            const validFiles = fileList.filter(f => /\.(jpg|jpeg|png|webp|avif|dng)$/i.test(f.name));
            const skipped = fileList.length - validFiles.length;

            if (skipped > 0) {
                logger.warn(`Skipped ${skipped} files. Only JPG, PNG, WEBP, and DNG supported.`);
            }

            if (validFiles.length === 0) {
                throw new Error("No supported image files found. Please use JPG, PNG, WEBP, or DNG.");
            }

            setProgress({ done: 0, total: validFiles.length });

            // Process files ONE AT A TIME to avoid OOM in WebKit/Tauri.
            // Each file is: read → create thumbnail → write to DB → release from memory.
            const entries: FileEntry[] = [];
            const BATCH_DB_SIZE = 10; // Flush to DB every 10 files
            let dbBatch: PhotoMetadata[] = [];
            let linkedCount = 0; // Photos that already existed — just updated filePath

            for (let i = 0; i < validFiles.length; i++) {
                const f = validFiles[i];
                const electronPath = (f as any).path || undefined;

                // Smart merge: check if a photo with the same name already exists
                const existing = await db.photos.where('name').equals(f.name).first();
                if (existing && existing.status === 'scored') {
                    // Already scored — just backfill filePath, don't re-process
                    if (electronPath && !existing.filePath) {
                        await db.photos.update(existing.id, { filePath: electronPath });
                        linkedCount++;
                    }
                    entries.push({ id: existing.id, name: f.name, path: f.webkitRelativePath || f.name });
                    setProgress({ done: i + 1, total: validFiles.length });
                    continue;
                }

                const id = `drop-${crypto.randomUUID()}`;

                try {
                    // Create thumbnails on main thread (one at a time = predictable memory)
                    const previewBuf = await createThumbnail(f, 300);
                    const analysisBuf = await createThumbnail(f, 512);

                    dbBatch.push({
                        id,
                        name: f.name,
                        size: f.size,
                        type: f.type || 'image/jpeg',
                        lastModified: f.lastModified,
                        webkitRelativePath: f.webkitRelativePath || f.name,
                        filePath: electronPath,
                        previewBlob: previewBuf,
                        analysisBlob: analysisBuf,
                        status: 'done', // Already preprocessed! Skip worker.
                        createdAt: Date.now()
                    });

                    entries.push({ id, name: f.name, path: f.webkitRelativePath || f.name });
                } catch (err) {
                    logger.warn(`Failed to process ${f.name}:`, err);
                    // Still add to DB but mark as error
                    dbBatch.push({
                        id,
                        name: f.name,
                        size: f.size,
                        type: f.type || 'image/jpeg',
                        lastModified: f.lastModified,
                        webkitRelativePath: f.webkitRelativePath || f.name,
                        status: 'error',
                        createdAt: Date.now()
                    });
                    entries.push({ id, name: f.name, path: f.webkitRelativePath || f.name });
                }

                // Flush batch to DB periodically to keep memory low
                if (dbBatch.length >= BATCH_DB_SIZE || i === validFiles.length - 1) {
                    try {
                        await db.transaction('rw', db.photos, async () => {
                            await db.photos.bulkPut(dbBatch);
                        });
                    } catch (e) {
                        console.error('[Import] DB batch write failed:', e);
                    }
                    dbBatch = []; // Release references
                }

                setProgress({ done: i + 1, total: validFiles.length });

                // Yield to event loop every 5 files to keep UI responsive
                if (i % 5 === 4) {
                    await new Promise(r => setTimeout(r, 0));
                }
            }

            logger.success(`Imported ${entries.length} photos` + (linkedCount > 0 ? ` (${linkedCount} existing photos linked)` : ''), { count: entries.length });
            setFiles(entries); // Trigger downstream effects (lightweight, no File refs)
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            setError(errorMessage || 'Failed to process files');
            logger.error(`File import failed`, { error: errorMessage });
        } finally {
            setIsLoading(false);
            setProgress(null);
        }
    }, []);

    const cancelLoad = useCallback(() => {
        // TODO: implement abort via AbortController
        setIsLoading(false);
    }, []);

    const supportsFileSystemAccess = true;
    return { loadFiles, cancelLoad, isLoading, files, error, supportsFileSystemAccess, progress };
}
