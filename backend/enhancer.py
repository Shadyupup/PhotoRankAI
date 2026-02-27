"""
Professional auto-enhancement module using Pillow.
Applies: Auto Levels, CLAHE, Auto White Balance, Sharpening, Saturation Boost.
"""
from __future__ import annotations

import io
import numpy as np
from PIL import Image, ImageEnhance, ImageFilter


def auto_levels(img: Image.Image) -> Image.Image:
    """Stretch histogram to full 0-255 range per channel (auto levels)."""
    arr = np.array(img, dtype=np.float32)
    for c in range(3):
        ch = arr[:, :, c]
        lo, hi = np.percentile(ch, [1, 99])
        if hi - lo < 1:
            continue
        arr[:, :, c] = np.clip((ch - lo) * 255.0 / (hi - lo), 0, 255)
    return Image.fromarray(arr.astype(np.uint8))


def adaptive_contrast(img: Image.Image, strength: float = 1.3) -> Image.Image:
    """
    Enhance local contrast without tile artifacts.
    Uses Pillow's autocontrast (clips 1% of histogram extremes)
    blended with a mild contrast boost.
    """
    from PIL import ImageOps
    # Auto contrast: clips 1% darkest and brightest pixels
    auto = ImageOps.autocontrast(img, cutoff=1)
    # Additional mild contrast boost
    enhanced = ImageEnhance.Contrast(auto).enhance(strength)
    return enhanced


def smart_white_balance(img: Image.Image) -> Image.Image:
    """
    Intelligent white balance that preserves natural scene color tones.
    
    Strategy:
    1. Estimate color temperature from channel averages
    2. If the image looks like a natural cold scene (blue sky, snow, ice)
       or natural warm scene (sunset, golden hour) → skip correction
    3. Only correct genuine color casts (heavy indoor tungsten, fluorescent green)
    """
    arr = np.array(img, dtype=np.float32)
    avg_r, avg_g, avg_b = arr[:, :, 0].mean(), arr[:, :, 1].mean(), arr[:, :, 2].mean()
    avg_all = (avg_r + avg_g + avg_b) / 3.0
    
    if avg_all < 1:
        return img
    
    # Compute channel deviation from neutral gray (normalized)
    dev_r = (avg_r - avg_all) / avg_all  # positive = warm, negative = cool
    dev_b = (avg_b - avg_all) / avg_all  # positive = cool, negative = warm
    dev_g = (avg_g - avg_all) / avg_all  # positive = green cast
    
    # Determine if this looks like a natural color temperature
    # Natural cold scenes: blue > red, moderate deviation (< 15%)
    is_natural_cool = dev_b > 0 and dev_b < 0.15  # Slight blue = natural cold
    # Natural warm scenes: red > blue, moderate deviation (< 15%) 
    is_natural_warm = dev_r > 0 and dev_r < 0.15  # Slight warm = golden hour
    
    if is_natural_cool or is_natural_warm:
        # Scene has natural color temperature — don't "correct" it
        return img
    
    # Only correct abnormal casts (> 15% deviation)
    # Heavy green cast (fluorescent lighting)
    # Heavy yellow/orange (tungsten indoor)
    scale = avg_all / np.maximum(np.array([avg_r, avg_g, avg_b]), 1.0)
    # Very conservative correction: only fix 50% of the cast
    scale = 1.0 + (scale - 1.0) * 0.5
    # Strict limits
    scale = np.clip(scale, 0.9, 1.1)
    
    arr[:, :, 0] = np.clip(arr[:, :, 0] * scale[0], 0, 255)
    arr[:, :, 1] = np.clip(arr[:, :, 1] * scale[1], 0, 255)
    arr[:, :, 2] = np.clip(arr[:, :, 2] * scale[2], 0, 255)
    
    return Image.fromarray(arr.astype(np.uint8))


def sharpen(img: Image.Image, amount: float = 1.3) -> Image.Image:
    """Apply unsharp mask sharpening."""
    return ImageEnhance.Sharpness(img).enhance(amount)


def boost_saturation(img: Image.Image, factor: float = 1.1) -> Image.Image:
    """Slightly boost color saturation."""
    return ImageEnhance.Color(img).enhance(factor)


def auto_enhance(image_bytes: bytes, quality: int = 92) -> bytes:
    """
    Apply full auto-enhancement pipeline to image bytes.
    Returns enhanced JPEG bytes.
    
    Pipeline:
    1. Auto Levels (histogram stretch)
    2. CLAHE (adaptive contrast)
    3. Auto White Balance (gray world)
    4. Sharpening (unsharp mask)
    5. Saturation Boost
    """
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    
    # Pipeline
    img = auto_levels(img)
    img = adaptive_contrast(img)
    img = smart_white_balance(img)
    img = sharpen(img, amount=1.3)
    img = boost_saturation(img, factor=1.1)
    
    # Encode
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality, subsampling=0)
    return buf.getvalue()
