import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock localStorage
const mockStorage: Record<string, string> = {};
const mockLocalStorage = {
    getItem: vi.fn((key: string) => mockStorage[key] || null),
    setItem: vi.fn((key: string, value: string) => { mockStorage[key] = value; }),
    removeItem: vi.fn((key: string) => { delete mockStorage[key]; }),
};
Object.defineProperty(global, 'localStorage', { value: mockLocalStorage });

// Mock logger
vi.mock('./logger', () => ({
    logger: {
        info: vi.fn(),
        success: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
    }
}));

import { getProviderType, setProviderType, getProvider } from './ai-provider';

describe('AI Provider', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
    });

    describe('getProviderType', () => {
        it('should default to gemini when nothing stored', () => {
            expect(getProviderType()).toBe('gemini');
        });

        it('should return stored provider', () => {
            mockStorage['photorank_ai_provider'] = 'qwen';
            expect(getProviderType()).toBe('qwen');
        });
    });

    describe('setProviderType', () => {
        it('should persist provider to localStorage', () => {
            setProviderType('qwen');
            expect(mockLocalStorage.setItem).toHaveBeenCalledWith('photorank_ai_provider', 'qwen');
        });

        it('should persist gemini provider', () => {
            setProviderType('gemini');
            expect(mockLocalStorage.setItem).toHaveBeenCalledWith('photorank_ai_provider', 'gemini');
        });
    });

    describe('getProvider', () => {
        it('should return a provider with name "gemini" by default', () => {
            const provider = getProvider();
            expect(provider.name).toBe('gemini');
        });

        it('should return a provider with name "qwen" when set', () => {
            mockStorage['photorank_ai_provider'] = 'qwen';
            // Force re-creation by importing fresh
            const provider = getProvider();
            expect(provider.name).toBe('qwen');
        });

        it('should have all required methods', () => {
            const provider = getProvider();
            expect(typeof provider.analyzeLightingCondition).toBe('function');
            expect(typeof provider.detectImageContent).toBe('function');
            expect(typeof provider.extractSubject).toBe('function');
            expect(typeof provider.removeSubject).toBe('function');
            expect(typeof provider.optimizeBackground).toBe('function');
            expect(typeof provider.mergeAndHarmonize).toBe('function');
            expect(typeof provider.editImage).toBe('function');
            expect(typeof provider.testConnection).toBe('function');
            expect(typeof provider.getApiKey).toBe('function');
        });
    });
});
