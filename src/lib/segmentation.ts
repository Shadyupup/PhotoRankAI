import { removeBackground } from "@imgly/background-removal";
import { logger } from "./logger";

/**
 * Frontend local segmentation: extract portrait layer (transparent PNG)
 */
export async function extractPersonLayer(imageBlob: Blob): Promise<Blob> {
    logger.info("Running local portrait segmentation...");
    const start = Date.now();

    try {
        // imgly auto-downloads WASM model and runs
        // output: blob (image/png)
        const pngBlob = await removeBackground(imageBlob, {
            // progress: (key, current, total) => {
            //     // Optional: print progress
            //     // console.log(`Downloading ${key}: ${current} of ${total}`);
            // },
            model: "isnet" // Balance speed and quality
        });

        logger.success(`Portrait extraction complete, took ${(Date.now() - start) / 1000}s`);
        return pngBlob;
    } catch (error) {
        logger.error("Segmentation failed", error);
        throw new Error("Failed to extract portrait. Check the image or network (first run downloads the model)");
    }
}

/**
 * Image compositing: place foreground onto background
 */
export async function compositeImages(backgroundBlob: Blob, foregroundBlob: Blob): Promise<Blob> {
    const bgBitmap = await createImageBitmap(backgroundBlob);
    const fgBitmap = await createImageBitmap(foregroundBlob);

    const canvas = new OffscreenCanvas(bgBitmap.width, bgBitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("Canvas Error");

    // 1. Draw background
    ctx.drawImage(bgBitmap, 0, 0);

    // 2. Draw foreground (stretch to match, assuming same dimensions)
    // Note: imgly returns same dimensions as original, so draw at 0,0
    ctx.drawImage(fgBitmap, 0, 0, bgBitmap.width, bgBitmap.height);

    return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
}
