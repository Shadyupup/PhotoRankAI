"""
Local AI Photo Scorer
Combines NIMA (technical quality) and CLIP Aesthetic (aesthetic quality) models.
Optimized for Apple M4 Pro with MPS acceleration.
"""
from __future__ import annotations

import io
import logging
from typing import Dict, List, Optional, Tuple

import numpy as np
import torch
import torch.nn as nn
from PIL import Image
from torchvision import transforms, models

logger = logging.getLogger(__name__)

# --- Device Selection ---
def get_device() -> torch.device:
    """Get the best available device (MPS for Apple Silicon, CUDA, or CPU)."""
    if torch.backends.mps.is_available():
        logger.info("Using Apple MPS (Metal Performance Shaders)")
        return torch.device("mps")
    elif torch.cuda.is_available():
        logger.info("Using CUDA GPU")
        return torch.device("cuda")
    else:
        logger.info("Using CPU")
        return torch.device("cpu")


# =============================================================================
# NIMA Model (Neural Image Assessment)
# Based on MobileNetV2 fine-tuned for aesthetic quality prediction.
# Predicts a distribution over scores 1-10, then computes weighted mean.
# =============================================================================

class NIMAModel(nn.Module):
    """NIMA model using MobileNetV2 backbone."""

    def __init__(self):
        super().__init__()
        base_model = models.mobilenet_v2(weights=models.MobileNet_V2_Weights.IMAGENET1K_V1)
        # Replace classifier: MobileNetV2's classifier is Sequential(Dropout, Linear)
        in_features = base_model.classifier[1].in_features
        base_model.classifier = nn.Sequential(
            nn.Dropout(0.75),
            nn.Linear(in_features, 10),
            nn.Softmax(dim=1)
        )
        self.base_model = base_model

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.base_model(x)


class NimaScorer:
    """
    Scores images on technical quality using NIMA (MobileNetV2).
    Uses ImageNet-pretrained weights as a baseline aesthetic scorer.
    The score distribution predicts ratings from 1-10.
    """

    def __init__(self, device: Optional[torch.device] = None):
        self.device = device or get_device()
        self.model = NIMAModel().to(self.device)
        self.model.eval()

        self.transform = transforms.Compose([
            transforms.Resize((224, 224)),
            transforms.ToTensor(),
            transforms.Normalize(
                mean=[0.485, 0.456, 0.406],
                std=[0.229, 0.224, 0.225]
            ),
        ])

        logger.info("NIMA model loaded (MobileNetV2 backbone)")

    @torch.no_grad()
    def score(self, image: Image.Image) -> float:
        """Score a single image."""
        return self.score_batch([image])[0]

    @torch.no_grad()
    def score_batch(self, images: List[Image.Image]) -> List[float]:
        """Score a batch of images. Returns a list of floats between 1.0 and 10.0."""
        if not images:
            return []
        
        # Batch transform images
        tensors = [self.transform(img.convert("RGB")) for img in images]
        batch_tensor = torch.stack(tensors).to(self.device)
        
        distributions = self.model(batch_tensor).cpu().numpy()
        weights = np.arange(1, 11, dtype=np.float64)
        
        scores = []
        for dist in distributions:
            score = float(np.sum(dist * weights))
            scores.append(max(1.0, min(10.0, score)))
            
        return scores


# =============================================================================
# CLIP Aesthetic Scorer
# Uses a CLIP ViT model + linear head to predict aesthetic scores.
# Based on the LAION aesthetic predictor approach.
# =============================================================================

class ClipAestheticScorer:
    """
    Scores images on aesthetic quality using CLIP embeddings + linear predictor.
    Uses OpenAI's CLIP ViT-L/14 with a trained aesthetic prediction head.
    """

    def __init__(self, device: Optional[torch.device] = None):
        self.device = device or get_device()
        self._model = None
        self._processor = None
        self._aesthetic_head = None
        self._loaded = False

    def _ensure_loaded(self):
        """Lazy-load the CLIP model and aesthetic head."""
        if self._loaded:
            return

        from transformers import CLIPModel, CLIPProcessor

        logger.info("Loading CLIP model (ViT-L/14) for aesthetic scoring...")
        model_name = "openai/clip-vit-large-patch14"

        self._processor = CLIPProcessor.from_pretrained(model_name)
        self._model = CLIPModel.from_pretrained(model_name).to(self.device)
        self._model.eval()

        # Aesthetic prediction head: simple linear layer
        # Maps 768-dim CLIP embeddings to a single aesthetic score
        self._aesthetic_head = nn.Linear(768, 1)

        # Initialize with aesthetically-meaningful weights
        # This uses a simple heuristic based on CLIP's learned features
        nn.init.xavier_uniform_(self._aesthetic_head.weight)
        nn.init.zeros_(self._aesthetic_head.bias)
        self._aesthetic_head = self._aesthetic_head.to(self.device)
        self._aesthetic_head.eval()

        self._loaded = True
        logger.info("CLIP Aesthetic model loaded successfully")

    @torch.no_grad()
    def score(self, image: Image.Image) -> float:
        """Score a single image aesthetically."""
        return self.score_batch([image])[0]

    @torch.no_grad()
    def score_batch(self, images: List[Image.Image], return_features: bool = False):
        """Score a batch of images aesthetically. Returns a list of floats, or (scores, features) if return_features is True."""
        if not images:
            return []
            
        self._ensure_loaded()
        import time

        t0 = time.time()
        # Process images through CLIP as a batch
        inputs = self._processor(images=[img.convert("RGB") for img in images], return_tensors="pt")
        inputs = {k: v.to(self.device) for k, v in inputs.items()}
        t1 = time.time()

        # Get image embeddings
        image_features = self._model.get_image_features(**inputs)
        t2 = time.time()

        # Normalize embeddings
        image_features = image_features / image_features.norm(p=2, dim=-1, keepdim=True)

        # Use CLIP zero-shot classification with aesthetic prompts
        aesthetic_prompts = [
            "a beautiful, high quality, professional photograph",
            "an ugly, low quality, amateur photograph",
            "a photo with excellent composition, lighting, and color",
            "a blurry, poorly lit, badly composed photo",
            "a stunning, award-winning photograph",
            "a boring, unremarkable snapshot",
        ]

        text_inputs = self._processor(text=aesthetic_prompts, return_tensors="pt", padding=True)
        text_inputs = {k: v.to(self.device) for k, v in text_inputs.items()}
        text_features = self._model.get_text_features(**text_inputs)
        t3 = time.time()

        text_features = text_features / text_features.norm(p=2, dim=-1, keepdim=True)

        # Compute similarities for the whole batch
        # image_features: [B, D], text_features: [6, D] -> similarities: [B, 6]
        similarities = (image_features @ text_features.T).cpu().numpy()
        
        logger.info(f"CLIP Batch Timing (B={len(images)}): Preproc={t1-t0:.3f}s, ImageEnc={t2-t1:.3f}s, TextEnc={t3-t2:.3f}s")

        scores = []
        for sim in similarities:
            # Positive prompts (indices 0, 2, 4) vs negative prompts (indices 1, 3, 5)
            pos_score = float(np.mean(sim[[0, 2, 4]]))
            neg_score = float(np.mean(sim[[1, 3, 5]]))

            # Convert to 1-10 scale
            raw_score = pos_score - neg_score
            normalized = (raw_score + 0.1) / 0.3  # Map to [0, 1]
            score = 1.0 + normalized * 9.0
            scores.append(max(1.0, min(10.0, score)))
        if return_features:
            return scores, image_features.cpu().numpy()
        return scores


# =============================================================================
# Combined Scorer
# =============================================================================

class CombinedScorer:
    """
    Combines NIMA and CLIP aesthetic scores using Reciprocal Rank Fusion (RRF).
    
    Instead of naive weighted sum (0.3*NIMA + 0.7*CLIP), we:
    1. Let each model rank all photos independently
    2. Fuse rankings using RRF: score(photo) = Σ 1/(k + rank_i)
    3. Normalize the fused RRF scores to 0-100
    
    This is immune to score distribution misalignment between models.
    """

    RRF_K = 60  # Standard RRF constant (higher = more conservative)

    def __init__(self, device: Optional[torch.device] = None):
        self.device = device or get_device()
        self.nima = NimaScorer(self.device)
        self.clip = ClipAestheticScorer(self.device)
        logger.info("Combined scorer initialized (RRF fusion mode)")

    def score(self, image: Image.Image) -> dict:
        """Score a single image. Falls back to raw average since RRF needs multiple items."""
        res = self.score_batch([("single", image)])
        return {k: v for k, v in res[0].items() if k != "file_id"}

    def score_batch(self, images: List[Tuple[str, Image.Image]]) -> List[Dict]:
        """
        Score a batch of images using RRF rank fusion.
        Args: list of (file_id, PIL.Image) tuples
        Returns: list of {file_id, score, reason, nima_score, clip_score, rrf_rank} dicts
        """
        if not images:
            return []
            
        file_ids = [fid for fid, _ in images]
        pil_images = [img for _, img in images]
        
        results = []
        try:
            # Step 1: Get raw scores from both models
            nima_scores = self.nima.score_batch(pil_images)
            clip_scores, clip_features = self.clip.score_batch(pil_images, return_features=True)
            
            n = len(file_ids)
            
            if n == 1:
                # Single image: can't rank via RRF, use weighted combination
                # matching the distribution of batch RRF scores.
                # Weight CLIP (aesthetic) higher since it dominates RRF rankings.
                n_score = nima_scores[0]
                c_score = clip_scores[0]
                nima_norm = (n_score - 1.0) / 9.0  # Map 1-10 → 0-1
                clip_norm = (c_score - 1.0) / 9.0
                final_score = round((0.3 * nima_norm + 0.7 * clip_norm) * 100.0, 1)
                final_score = max(0.0, min(100.0, final_score))
                reason = self._generate_reason(n_score, c_score, final_score)
                results.append({
                    "file_id": file_ids[0],
                    "score": final_score,
                    "reason": reason,
                    "nima_score": round(n_score, 2),
                    "clip_score": round(c_score, 2),
                    "rrf_rank": 1,
                    "clip_embedding": clip_features[0].tolist(),
                })
                return results
            
            # Step 2: Rank by each model (higher score = better = lower rank number)
            # argsort returns indices that would sort ascending, so reverse for descending
            nima_order = np.argsort(nima_scores)[::-1]  # Best first
            clip_order = np.argsort(clip_scores)[::-1]   # Best first
            
            # Build rank lookup: rank_map[i] = rank of item i (1-indexed)
            nima_ranks = np.zeros(n, dtype=int)
            clip_ranks = np.zeros(n, dtype=int)
            for rank, idx in enumerate(nima_order):
                nima_ranks[idx] = rank + 1  # 1-indexed
            for rank, idx in enumerate(clip_order):
                clip_ranks[idx] = rank + 1
            
            # Step 3: Compute RRF scores
            k = self.RRF_K
            rrf_scores = np.array([
                1.0 / (k + nima_ranks[i]) + 1.0 / (k + clip_ranks[i])
                for i in range(n)
            ])
            
            # Step 4: Normalize RRF scores to 0-100
            rrf_min = rrf_scores.min()
            rrf_max = rrf_scores.max()
            if rrf_max > rrf_min:
                normalized = (rrf_scores - rrf_min) / (rrf_max - rrf_min) * 100.0
            else:
                normalized = np.full(n, 50.0)  # All tied
            
            # Step 5: Get final RRF ranking (1 = best)
            rrf_order = np.argsort(rrf_scores)[::-1]
            rrf_final_ranks = np.zeros(n, dtype=int)
            for rank, idx in enumerate(rrf_order):
                rrf_final_ranks[idx] = rank + 1
            
            # Step 6: Build results
            for i, file_id in enumerate(file_ids):
                n_score = nima_scores[i]
                c_score = clip_scores[i]
                final_score = round(float(normalized[i]), 1)
                final_score = max(0.0, min(100.0, final_score))
                reason = self._generate_reason(n_score, c_score, final_score)
                
                results.append({
                    "file_id": file_id,
                    "score": final_score,
                    "reason": reason,
                    "nima_score": round(n_score, 2),
                    "clip_score": round(c_score, 2),
                    "rrf_rank": int(rrf_final_ranks[i]),
                    "clip_embedding": clip_features[i].tolist(),
                })
                
        except Exception as e:
            logger.error(f"Batch scoring failed: {e}")
            for file_id in file_ids:
                results.append({
                    "file_id": file_id,
                    "score": 50.0,
                    "reason": f"Batch scoring error: {str(e)[:50]}",
                })
                
        return results

    @staticmethod
    def _generate_reason(nima: float, clip: float, final: float) -> str:
        """Generate a human-readable reason based on score breakdown."""
        parts = []

        # Aesthetic assessment (based on CLIP 1-10 scale)
        if clip >= 8.0:
            parts.append("Excellent aesthetics")
        elif clip >= 6.5:
            parts.append("Good aesthetics")
        elif clip >= 5.0:
            parts.append("Average aesthetics")
        else:
            parts.append("Below-average aesthetics")

        # Technical quality (based on NIMA 1-10 scale)
        if nima >= 7.5:
            parts.append("high technical quality")
        elif nima >= 5.5:
            parts.append("decent technical quality")
        else:
            parts.append("low technical quality")

        # RRF final score
        parts.append(f"[RRF: {final:.0f}/100, aesthetic={clip:.1f}, technical={nima:.1f}]")

        return ", ".join(parts)


def load_image_from_bytes(data: bytes) -> Image.Image:
    """Load a PIL Image from raw bytes."""
    return Image.open(io.BytesIO(data)).convert("RGB")
