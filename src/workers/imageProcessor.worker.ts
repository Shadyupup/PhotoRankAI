/// <reference lib="webworker" />

self.onmessage = async (e: MessageEvent) => {
    const { id, file } = e.data;

    try {
        const bitmap = await createImageBitmap(file);

        // 1. Generate Thumbnail (300px)
        const thumbBlob = await resizeImage(bitmap, 300);

        // 2. Generate Analysis (1024px)
        const analysisBlob = await resizeImage(bitmap, 1024);

        self.postMessage({
            id,
            status: 'success',
            thumbBlob,
            analysisBlob
        });

        bitmap.close();
    } catch (err: any) {
        self.postMessage({ id, status: 'error', error: err.message });
    }
};

async function resizeImage(bitmap: ImageBitmap, targetSize: number): Promise<Blob | null> {
    const scale = Math.min(targetSize / bitmap.width, targetSize / bitmap.height, 1);
    // If no scaling needed and original is wanted, return original? 
    // No, we always want consistent formats (e.g. jpeg/webp). 
    // If scale is 1, we still draw it.

    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');

    if (!ctx) throw new Error("Could not get canvas context");

    // High quality resize
    ctx.drawImage(bitmap, 0, 0, width, height);

    return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
}

export { };
