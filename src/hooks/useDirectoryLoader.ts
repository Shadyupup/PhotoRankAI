import { useState, useCallback } from 'react';
import { logger } from '@/lib/logger';

export interface FileEntry {
    id: string; // absolute path or unique identifier
    handle?: FileSystemFileHandle;
    file?: File;
    name: string;
    path: string; // relative path within the imported directory
}

export function useDirectoryLoader() {
    const [isLoading, setIsLoading] = useState(false);
    const [files, setFiles] = useState<FileEntry[]>([]);
    const [error, setError] = useState<string | null>(null);

    const [abortController, setAbortController] = useState<AbortController | null>(null);

    const cancelLoad = useCallback(() => {
        if (abortController) {
            abortController.abort();
            setAbortController(null);
            setIsLoading(false);
            logger.info('Operation cancelled by user');
        }
    }, [abortController]);

    const loadDirectory = useCallback(async () => {
        const controller = new AbortController();
        setAbortController(controller);

        logger.info('Opening directory picker...');
        setIsLoading(true);
        setError(null);
        try {
            const dirHandle = await window.showDirectoryPicker();
            if (controller.signal.aborted) return;

            const entries: FileEntry[] = [];
            let skippedCount = 0;
            async function scanDirectory(handle: FileSystemDirectoryHandle, pathPrefix: string) {
                if (controller.signal.aborted) return;

                for await (const entry of handle.values()) {
                    if (controller.signal.aborted) return;

                    const relativePath = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name;

                    if (entry.kind === 'file') {
                        const fileHandle = entry as FileSystemFileHandle;
                        // Filter for images with extended format support (Added .dng)
                        if (/\.(jpg|jpeg|png|webp|avif|dng)$/i.test(entry.name)) {
                            // 使用 randomUUID 确保唯一性，避免 React Key 冲突
                            const uniqueId = `file-${crypto.randomUUID()}`;
                            entries.push({
                                id: uniqueId,
                                handle: fileHandle,
                                name: entry.name,
                                path: relativePath
                            });
                        } else {
                            skippedCount++;
                        }
                    } else if (entry.kind === 'directory') {
                        await scanDirectory(entry as FileSystemDirectoryHandle, relativePath);
                    }
                }
            }

            await scanDirectory(dirHandle, "");
            if (skippedCount > 0) {
                logger.warn(`Skipped ${skippedCount} non-image or RAW files. Currently only JPG, PNG, WEBP, and DNG are supported.`);
            }

            if (controller.signal.aborted) return;

            logger.success(`Scanned directory`, { count: entries.length });
            setFiles(entries);
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if ((err as any)?.name !== 'AbortError' && !controller.signal.aborted) {
                setError(errorMessage || 'Failed to load directory');
                logger.error(`Directory scan failed`, { error: errorMessage });
            } else {
                logger.info('Directory scan aborted');
            }
        } finally {
            // Only turn off loading if we haven't already cancelled (which does it immediately)
            if (!controller.signal.aborted) {
                setIsLoading(false);
                setAbortController(null);
            }
        }
    }, []);

    const loadFiles = useCallback(async (fileList: File[]) => {
        logger.info('Processing dropped files...', { count: fileList.length });
        setIsLoading(true);
        setError(null);

        try {
            const originalCount = fileList.length;
            const validFiles = fileList.filter(f => /\.(jpg|jpeg|png|webp|avif|dng)$/i.test(f.name));
            const skipped = originalCount - validFiles.length;

            const entries: FileEntry[] = validFiles.map(f => ({
                // 修复：使用 randomUUID 防止批量拖入时 ID 重复 (Date.now() 在循环中可能相同)
                id: `drop-${crypto.randomUUID()}`,
                file: f,
                name: f.name,
                path: f.name
            }));

            if (skipped > 0) {
                logger.warn(`Skipped ${skipped} files. Only JPG, PNG, WEBP, and DNG are currently supported.`);
            }

            if (entries.length === 0) {
                throw new Error("No supported image files found. Please use JPG, PNG, WEBP, or DNG.");
            }

            logger.success(`Processed dropped files`, { count: entries.length });
            setFiles(entries); // Replace files
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            setError(errorMessage || 'Failed to process files');
            logger.error(`File drop failed`, { error: errorMessage });
        } finally {
            setIsLoading(false);
        }
    }, []);

    const supportsFileSystemAccess = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
    return { loadDirectory, loadFiles, cancelLoad, isLoading, files, error, supportsFileSystemAccess };
}
