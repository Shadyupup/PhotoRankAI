import { removeBackground } from "@imgly/background-removal";
import { logger } from "./logger";

/**
 * 前端本地抠图：提取人像层 (透明 PNG)
 */
export async function extractPersonLayer(imageBlob: Blob): Promise<Blob> {
    logger.info("正在进行本地人像抠图 (Segmentation)...");
    const start = Date.now();

    try {
        // imgly 会自动下载 WASM 模型并运行
        // output: blob (image/png)
        const pngBlob = await removeBackground(imageBlob, {
            // progress: (key, current, total) => {
            //     // 可选：打印进度
            //     // console.log(`Downloading ${key}: ${current} of ${total}`);
            // },
            model: "isnet" // 平衡速度和质量
        });

        logger.success(`人像提取完成，耗时 ${(Date.now() - start) / 1000}s`);
        return pngBlob;
    } catch (error) {
        logger.error("抠图失败", error);
        throw new Error("无法提取人像，请检查图片或网络（首次需要下载模型）");
    }
}

/**
 * 图像合成：将前景贴到背景上
 */
export async function compositeImages(backgroundBlob: Blob, foregroundBlob: Blob): Promise<Blob> {
    const bgBitmap = await createImageBitmap(backgroundBlob);
    const fgBitmap = await createImageBitmap(foregroundBlob);

    const canvas = new OffscreenCanvas(bgBitmap.width, bgBitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("Canvas Error");

    // 1. 画背景
    ctx.drawImage(bgBitmap, 0, 0);

    // 2. 画前景 (强制拉伸匹配，假设尺寸一致)
    // 注意：imgly 返回的图尺寸通常和原图一致，位置也是对的，所以直接 0,0 绘制即可
    ctx.drawImage(fgBitmap, 0, 0, bgBitmap.width, bgBitmap.height);

    return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
}
