
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
// Setup IndexedDB BEFORE importing db
import 'fake-indexeddb/auto';

// Force global assignment just in case
if (!global.indexedDB) {
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    global.indexedDB = require('fake-indexeddb');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    global.IDBKeyRange = require('fake-indexeddb/lib/IDBKeyRange');
}

import { db } from './lib/db';

vi.mock('@google/generative-ai', () => {
    return {
        GoogleGenerativeAI: class {
            constructor() { }
            getGenerativeModel() {
                return {
                    generateContent: vi.fn().mockResolvedValue({
                        response: {
                            text: () => JSON.stringify({
                                results: [
                                    { score: 8.5, reason: "Good composition and lighting." }
                                ]
                            })
                        }
                    })
                };
            }
        },
        SchemaType: { OBJECT: 'OBJECT', NUMBER: 'NUMBER', STRING: 'STRING' }
    };
});

// Mock Logger
vi.mock('./lib/logger', () => ({
    logger: {
        info: vi.fn(),
        success: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
    }
}));

// Mock Blob
// eslint-disable-next-line @typescript-eslint/no-explicit-any
global.Blob = class Blob {
    size = 1024;
    constructor() { }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

// Mock FileReader
// eslint-disable-next-line @typescript-eslint/no-explicit-any
global.FileReader = class FileReader {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onloadend: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onerror: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    result: any;
    readAsDataURL() {
        this.result = "data:image/jpeg;base64,mockbase64data";
        this.onloadend();
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;


describe('AI Pipeline Integration', () => {

    beforeEach(async () => {
        vi.resetModules(); // Reset module registry to reset 'hasRecovered' flag
        await db.open();
        await db.photos.clear();
    });

    afterEach(async () => {
        vi.clearAllMocks();
    });

    it('should pick up a queued photo and analyze it', async () => {
        // Dynamic import to allow hasRecovered reset
        const { useAIPipeline } = await import('./hooks/useAIPipeline');

        // 1. Seed DB with a queued photo
        const photoId = 'test-photo-1';
        await db.photos.add({
            id: photoId,
            name: 'test.jpg',
            path: '/tmp/test.jpg',
            size: 1000,
            status: 'queued',
            createdAt: Date.now(),
            analysisBlob: new Blob(['fake-image-data']),
        });

        // 2. Render Hook
        renderHook(() => useAIPipeline());

        // 3. Wait for DB update
        await waitFor(async () => {
            const updated = await db.photos.get(photoId);
            expect(updated?.status).toBe('scored');
            expect(updated?.score).toBe(8.5);
            expect(updated?.reason).toBe("Good composition and lighting.");
        }, { timeout: 5000 });

    });

    it('should recover stuck analyzing tasks', async () => {
        // Dynamic import
        const { useAIPipeline } = await import('./hooks/useAIPipeline');

        // 1. Seed DB with a stuck 'analyzing' photo
        const photoId = 'stuck-photo-1';
        await db.photos.add({
            id: photoId,
            name: 'stuck.jpg',
            path: '/tmp/stuck.jpg',
            size: 1000,
            status: 'analyzing', // Stuck state
            createdAt: Date.now(),
            analysisBlob: new Blob(['fake-image-data']),
        });

        // 2. Render Hook (this mimics a page reload)
        renderHook(() => useAIPipeline());

        // 3. Expect it to be reset to 'queued' -> then picked up -> then 'scored'
        await waitFor(async () => {
            const updated = await db.photos.get(photoId);
            expect(updated?.status).toBe('scored');
        }, { timeout: 5000 });
    });
});
