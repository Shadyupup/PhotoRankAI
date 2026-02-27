/// <reference lib="webworker" />

self.onmessage = async (e: MessageEvent) => {
    const { id, file } = e.data;

    try {
        const bitmap = await createImageBitmap(file);

        console.log(`[Worker] Processing ${id}: Start Compression...`);

        // 1. Generate Thumbnail (300px)
        const thumbBuf = await resizeImageToArrayBuffer(bitmap, 300);

        // 2. Generate Analysis (512px) - Optimized for Token Usage
        const analysisBuf = await resizeImageToArrayBuffer(bitmap, 512);

        console.log(`[Worker] Processing ${id}: Compression Complete. Thumb=${thumbBuf?.byteLength}, Analysis=${analysisBuf?.byteLength}`);

        // Transfer ArrayBuffers (zero-copy) instead of Blobs
        // WebKit in Tauri cannot store Blobs in IndexedDB
        const transferables: ArrayBuffer[] = [];
        if (thumbBuf) transferables.push(thumbBuf);
        if (analysisBuf) transferables.push(analysisBuf);

        self.postMessage({
            id,
            status: 'success',
            thumbBuf,
            analysisBuf
        }, transferables);

        bitmap.close();
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        self.postMessage({ id, status: 'error', error: message });
    }
};

async function resizeImageToArrayBuffer(bitmap: ImageBitmap, targetSize: number): Promise<ArrayBuffer | null> {
    const scale = Math.min(targetSize / bitmap.width, targetSize / bitmap.height, 1);

    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');

    if (!ctx) throw new Error("Could not get canvas context");

    // High quality resize
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
    return blob.arrayBuffer();
}

export { };
