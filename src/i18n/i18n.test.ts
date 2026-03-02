import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock localStorage
const mockStorage: Record<string, string> = {};
const mockLocalStorage = {
    getItem: vi.fn((key: string) => mockStorage[key] || null),
    setItem: vi.fn((key: string, value: string) => { mockStorage[key] = value; }),
    removeItem: vi.fn((key: string) => { delete mockStorage[key]; }),
};
Object.defineProperty(global, 'localStorage', { value: mockLocalStorage });

// Mock navigator.language
Object.defineProperty(global, 'navigator', {
    value: { language: 'en-US' },
    writable: true,
});

import { getLocale, setLocale } from '@/i18n';
import en from '@/i18n/en.json';
import zh from '@/i18n/zh.json';

describe('i18n', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
    });

    describe('getLocale', () => {
        it('should return "en" by default when browser is English', () => {
            expect(getLocale()).toBe('en');
        });

        it('should return stored locale from localStorage', () => {
            mockStorage['photorank_locale'] = 'zh';
            expect(getLocale()).toBe('zh');
        });

        it('should auto-detect Chinese browser language', () => {
            Object.defineProperty(global, 'navigator', {
                value: { language: 'zh-CN' },
                writable: true,
            });
            expect(getLocale()).toBe('zh');
            // restore
            Object.defineProperty(global, 'navigator', {
                value: { language: 'en-US' },
                writable: true,
            });
        });
    });

    describe('setLocale', () => {
        it('should persist locale to localStorage', () => {
            setLocale('zh');
            expect(mockLocalStorage.setItem).toHaveBeenCalledWith('photorank_locale', 'zh');
        });
    });

    describe('translation keys', () => {
        it('should have the same keys in en.json and zh.json', () => {
            const enKeys = Object.keys(en).sort();
            const zhKeys = Object.keys(zh).sort();
            expect(enKeys).toEqual(zhKeys);
        });

        it('should have non-empty values for all keys', () => {
            for (const [key, value] of Object.entries(en)) {
                expect(value, `en.json key "${key}" is empty`).toBeTruthy();
            }
            for (const [key, value] of Object.entries(zh)) {
                expect(value, `zh.json key "${key}" is empty`).toBeTruthy();
            }
        });
    });
});
