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
            // @ts-ignore
            const dirHandle = await window.showDirectoryPicker();
            if (controller.signal.aborted) return;

            const entries: FileEntry[] = [];

            async function scanDirectory(handle: FileSystemDirectoryHandle, pathPrefix: string) {
                if (controller.signal.aborted) return;

                // @ts-ignore
                for await (const entry of handle.values()) {
                    if (controller.signal.aborted) return;

                    const relativePath = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name;

                    if (entry.kind === 'file') {
                        const fileHandle = entry as FileSystemFileHandle;
                        // Filter for images with extended format support
                        if (/\.(jpg|jpeg|png|webp|avif)$/i.test(entry.name)) {
                            entries.push({
                                id: relativePath,
                                handle: fileHandle,
                                name: entry.name,
                                path: relativePath
                            });
                        }
                    } else if (entry.kind === 'directory') {
                        await scanDirectory(entry as FileSystemDirectoryHandle, relativePath);
                    }
                }
            }

            await scanDirectory(dirHandle, "");

            if (controller.signal.aborted) return;

            logger.success(`Scanned directory`, { count: entries.length });
            setFiles(entries);
        } catch (err: any) {
            if (err.name !== 'AbortError' && !controller.signal.aborted) {
                setError(err.message || 'Failed to load directory');
                logger.error(`Directory scan failed`, { error: err.message });
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
            const entries: FileEntry[] = fileList
                .filter(f => /\.(jpg|jpeg|png|webp|avif)$/i.test(f.name))
                .map(f => ({
                    id: `drop-${Date.now()}-${f.name}`,
                    // We don't need a mock handle anymore, we pass the file directly
                    file: f,
                    name: f.name,
                    path: f.name
                }));

            if (entries.length === 0) {
                throw new Error("No image files found in selection");
            }

            logger.success(`Processed dropped files`, { count: entries.length });
            setFiles(entries); // Replace files
        } catch (err: any) {
            setError(err.message || 'Failed to process files');
            logger.error(`File drop failed`, { error: err.message });
        } finally {
            setIsLoading(false);
        }
    }, []);

    return { loadDirectory, loadFiles, cancelLoad, isLoading, files, error };
}
