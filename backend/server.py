"""
FastAPI server for local AI photo scoring.
Replaces Gemini API calls with local NIMA + CLIP models.
"""
from __future__ import annotations

import logging
import os
import time
from contextlib import asynccontextmanager

import io
from typing import List, Optional

from fastapi import FastAPI, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

import rawpy

from scorer import CombinedScorer, load_image_from_bytes

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger(__name__)

# --- Security: Path validation ---
ALLOWED_IMAGE_EXTENSIONS = {
    '.jpg', '.jpeg', '.png', '.webp', '.avif', '.tiff', '.tif', '.bmp',
    '.cr2', '.cr3', '.nef', '.arw', '.dng', '.raf', '.orf', '.rw2',
}

def _validate_image_path(path: str) -> str | None:
    """
    Validate that a path points to a real image file.
    Returns an error message if invalid, None if OK.
    """
    # Resolve symlinks and normalize to prevent path traversal
    resolved = os.path.realpath(path)
    if not os.path.isfile(resolved):
        return f"File not found: {path}"
    ext = os.path.splitext(resolved)[1].lower()
    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        return f"Not an allowed image type: {ext}"
    return None

# Global scorer instance
scorer: Optional[CombinedScorer] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load models on startup."""
    global scorer
    logger.info("Loading AI scoring models...")
    start = time.time()
    scorer = CombinedScorer()
    elapsed = time.time() - start
    logger.info(f"Models loaded in {elapsed:.1f}s")
    yield
    logger.info("Shutting down scorer...")
    scorer = None


app = FastAPI(
    title="PhotoRank Local Scorer",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS: Allow Vite dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {
        "status": "ok",
        "models_loaded": scorer is not None,
    }


@app.post("/api/score")
async def score_photos(
    file_ids: List[str] = Form(...),
    files: Optional[List[UploadFile]] = File(None),
    file_paths: Optional[List[str]] = Form(None),
):
    """
    Score multiple photos using local AI models.

    Accepts multipart/form-data with:
    - file_ids: list of corresponding file IDs
    - files: (Optional) list of image file blobs
    - file_paths: (Optional) list of absolute file paths

    If file_paths are provided, the backend reads directly from disk, bypassing HTTP blob transfer.
    """
    if scorer is None:
        return JSONResponse(
            status_code=503,
            content={"error": "Models not loaded yet. Please wait."}
        )

    # Validate inputs
    use_paths = file_paths is not None and len(file_paths) > 0
    use_blobs = files is not None and len(files) > 0

    if not use_paths and not use_blobs:
         return JSONResponse(
            status_code=400,
            content={"error": "Must provide either 'files' or 'file_paths'"}
        )

    if use_blobs and len(files) != len(file_ids):
        return JSONResponse(
            status_code=400,
            content={"error": f"Mismatch: {len(files)} files vs {len(file_ids)} IDs"}
        )
        
    if use_paths and len(file_paths) != len(file_ids):
        return JSONResponse(
            status_code=400,
            content={"error": f"Mismatch: {len(file_paths)} file_paths vs {len(file_ids)} IDs"}
        )

    logger.info(f"Scoring {len(file_ids)} photos (via {'paths' if use_paths else 'blobs'})")
    start = time.time()

    # Load images
    images = []
    
    if use_paths:
        from PIL import Image
        for file_path, file_id in zip(file_paths, file_ids):
            try:
                # Validate path before reading
                path_err = _validate_image_path(file_path)
                if path_err:
                    logger.error(f"Path validation failed for {file_path}: {path_err}")
                    images.append(None)
                    continue
                image = Image.open(file_path).convert('RGB')
                images.append((file_id, image))
            except Exception as e:
                logger.error(f"Failed to load image from path {file_path}: {e}")
                images.append(None)
    else:
        for file, file_id in zip(files, file_ids):
            try:
                data = await file.read()
                image = load_image_from_bytes(data)
                images.append((file_id, image))
            except Exception as e:
                logger.error(f"Failed to load image blob {file_id}: {e}")
                images.append(None)

    # Filter out failed loads
    valid_images = [(fid, img) for fid, img in images if img is not None]
    failed_ids = [file_ids[i] for i, item in enumerate(images) if item is None]

    # Score valid images
    results = scorer.score_batch(valid_images) if valid_images else []

    # Add error results for failed loads
    for fid in failed_ids:
        results.append({
            "file_id": fid,
            "score": 5.0,
            "reason": "Failed to load image",
        })

    elapsed = time.time() - start
    count = len(file_ids)
    logger.info(f"Scored {count} photos in {elapsed:.1f}s ({elapsed/max(count,1)*1000:.0f}ms/photo)")

    return {"results": results}


@app.get("/api/preview")
async def get_preview(path: str):
    """
    Serve an image file for preview.
    - For regular images (JPG, PNG, WEBP): serve directly from disk.
    - For RAW files (CR2, CR3, NEF, ARW, DNG, RAF): extract embedded JPEG preview.
    """
    err = _validate_image_path(path)
    if err:
        return JSONResponse(status_code=400, content={"error": err})

    # Check if it's a RAW file
    raw_extensions = {'.cr2', '.cr3', '.nef', '.arw', '.dng', '.raf', '.orf', '.rw2'}
    ext = os.path.splitext(path)[1].lower()

    if ext not in raw_extensions:
        # Regular image — serve directly from disk
        import mimetypes
        mime_type = mimetypes.guess_type(path)[0] or 'image/jpeg'
        from starlette.responses import FileResponse
        return FileResponse(path, media_type=mime_type)

    # RAW file — extract embedded preview
    try:
        with rawpy.imread(path) as raw:
            try:
                thumb = raw.extract_thumb()
                if thumb.format == rawpy.ThumbFormat.JPEG:
                    return Response(content=thumb.data, media_type="image/jpeg")
            except rawpy.LibRawNoThumbnailError:
                pass
            
            # Fallback: decode the raw image
            rgb = raw.postprocess(half_size=True, use_camera_wb=True)
            from PIL import Image
            import io
            img = Image.fromarray(rgb)
            img.thumbnail((1920, 1920))
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=85)
            return Response(content=buf.getvalue(), media_type="image/jpeg")
    except Exception as e:
        logger.error(f"Failed to process RAW preview for {path}: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})



class ClusteringRequest(BaseModel):
    items: List[dict]  # expects {"id": str, "embedding": List[float]}
    threshold: float = 0.92  # Default cosine similarity threshold 

@app.post("/api/cluster")
async def cluster_photos(req: ClusteringRequest):
    """
    Groups visually identical photos (bursts) using their 768-D CLIP embeddings.
    Uses greedy cosine-similarity clustering.
    """
    import numpy as np
    
    items = req.items
    if not items:
        return {"clusters": []}
        
    try:
        embeddings = np.array([item["embedding"] for item in items])
        ids = [item["id"] for item in items]
        
        # Ensure L2 normalization
        norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
        norms[norms == 0] = 1
        embeddings = embeddings / norms
        
        # Compute similarity matrix (N x N)
        sim_matrix = embeddings @ embeddings.T
        
        # Greedy clustering
        n = len(items)
        visited = set()
        clusters = []
        
        for i in range(n):
            if i in visited:
                continue
            current_cluster = [ids[i]]
            visited.add(i)
            
            for j in range(i + 1, n):
                if j not in visited and float(sim_matrix[i, j]) >= req.threshold:
                    current_cluster.append(ids[j])
                    visited.add(j)
                    
            clusters.append(current_cluster)
            
        logger.info(f"Clustered {n} items into {len(clusters)} groups (Threshold: {req.threshold})")
        return {"clusters": clusters}
        
    except Exception as e:
        logger.error(f"Clustering failed: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8100, log_level="info")
