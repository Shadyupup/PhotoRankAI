/**
 * Blend original with AI-generated image to recover photorealism
 * @param originalBlob Original image
 * @param aiBlob AI-generated image
 * @param blendOpacity Blend opacity (0.1-0.2 optimal)
 */
export async function blendOriginalIdentity(
    originalBlob: Blob,
    aiBlob: Blob,
    blendOpacity: number = 0.15
): Promise<Blob> {
    // 1. Load images
    const originalImg = await createImageBitmap(originalBlob);
    const aiImg = await createImageBitmap(aiBlob);

    // 2. Create canvas (matching AI image dimensions)
    const canvas = new OffscreenCanvas(aiImg.width, aiImg.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("Canvas context failed");

    // 3. Draw AI base image
    ctx.drawImage(aiImg, 0, 0);

    // 4. Overlay original (core blending trick)
    // Note: Assumes Gemini has not drastically changed subject pose/position
    // If AI changed composition, direct overlay will cause ghosting artifacts.
    // This technique only works for "Magic Fix" (quality/lighting), not major pose changes.

    ctx.globalAlpha = blendOpacity; // Set opacity
    // Stretch original to match AI image dimensions (assuming AI preserved aspect ratio)
    ctx.drawImage(originalImg, 0, 0, aiImg.width, aiImg.height);

    // 5. Reset alpha
    ctx.globalAlpha = 1.0;

    // 6. (Optional) Could add a sharpening filter for face restoration

    // 7. Output
    return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
}
