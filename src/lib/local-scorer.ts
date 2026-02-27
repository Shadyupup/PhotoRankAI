/**
 * AI Photo Scoring Gateway
 * Routes scoring requests to the selected engine:
 * - local-fast: Python backend (NIMA + CLIP with RRF fusion)
 * - local-fast+vlm: RRF rough ranking -> Qwen VLM re-ranking
 * - ollama: Pure Qwen VLM scoring
 * - gemini: Google Gemini Cloud API
 */

import { logger } from "./logger";
import { evaluatePhotoScore } from "./gemini";
import { analyzePhotosBatchOllama } from "./ollama";

export const LOCAL_SCORER_URL = import.meta.env.VITE_SCORER_URL || "http://localhost:8100";

export type AIEngine = 'gemini' | 'local-fast' | 'local-fast+vlm' | 'ollama';

/**
 * Route photos to the selected AI scoring engine.
 */
export async function analyzePhotosBatch(
    items: { id: string; blob?: Blob; path?: string }[],
    engine: AIEngine,
    signal?: AbortSignal
): Promise<{ file_id: string; score: number; reason: string; tags?: string[]; clip_embedding?: number[] }[]> {
    logger.info(`[Router] Using AI Engine: ${engine} for ${items.length} photos`);

    let analysisPromise: Promise<{ file_id: string; score: number; reason: string; tags?: string[]; clip_embedding?: number[] }[]>;

    switch (engine) {
        case 'gemini':
            // Wrap Gemini single processing into a batch
            analysisPromise = (async () => {
                const results = [];
                for (const item of items) {
                    if (signal?.aborted) throw new Error("Aborted");
                    if (!item.blob) throw new Error("Gemini requires Blob (path-only not supported)");
                    const res = await evaluatePhotoScore(item.blob);
                    results.push({ file_id: item.id, score: res.score, reason: res.reason });
                }
                return results;
            })();
            break;
        case 'ollama':
            const ollamaValid = items.filter(i => i.blob) as { id: string, blob: Blob }[];
            analysisPromise = analyzePhotosBatchOllama(ollamaValid, signal).then(results =>
                results.map(r => ({ ...r, score: parseFloat(String(r.score)) || 0, tags: r.tags || [] }))
            );
            break;
        case 'local-fast+vlm':
            // Two-stage pipeline: Stage 1 (RRF via local backend) → Stage 2 (VLM re-ranking)
            analysisPromise = (async () => {
                // Stage 1: Get RRF rough-rank scores from local backend
                logger.info(`[Router] Stage 1: RRF rough-ranking via local backend...`);
                const rrfResults = await analyzeViaLocalBackend(items, signal);

                // Stage 2: VLM re-ranking - re-score each photo with Qwen for semantic understanding
                logger.info(`[Router] Stage 2: VLM re-ranking via Ollama Qwen...`);
                const stage2Valid = items.filter(i => i.blob) as { id: string, blob: Blob }[];
                const vlmResults = await analyzePhotosBatchOllama(stage2Valid, signal);
                const vlmMap = new Map(vlmResults.map(r => [r.file_id, r]));

                // Merge: Use VLM score as the final score, but annotate with RRF context
                return rrfResults.map(rrf => {
                    const vlm = vlmMap.get(rrf.file_id);
                    if (vlm && parseFloat(String(vlm.score)) > 0) {
                        return {
                            file_id: rrf.file_id,
                            score: parseFloat(String(vlm.score)),
                            reason: `[VLM] ${vlm.reason} | [RRF rough: ${rrf.score.toFixed(0)}/100]`,
                            tags: vlm.tags || [],
                            clip_embedding: rrf.clip_embedding
                        };
                    }
                    // Fallback to RRF if VLM failed
                    return rrf;
                });
            })();
            break;
        case 'local-fast':
        default:
            analysisPromise = analyzeViaLocalBackend(items, signal);
            break;
    }

    return Promise.race([
        analysisPromise,
        new Promise<never>((_, reject) => {
            const timer = setTimeout(
                () => reject(new Error(`${engine} scoring timeout (10m)`)),
                600000
            );
            if (signal) {
                signal.addEventListener("abort", () => {
                    clearTimeout(timer);
                    reject(new Error("Analysis Aborted"));
                });
            }
        }),
    ]);
}

async function analyzeViaLocalBackend(
    items: { id: string; blob?: Blob; path?: string }[],
    signal?: AbortSignal
): Promise<{ file_id: string; score: number; reason: string; tags?: string[]; clip_embedding?: number[] }[]> {
    if (signal?.aborted) throw new Error("Aborted");

    const validItems = items.filter((i) => (i.blob && i.blob.size > 0) || i.path);
    if (validItems.length === 0)
        throw new Error("No valid image data or paths to analyze");

    // If all items run in a native environment with absolute paths, use paths.
    // Otherwise fallback to heavy blob transfer.
    const usePaths = validItems.every(i => !!i.path);

    // Build multipart form data
    const formData = new FormData();
    for (const item of validItems) {
        if (usePaths && item.path) {
            formData.append("file_paths", item.path);
            formData.append("file_ids", item.id);
        } else if (item.blob) {
            formData.append("files", item.blob, `${item.id}.jpg`);
            formData.append("file_ids", item.id);
        }
    }

    logger.info(
        `[Local Scorer] Sending ${validItems.length} images to ${LOCAL_SCORER_URL}/api/score...`
    );
    const start = Date.now();

    const response = await fetch(`${LOCAL_SCORER_URL}/api/score`, {
        method: "POST",
        body: formData,
        signal,
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        throw new Error(
            `Local scorer error (${response.status}): ${errorText}`
        );
    }

    const data = await response.json();

    if (!data.results || !Array.isArray(data.results)) {
        throw new Error("Invalid response structure from local scorer");
    }

    logger.info(
        `[Local Scorer] Scored ${validItems.length} photos in ${Date.now() - start}ms`
    );

    return data.results;
}

/**
 * Check if the local scoring backend is available.
 */
export async function checkScorerHealth(): Promise<boolean> {
    try {
        const response = await fetch(`${LOCAL_SCORER_URL}/health`, {
            signal: AbortSignal.timeout(3000),
        });
        if (!response.ok) return false;
        const data = await response.json();
        return data.status === "ok" && data.models_loaded === true;
    } catch {
        return false;
    }
}
