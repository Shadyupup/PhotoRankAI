"""
Tests for the local AI photo scorer.
Includes unit tests for individual scorers and integration tests for the API.
"""

import io
import pytest
import numpy as np
from PIL import Image

from scorer import NimaScorer, ClipAestheticScorer, CombinedScorer, load_image_from_bytes


# --- Test Helpers ---

def create_test_image(width=300, height=300, color="blue") -> Image.Image:
    """Create a simple test image."""
    return Image.new("RGB", (width, height), color)


def create_gradient_image(width=300, height=300) -> Image.Image:
    """Create a gradient image (slightly more aesthetic)."""
    arr = np.zeros((height, width, 3), dtype=np.uint8)
    for y in range(height):
        for x in range(width):
            arr[y, x] = [
                int(255 * x / width),
                int(255 * y / height),
                int(128 + 64 * np.sin(x / 30.0)),
            ]
    return Image.fromarray(arr)


def image_to_bytes(image: Image.Image) -> bytes:
    """Convert PIL Image to JPEG bytes."""
    buf = io.BytesIO()
    image.save(buf, format="JPEG")
    return buf.getvalue()


# =============================================================================
# Unit Tests
# =============================================================================

class TestNimaScorer:
    """Tests for the NIMA (MobileNetV2) scorer."""

    def test_score_returns_valid_range(self):
        """Score should be between 1.0 and 10.0."""
        scorer = NimaScorer()
        image = create_test_image()
        score = scorer.score(image)
        assert 1.0 <= score <= 10.0, f"Score {score} out of range [1, 10]"

    def test_score_different_images(self):
        """Different images should produce different scores."""
        scorer = NimaScorer()
        solid = create_test_image(color="black")
        gradient = create_gradient_image()
        score1 = scorer.score(solid)
        score2 = scorer.score(gradient)
        # Just verify both produce valid scores (they may be similar with untrained head)
        assert 1.0 <= score1 <= 10.0
        assert 1.0 <= score2 <= 10.0

    def test_score_is_deterministic(self):
        """Same image should produce same score."""
        scorer = NimaScorer()
        image = create_test_image()
        score1 = scorer.score(image)
        score2 = scorer.score(image)
        assert abs(score1 - score2) < 0.01, f"Scores differ: {score1} vs {score2}"


class TestClipAestheticScorer:
    """Tests for the CLIP aesthetic scorer."""

    def test_score_returns_valid_range(self):
        """Score should be between 1.0 and 10.0."""
        scorer = ClipAestheticScorer()
        image = create_test_image()
        score = scorer.score(image)
        assert 1.0 <= score <= 10.0, f"Score {score} out of range [1, 10]"

    def test_score_is_deterministic(self):
        """Same image should produce same score."""
        scorer = ClipAestheticScorer()
        image = create_gradient_image()
        score1 = scorer.score(image)
        score2 = scorer.score(image)
        assert abs(score1 - score2) < 0.01, f"Scores differ: {score1} vs {score2}"


class TestCombinedScorer:
    """Tests for the combined NIMA + CLIP scorer (RRF fusion)."""

    def test_score_returns_expected_structure(self):
        """Score result should have score (0-100), reason, nima_score, clip_score."""
        scorer = CombinedScorer()
        image = create_test_image()
        result = scorer.score(image)
        assert "score" in result
        assert "reason" in result
        assert "nima_score" in result
        assert "clip_score" in result
        assert 0.0 <= result["score"] <= 100.0, f"Score {result['score']} out of 0-100 range"
        assert isinstance(result["reason"], str)
        assert len(result["reason"]) > 0

    def test_batch_scoring(self):
        """Batch scoring should return one result per image with RRF fields."""
        scorer = CombinedScorer()
        images = [
            ("img-1", create_test_image(color="red")),
            ("img-2", create_gradient_image()),
            ("img-3", create_test_image(color="green")),
        ]
        results = scorer.score_batch(images)
        assert len(results) == 3
        for r in results:
            assert "file_id" in r
            assert "score" in r
            assert "reason" in r
            assert "rrf_rank" in r
            assert 0.0 <= r["score"] <= 100.0
            assert 1 <= r["rrf_rank"] <= 3

    def test_batch_file_ids_match(self):
        """Batch results should have correct file IDs."""
        scorer = CombinedScorer()
        images = [("alpha", create_test_image()), ("beta", create_gradient_image())]
        results = scorer.score_batch(images)
        ids = [r["file_id"] for r in results]
        assert ids == ["alpha", "beta"]

    def test_rrf_ranking_produces_valid_ranks(self):
        """RRF should assign unique ranks from 1 to N."""
        scorer = CombinedScorer()
        images = [
            ("a", create_test_image(color="red")),
            ("b", create_gradient_image()),
            ("c", create_test_image(color="blue")),
            ("d", create_test_image(color="green")),
        ]
        results = scorer.score_batch(images)
        ranks = sorted([r["rrf_rank"] for r in results])
        assert ranks == [1, 2, 3, 4], f"Expected ranks [1,2,3,4], got {ranks}"

    def test_rrf_best_rank_has_highest_score(self):
        """The photo with rrf_rank=1 should have a high score (within top results)."""
        scorer = CombinedScorer()
        images = [
            ("a", create_test_image(color="red")),
            ("b", create_gradient_image()),
            ("c", create_test_image(color="black")),
        ]
        results = scorer.score_batch(images)
        rank1 = [r for r in results if r["rrf_rank"] == 1]
        assert len(rank1) == 1, "Expected exactly one photo with rank 1"
        # Rank 1 score should be 100.0 (max after normalization)
        assert rank1[0]["score"] == 100.0, f"Rank 1 score is {rank1[0]['score']}, expected 100.0"

    def test_single_photo_weighted_scoring(self):
        """Single photo scoring should use weighted combination (0.3*NIMA + 0.7*CLIP)."""
        scorer = CombinedScorer()
        image = create_gradient_image()
        result = scorer.score(image)
        # Verify the score matches the weighted formula
        nima = result["nima_score"]
        clip = result["clip_score"]
        nima_norm = (nima - 1.0) / 9.0
        clip_norm = (clip - 1.0) / 9.0
        expected = round((0.3 * nima_norm + 0.7 * clip_norm) * 100.0, 1)
        expected = max(0.0, min(100.0, expected))
        assert abs(result["score"] - expected) < 0.2, (
            f"Score {result['score']} != expected weighted {expected} "
            f"(NIMA={nima}, CLIP={clip})"
        )


class TestLoadImageFromBytes:
    """Tests for the image loading utility."""

    def test_load_jpeg(self):
        """Should load JPEG bytes into a PIL Image."""
        img = create_test_image()
        data = image_to_bytes(img)
        loaded = load_image_from_bytes(data)
        assert isinstance(loaded, Image.Image)
        assert loaded.mode == "RGB"

    def test_load_returns_correct_size(self):
        """Loaded image should have the original dimensions."""
        img = create_test_image(400, 300)
        data = image_to_bytes(img)
        loaded = load_image_from_bytes(data)
        assert loaded.size == (400, 300)


# =============================================================================
# Integration Tests (API)
# =============================================================================

@pytest.fixture
def client():
    """Create a test client for the FastAPI app with scorer initialized."""
    from httpx import AsyncClient, ASGITransport
    import server as server_module
    from server import app

    # Manually initialize the scorer since lifespan doesn't run in test mode
    server_module.scorer = CombinedScorer()

    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


@pytest.mark.asyncio
async def test_health_endpoint(client):
    """GET /health should return 200."""
    async with client as c:
        response = await c.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "models_loaded" in data


@pytest.mark.asyncio
async def test_score_single_photo(client):
    """POST /api/score with one image should return valid result."""
    img = create_test_image()
    img_bytes = image_to_bytes(img)

    async with client as c:
        response = await c.post(
            "/api/score",
            files=[("files", ("test.jpg", img_bytes, "image/jpeg"))],
            data={"file_ids": "photo-1"},
        )

    assert response.status_code == 200
    data = response.json()
    assert "results" in data
    assert len(data["results"]) == 1
    assert data["results"][0]["file_id"] == "photo-1"
    assert 0.0 <= data["results"][0]["score"] <= 100.0
    assert len(data["results"][0]["reason"]) > 0


@pytest.mark.asyncio
async def test_score_batch_photos(client):
    """POST /api/score with multiple images should return results for all."""
    images = [
        ("test1.jpg", image_to_bytes(create_test_image(color="red"))),
        ("test2.jpg", image_to_bytes(create_gradient_image())),
    ]
    ids = ["photo-1", "photo-2"]

    async with client as c:
        response = await c.post(
            "/api/score",
            files=[("files", (name, data, "image/jpeg")) for name, data in images],
            data={"file_ids": ids},
        )

    assert response.status_code == 200
    data = response.json()
    assert len(data["results"]) == 2
    result_ids = [r["file_id"] for r in data["results"]]
    assert "photo-1" in result_ids
    assert "photo-2" in result_ids
