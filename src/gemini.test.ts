import { describe, it, expect, vi } from 'vitest';
import { analyzePhotosBatch } from './lib/gemini';

vi.mock('@google/generative-ai', () => ({
    GoogleGenerativeAI: class {
        constructor() { }
        getGenerativeModel({ model }: { model: string }) {
            return {
                generateContent: vi.fn().mockImplementation(async () => {
                    if (model === 'gemini-2.0-flash-exp') {
                        throw new Error('404 Model Not Found');
                    }
                    if (model === 'gemini-1.5-flash') {
                        return {
                            response: {
                                text: () => JSON.stringify({
                                    results: [{ score: 9.9, reason: 'Fallback worked' }]
                                })
                            }
                        };
                    }
                    throw new Error('Not reached: ' + model);
                })
            };
        }
    },
    SchemaType: { OBJECT: 'OBJECT', NUMBER: 'NUMBER', STRING: 'STRING', ARRAY: 'ARRAY' }
}));

describe('Gemini Fallback Logic (Batch)', () => {
    it('should fall back to next model if the first one returns 404', async () => {
        const mockBlob = new Blob(['fake'], { type: 'image/jpeg' });
        const results = await analyzePhotosBatch([{ id: 'test-1', blob: mockBlob }]);

        expect(results).toHaveLength(1);
        expect(results[0].score).toBe(9.9);
        expect(results[0].reason).toBe('Fallback worked');
    });
});
