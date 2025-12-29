/**
 * 美图级技巧：将原图与 AI 生成图进行混合，找回"像真度"
 * @param originalBlob 原图
 * @param aiBlob AI 生成的图
 * @param blendOpacity 混合透明度 (0.1 - 0.2 最佳)
 */
export async function blendOriginalIdentity(
    originalBlob: Blob,
    aiBlob: Blob,
    blendOpacity: number = 0.15
): Promise<Blob> {
    // 1. 加载图片
    const originalImg = await createImageBitmap(originalBlob);
    const aiImg = await createImageBitmap(aiBlob);

    // 2. 创建 Canvas (以 AI 图尺寸为准)
    const canvas = new OffscreenCanvas(aiImg.width, aiImg.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("Canvas context failed");

    // 3. 绘制 AI 底图
    ctx.drawImage(aiImg, 0, 0);

    // 4. 叠加原图 (核心 Trick)
    // 注意：这里假设 Gemini 并没有大幅度改变人物的姿态和位置 (Face Alignment)
    // 如果 AI 改变了构图，直接叠加会产生重影（鬼影）。
    // 所以这个技巧只适用于 "Magic Fix" (画质/光影提升)，不适用于大幅度动作改变。

    ctx.globalAlpha = blendOpacity; // 设置透明度 15%
    // 强制拉伸原图以匹配 AI 图尺寸 (假设 AI 保持了比例)
    ctx.drawImage(originalImg, 0, 0, aiImg.width, aiImg.height);

    // 5. 还原 Alpha
    ctx.globalAlpha = 1.0;

    // 6. (可选) 这里还可以加一层锐化滤镜模拟 "Face Restoration"

    // 7. 输出
    return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
}
