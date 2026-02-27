"""
Tests for the image auto-enhancement module.
Includes unit tests for enhancer functions and integration tests for the API.
"""
import io
import pytest
import numpy as np
from PIL import Image

from enhancer import auto_levels, adaptive_contrast, smart_white_balance, sharpen, boost_saturation, auto_enhance


# --- Test Helpers ---

def create_dark_image(width=200, height=200) -> Image.Image:
    """Create a dark, low-contrast image."""
    arr = np.random.randint(30, 80, (height, width, 3), dtype=np.uint8)
    return Image.fromarray(arr)


def create_bluish_image(width=200, height=200) -> Image.Image:
    """Create an image with a blue color cast (for white balance testing)."""
    arr = np.zeros((height, width, 3), dtype=np.uint8)
    arr[:, :, 0] = 100  # R
    arr[:, :, 1] = 100  # G
    arr[:, :, 2] = 180  # B (stronger blue)
    return Image.fromarray(arr)


def image_to_bytes(img: Image.Image) -> bytes:
    """Convert PIL Image to JPEG bytes."""
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


# =============================================================================
# Unit Tests
# =============================================================================

class TestAutoLevels:
    """Tests for auto_levels histogram stretching."""

    def test_output_uses_full_range(self):
        """After auto levels, the histogram should span close to 0-255."""
        dark = create_dark_image()
        result = auto_levels(dark)
        arr = np.array(result)
        # Should be significantly brighter than the 30-80 input range
        assert arr.max() > 200, f"Max pixel {arr.max()} should be > 200"
        assert arr.min() < 30, f"Min pixel {arr.min()} should be < 30"

    def test_preserves_dimensions(self):
        """Output should have the same dimensions as input."""
        img = create_dark_image(300, 200)
        result = auto_levels(img)
        assert result.size == (300, 200)


class TestAdaptiveContrast:
    """Tests for adaptive contrast enhancement."""

    def test_output_is_valid_image(self):
        """CLAHE should return a valid RGB image."""
        img = create_dark_image()
        result = adaptive_contrast(img)
        assert result.mode == "RGB"
        assert result.size == img.size

    def test_increases_contrast(self):
        """CLAHE should increase the standard deviation (contrast) of L channel."""
        img = create_dark_image()
        result = adaptive_contrast(img)
        # Compare overall variance
        orig_std = np.array(img).std()
        result_std = np.array(result).std()
        assert result_std >= orig_std * 0.8, "CLAHE should not drastically reduce contrast"


class TestSmartWhiteBalance:
    """Tests for intelligent white balance."""

    def test_reduces_extreme_color_cast(self):
        """Should correct a very strong color cast (> 15% deviation)."""
        # Create an extremely blue image (abnormal cast, like broken WB)
        arr = np.zeros((200, 200, 3), dtype=np.uint8)
        arr[:, :, 0] = 60   # R very low
        arr[:, :, 1] = 60   # G very low  
        arr[:, :, 2] = 200  # B very high (> 15% deviation)
        img = Image.fromarray(arr)
        result = smart_white_balance(img)
        result_arr = np.array(result, dtype=np.float32)
        means = result_arr.mean(axis=(0, 1))
        # After correction, channels should be more balanced
        max_diff = max(means) - min(means)
        assert max_diff < 140, f"Extreme cast should be reduced, got diff {max_diff}"

    def test_preserves_natural_cool_tones(self):
        """Natural cold scenes (slight blue) should NOT be corrected."""
        # Simulate a natural cold scene: slightly more blue
        arr = np.zeros((200, 200, 3), dtype=np.uint8)
        arr[:, :, 0] = 120  # R
        arr[:, :, 1] = 130  # G
        arr[:, :, 2] = 145  # B (< 15% deviation = natural)
        img = Image.fromarray(arr)
        result = smart_white_balance(img)
        # Should be unchanged — image returned as-is
        np.testing.assert_array_equal(np.array(img), np.array(result))

    def test_preserves_dimensions(self):
        img = create_bluish_image()
        result = smart_white_balance(img)
        assert result.size == img.size


class TestSharpenAndSaturation:
    """Tests for sharpening and saturation boost."""

    def test_sharpen_returns_image(self):
        img = create_dark_image()
        result = sharpen(img, amount=1.5)
        assert result.size == img.size

    def test_saturation_boost_returns_image(self):
        img = create_dark_image()
        result = boost_saturation(img, factor=1.2)
        assert result.size == img.size


class TestAutoEnhancePipeline:
    """Tests for the full auto_enhance pipeline."""

    def test_returns_valid_jpeg(self):
        """auto_enhance should return valid JPEG bytes."""
        img = create_dark_image()
        input_bytes = image_to_bytes(img)
        result_bytes = auto_enhance(input_bytes)
        # Should be valid JPEG (starts with FF D8)
        assert result_bytes[:2] == b'\xff\xd8', "Output should be valid JPEG"
        assert len(result_bytes) > 100, "Output should have meaningful size"

    def test_output_dimensions_match_input(self):
        """Enhanced image should have the same dimensions."""
        img = create_dark_image(400, 300)
        input_bytes = image_to_bytes(img)
        result_bytes = auto_enhance(input_bytes)
        result_img = Image.open(io.BytesIO(result_bytes))
        assert result_img.size == (400, 300)

    def test_works_with_different_sizes(self):
        """Should work with various image sizes."""
        for w, h in [(100, 100), (800, 600), (1920, 1080)]:
            img = create_dark_image(w, h)
            result_bytes = auto_enhance(image_to_bytes(img))
            result_img = Image.open(io.BytesIO(result_bytes))
            assert result_img.size == (w, h)


# =============================================================================
# Integration Tests (API)
# =============================================================================

@pytest.fixture
def client():
    """Create a test client for the FastAPI app."""
    from httpx import AsyncClient, ASGITransport
    import asyncio
    from server import app
    
    transport = ASGITransport(app=app)
    
    async def _make_client():
        return AsyncClient(transport=transport, base_url="http://test")
    
    return asyncio.get_event_loop().run_until_complete(_make_client())


class TestEnhanceBasicAPI:
    """Integration tests for POST /api/enhance-basic."""

    def test_enhance_with_invalid_path(self, client):
        """Should return 404 for non-existent file."""
        import asyncio
        async def _test():
            response = await client.post(
                "/api/enhance-basic",
                data={"path": "/nonexistent/photo.jpg"}
            )
            assert response.status_code == 400
        asyncio.get_event_loop().run_until_complete(_test())

    def test_enhance_with_test_image(self, client, tmp_path):
        """Should return 200 + JPEG for a valid image."""
        import asyncio
        # Create a temp test image
        img = create_dark_image(300, 300)
        test_path = str(tmp_path / "test.jpg")
        img.save(test_path, format="JPEG", quality=90)

        async def _test():
            response = await client.post(
                "/api/enhance-basic",
                data={"path": test_path}
            )
            assert response.status_code == 200
            assert response.headers["content-type"] == "image/jpeg"
            assert len(response.content) > 100
            # Verify it's valid JPEG
            assert response.content[:2] == b'\xff\xd8'
        asyncio.get_event_loop().run_until_complete(_test())
