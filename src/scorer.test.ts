import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyzePhotosBatch, checkScorerHealth } from './lib/local-scorer';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock logger
vi.mock('./lib/logger', () => ({
    logger: {
        info: vi.fn(),
        success: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
    }
}));

describe('Local Scorer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('analyzePhotosBatch', () => {
        it('should send images to local backend and return results', async () => {
            const mockResults = {
                results: [
                    { file_id: 'test-1', score: 7.5, reason: 'Good aesthetics, decent technical quality' },
                    { file_id: 'test-2', score: 8.2, reason: 'Excellent aesthetics, high technical quality' },
                ]
            };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockResults,
            });

            const mockBlob1 = new Blob(['fake-img-1'], { type: 'image/jpeg' });
            const mockBlob2 = new Blob(['fake-img-2'], { type: 'image/jpeg' });

            const results = await analyzePhotosBatch([
                { id: 'test-1', blob: mockBlob1 },
                { id: 'test-2', blob: mockBlob2 },
            ], 'local-fast');

            expect(results).toHaveLength(2);
            expect(results[0].score).toBe(7.5);
            expect(results[0].file_id).toBe('test-1');
            expect(results[1].score).toBe(8.2);
            expect(results[1].file_id).toBe('test-2');

            // Verify fetch was called with correct URL
            expect(mockFetch).toHaveBeenCalledTimes(1);
            const [url, options] = mockFetch.mock.calls[0];
            expect(url).toContain('/api/score');
            expect(options.method).toBe('POST');
            expect(options.body).toBeInstanceOf(FormData);
        });

        it('should throw on HTTP error', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 500,
                text: async () => 'Internal Server Error',
            });

            const mockBlob = new Blob(['fake'], { type: 'image/jpeg' });
            await expect(
                analyzePhotosBatch([{ id: 'test-1', blob: mockBlob }], 'local-fast')
            ).rejects.toThrow('Local scorer error (500)');
        });

        it('should throw on invalid response structure', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ invalid: true }),
            });

            const mockBlob = new Blob(['fake'], { type: 'image/jpeg' });
            await expect(
                analyzePhotosBatch([{ id: 'test-1', blob: mockBlob }], 'local-fast')
            ).rejects.toThrow('Invalid response structure');
        });

        it('should throw on empty items', async () => {
            const mockBlob = new Blob([], { type: 'image/jpeg' }); // size = 0
            await expect(
                analyzePhotosBatch([{ id: 'test-1', blob: mockBlob }], 'local-fast')
            ).rejects.toThrow('No valid image data');
        });

        it('should filter out zero-size blobs', async () => {
            const mockResults = {
                results: [
                    { file_id: 'test-2', score: 6.0, reason: 'Average' },
                ]
            };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockResults,
            });

            const emptyBlob = new Blob([], { type: 'image/jpeg' });
            const validBlob = new Blob(['fake'], { type: 'image/jpeg' });

            const results = await analyzePhotosBatch([
                { id: 'test-1', blob: emptyBlob },
                { id: 'test-2', blob: validBlob },
            ], 'local-fast');

            expect(results).toHaveLength(1);
            expect(results[0].file_id).toBe('test-2');
        });
    });

    describe('checkScorerHealth', () => {
        it('should return true when backend is healthy', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ status: 'ok', models_loaded: true }),
            });

            const healthy = await checkScorerHealth();
            expect(healthy).toBe(true);
        });

        it('should return false when backend is down', async () => {
            mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

            const healthy = await checkScorerHealth();
            expect(healthy).toBe(false);
        });

        it('should return false when models not loaded', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ status: 'ok', models_loaded: false }),
            });

            const healthy = await checkScorerHealth();
            expect(healthy).toBe(false);
        });
    });
});
