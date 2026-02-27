import { logger } from './logger';

export interface OllamaScoreResult {
    file_id: string;
    score: number | string;
    reason: string;
    tags?: string[]; // Phase 5 RAG semantic retrieval
}

const OLLAMA_URL = import.meta.env.VITE_OLLAMA_URL || 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'qwen2.5vl:latest';

/**
 * Coverts a Blob to a base64 string
 */
function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            // FileReader results look like "data:image/jpeg;base64,/9j/4AAQSkZJRg..."
            // We only want the base64 part for Ollama
            if (typeof reader.result === 'string') {
                const base64Data = reader.result.split(',')[1];
                resolve(base64Data);
            } else {
                reject(new Error("Failed to convert blob to base64"));
            }
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/**
 * Score a single photo using Ollama VLM
 */
export async function scorePhotoOllama(item: { id: string, blob: Blob }, model = DEFAULT_MODEL): Promise<OllamaScoreResult> {
    try {
        const base64Image = await blobToBase64(item.blob);

        const prompt = `You are an expert photography judge. Evaluate this image and give it a score from 0 to 100.
0 is a complete failure (blurry, pitch black, garbage).
100 is an absolute masterpiece (perfect lighting, focus, composition, aesthetics).
Pay attention to:
- Lighting and Exposure
- Focus and Sharpness
- Composition and Framing
- Color harmony and mood
- Subject interest and storytelling

Respond WITH STRICT JSON ONLY. Do not use Markdown block tags. The format must be exactly:
{
  "score": 75,
  "reason": "Brief explanation of your score",
  "tags": ["portrait", "outdoor", "sunset", "smile"]
}`;

        logger.info(`Sending image ${item.id} to Ollama model ${model}...`);

        const response = await fetch(`${OLLAMA_URL}/api/generate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: model,
                prompt: prompt,
                images: [base64Image],
                stream: false,
                format: "json", // Force JSON mode if model supports it
                options: {
                    temperature: 0.1 // Keep it deterministic
                }
            }),
        });

        if (!response.ok) {
            throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        let score: number | string = 0;
        let reason = "Fallback reason";
        let tags: string[] = [];

        if (data.response) {
            try {
                // Ollama sometimes wraps json in markdown ```json
                const textFormat = data.response.replace(/```json/g, "").replace(/```/g, "").trim();
                const parsed = JSON.parse(textFormat);
                score = parsed.score || 0;
                reason = parsed.reason || "No reason parsed";
                tags = parsed.tags || [];
            } catch (parseError) {
                logger.warn(`Failed to parse Ollama JSON response: ${data.response}`, parseError);
                // Fallback to a mock result if JSON parsing strictly fails
                return { file_id: item.id, score: 50, reason: `Failed to parse Ollama response: ${data.response}`, tags: [] };
            }
        }

        return { file_id: item.id, score, reason, tags };
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw error; // Re-throw aborts
        }
        logger.error(`Ollama scoring failed for ${item.id}`, error);
        return {
            file_id: item.id,
            score: 0,
            reason: `Ollama failed: ${error instanceof Error ? error.message : String(error)}`
        };
    }
}

/**
 * Batch analysis for Ollama (Runs concurrently for the batch)
 */
export async function analyzePhotosBatchOllama(
    items: { id: string; blob: Blob }[],
    signal?: AbortSignal
): Promise<OllamaScoreResult[]> {
    if (signal?.aborted) throw new Error("Aborted");

    const validItems = items.filter((i) => i.blob.size > 0);
    if (validItems.length === 0)
        throw new Error("No valid image data to analyze");

    logger.info(`[Ollama] Processing batch of ${validItems.length} photos...`);
    const start = Date.now();

    const promises = validItems.map(item => {
        return scorePhotoOllama(item).then(res => {
            if (signal?.aborted) throw new Error("Aborted");
            return res;
        });
    });

    try {
        const results = await Promise.all(promises);
        logger.info(`[Ollama] Scored ${validItems.length} photos in ${(Date.now() - start) / 1000}s`);
        return results;
    } catch (e) {
        if (signal?.aborted) throw new Error("Aborted");
        throw e;
    }
}

/**
 * Classify a single photo against keywords using Ollama VLM.
 * Returns true if the photo matches the keywords.
 */
export async function classifyPhoto(
    blob: Blob,
    keywords: string,
    model = DEFAULT_MODEL
): Promise<boolean> {
    try {
        const base64Image = await blobToBase64(blob);

        const prompt = `Look at this image carefully. Does this image contain or depict: "${keywords}"?
(Note: the keyword might be in a different language like Chinese. If so, translate it to English conceptually first, for example '企鹅' means 'penguin', '猫' means 'cat').

Answer with STRICT JSON ONLY. No markdown block tags.
{
  "match": true,
  "reason": "brief explanation"
}
or
{
  "match": false,
  "reason": "brief explanation"
}`;

        const response = await fetch(`${OLLAMA_URL}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                prompt,
                images: [base64Image],
                stream: false,
                format: "json",
                options: { temperature: 0.1 }
            }),
        });

        if (!response.ok) {
            logger.error(`Ollama classify error: ${response.status}`);
            return false; // Hide photos on error so we don't show false positives
        }

        const data = await response.json();
        if (data.response) {
            // Clean up potential markdown formatting like ```json ... ```
            const cleanResponse = data.response.replace(/```json/gi, '').replace(/```/g, '').trim();
            try {
                const parsed = JSON.parse(cleanResponse);
                logger.info(`[Ollama Classify] "${keywords}" => ${parsed.match ? 'YES' : 'NO'}: ${parsed.reason}`);
                return parsed.match === true || parsed.match === "true";
            } catch (parseError) {
                logger.warn(`Failed to parse Ollama JSON response: ${cleanResponse}`, parseError);
                // Fallback: check if response contains "true" 
                return cleanResponse.toLowerCase().includes('"match": true') ||
                    cleanResponse.toLowerCase().includes('"match":true');
            }
        }
        return false; // Default to hiding on parse failure
    } catch (error) {
        logger.error(`Ollama classify failed`, error);
        return false; // Hide photos on error
    }
}

/**
 * Classify a batch of photos against keywords.
 * Returns a Map of photoId => matches (boolean).
 */
export async function classifyPhotosBatch(
    items: { id: string; blob: Blob }[],
    keywords: string,
    onProgress?: (done: number, total: number) => void
): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const matches = await classifyPhoto(item.blob, keywords);
        results.set(item.id, matches);
        onProgress?.(i + 1, items.length);
    }

    return results;
}

