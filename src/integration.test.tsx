
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
// Setup IndexedDB BEFORE importing db
import 'fake-indexeddb/auto';

// Force global assignment just in case
if (!global.indexedDB) {
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);
     
    global.indexedDB = require('fake-indexeddb');
     
    global.IDBKeyRange = require('fake-indexeddb/lib/IDBKeyRange');
}

import { db } from './lib/db';

// Mock local-scorer (replaces former @google/generative-ai mock)
vi.mock('./lib/local-scorer', () => ({
    analyzePhotosBatch: vi.fn().mockResolvedValue([
        { score: 8.5, reason: "Good aesthetics, decent technical quality", file_id: "test-photo-1" },
        { score: 8.5, reason: "Good aesthetics, decent technical quality", file_id: "stuck-photo-1" }
    ]),
    checkScorerHealth: vi.fn().mockResolvedValue(true),
}));

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
 
global.Blob = class Blob {
    size = 1024;
    constructor() { }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

// Mock FileReader
 
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
            size: 1000,
            type: 'image/jpeg',
            lastModified: Date.now(),
            webkitRelativePath: '',
            status: 'queued',
            createdAt: Date.now(),
            analysisBlob: new TextEncoder().encode('fake-image-data').buffer,
        });

        // 2. Render Hook
        renderHook(() => useAIPipeline());

        // 3. Wait for DB update
        await waitFor(async () => {
            const updated = await db.photos.get(photoId);
            expect(updated?.status).toBe('scored');
            expect(updated?.score).toBe(8.5);
            expect(updated?.reason).toBe("Good aesthetics, decent technical quality");
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
            size: 1000,
            type: 'image/jpeg',
            lastModified: Date.now(),
            webkitRelativePath: '',
            status: 'analyzing', // Stuck state
            createdAt: Date.now(),
            analysisBlob: new TextEncoder().encode('fake-image-data').buffer,
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
