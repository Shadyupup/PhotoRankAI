import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies BEFORE importing the module under test
vi.mock('./lib/gemini', () => ({
    SchemaType: { OBJECT: 'OBJECT', NUMBER: 'NUMBER', STRING: 'STRING' },
    getGenAI: vi.fn(() => ({
        getGenerativeModel: vi.fn(() => ({
            generateContent: vi.fn().mockResolvedValue({
                response: {
                    text: () => JSON.stringify({
                        score: 7.5,
                        critique: 'Slightly hazy, flat lighting',
                        improvementPrompt: 'Increase contrast and clarity',
                    }),
                }
            }),
        })),
    })),
    blobToBase64: vi.fn().mockResolvedValue('mockbase64'),
    generateImageInternal: vi.fn().mockResolvedValue(new Blob(['enhanced'], { type: 'image/jpeg' })),
    IMAGE_MODEL: 'gemini-3.1-flash-image-preview',
}));

vi.mock('./lib/local-scorer', () => ({
    analyzePhotosBatch: vi.fn().mockResolvedValue([
        { file_id: 'final', score: 72.3, reason: 'Good aesthetics' },
    ]),
}));

vi.mock('./lib/logger', () => ({
    logger: {
        info: vi.fn(),
        success: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
    },
}));

vi.mock('sonner', () => ({
    toast: Object.assign(vi.fn(), {
        loading: vi.fn(),
        success: vi.fn(),
        error: vi.fn(),
    }),
}));

import { runLandscapeWorkflow } from './lib/landscape-workflow';
import { analyzePhotosBatch } from './lib/local-scorer';

describe('Landscape Workflow', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return a score in the 0-100 range (normalized via local scorer)', async () => {
        const analysisBlob = new Blob(['analysis-img'], { type: 'image/jpeg' });
        const generationBlob = new Blob(['gen-img'], { type: 'image/jpeg' });

        const result = await runLandscapeWorkflow(analysisBlob, generationBlob, 'instant', 'toast-1');

        // Score should come from the local scorer (0-100), not Gemini (1-10)
        expect(result.score).toBe(72.3);
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(100);
    });

    it('should call analyzePhotosBatch for final scoring', async () => {
        const analysisBlob = new Blob(['analysis-img'], { type: 'image/jpeg' });
        const generationBlob = new Blob(['gen-img'], { type: 'image/jpeg' });

        await runLandscapeWorkflow(analysisBlob, generationBlob, 'instant', 'toast-1');

        // Verify local scorer was called for final scoring
        expect(analyzePhotosBatch).toHaveBeenCalledTimes(1);
        expect(analyzePhotosBatch).toHaveBeenCalledWith(
            [{ id: 'final', blob: expect.any(Blob) }],
            'local-fast'
        );
    });

    it('should return a Blob result', async () => {
        const analysisBlob = new Blob(['analysis-img'], { type: 'image/jpeg' });
        const generationBlob = new Blob(['gen-img'], { type: 'image/jpeg' });

        const result = await runLandscapeWorkflow(analysisBlob, generationBlob, 'instant', 'toast-1');

        expect(result.blob).toBeInstanceOf(Blob);
        expect(result.reason).toBeDefined();
    });

    it('iterative mode should still normalize final score to 0-100', async () => {
        const analysisBlob = new Blob(['analysis-img'], { type: 'image/jpeg' });
        const generationBlob = new Blob(['gen-img'], { type: 'image/jpeg' });

        // Mock Gemini evaluation returning high score to trigger early exit
        const geminiMock = await import('./lib/gemini');
        (geminiMock.getGenAI as ReturnType<typeof vi.fn>).mockReturnValue({
            getGenerativeModel: vi.fn(() => ({
                generateContent: vi.fn().mockResolvedValue({
                    response: {
                        text: () => JSON.stringify({
                            score: 9.5, // High enough to exit early in iterative
                            critique: 'Excellent',
                            improvementPrompt: 'Minor tweaks',
                        }),
                    },
                }),
            })),
        });

        const result = await runLandscapeWorkflow(analysisBlob, generationBlob, 'iterative', 'toast-2');

        // Even in iterative mode, final score should be 0-100 from local scorer
        expect(result.score).toBe(72.3);
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(100);
    });
});
