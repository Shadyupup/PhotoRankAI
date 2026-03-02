/**
 * AI Provider Abstraction Layer
 * Unifies Gemini and Qwen into a single interface for enhancement workflows.
 */

import { logger } from './logger';

// --- Types ---

export type ProviderType = 'gemini' | 'qwen';

export interface ContentAnalysis {
    hasLivingBeings: boolean;
    subjectType: 'person' | 'animal' | 'landscape' | 'object';
    description: string;
}

export interface AIProvider {
    name: ProviderType;
    analyzeLightingCondition(blob: Blob): Promise<string>;
    detectImageContent(blob: Blob): Promise<ContentAnalysis>;
    extractSubject(blob: Blob): Promise<Blob>;
    removeSubject(blob: Blob): Promise<Blob>;
    optimizeBackground(blob: Blob, lightingContext: string): Promise<Blob>;
    mergeAndHarmonize(original: Blob, person: Blob, bg: Blob, lighting: string): Promise<Blob>;
    editImage(blob: Blob, instruction: string): Promise<Blob>;
    testConnection(): Promise<string>;
    getApiKey(): string;
}

// --- Provider Storage ---

const PROVIDER_STORAGE_KEY = 'photorank_ai_provider';

export function getProviderType(): ProviderType {
    const stored = localStorage.getItem(PROVIDER_STORAGE_KEY);
    if (stored === 'gemini' || stored === 'qwen') return stored;
    return 'gemini'; // default
}

export function setProviderType(provider: ProviderType): void {
    localStorage.setItem(PROVIDER_STORAGE_KEY, provider);
    logger.info(`AI provider switched to: ${provider}`);
}

// --- Lazy-loaded providers ---

let cachedProvider: AIProvider | null = null;
let cachedProviderType: ProviderType | null = null;

export function getProvider(): AIProvider {
    const type = getProviderType();

    if (cachedProvider && cachedProviderType === type) {
        return cachedProvider;
    }

    if (type === 'qwen') {
        cachedProvider = createQwenProvider();
    } else {
        cachedProvider = createGeminiProvider();
    }
    cachedProviderType = type;
    return cachedProvider;
}

// Clear cache on key/provider changes
if (typeof window !== 'undefined') {
    window.addEventListener('api-key-changed', () => {
        cachedProvider = null;
        cachedProviderType = null;
    });
}

// --- Gemini Provider ---

function createGeminiProvider(): AIProvider {
    // Lazy import to avoid loading Gemini SDK when using Qwen
    const getGemini = () => import('./gemini');

    return {
        name: 'gemini',

        async analyzeLightingCondition(blob: Blob): Promise<string> {
            const { analyzeLightingCondition } = await getGemini();
            return analyzeLightingCondition(blob);
        },

        async detectImageContent(blob: Blob): Promise<ContentAnalysis> {
            const { detectImageContent } = await getGemini();
            return detectImageContent(blob);
        },

        async extractSubject(blob: Blob): Promise<Blob> {
            const { extractSubjectWithGemini } = await getGemini();
            return extractSubjectWithGemini(blob);
        },

        async removeSubject(blob: Blob): Promise<Blob> {
            const { removeSubjectFromImage } = await getGemini();
            return removeSubjectFromImage(blob);
        },

        async optimizeBackground(blob: Blob, lightingContext: string): Promise<Blob> {
            const { optimizeBackground } = await getGemini();
            return optimizeBackground(blob, lightingContext);
        },

        async mergeAndHarmonize(original: Blob, person: Blob, bg: Blob, lighting: string): Promise<Blob> {
            const { mergeAndHarmonize } = await getGemini();
            return mergeAndHarmonize(original, person, bg, lighting);
        },

        async editImage(blob: Blob, instruction: string): Promise<Blob> {
            const { editImageWithGemini } = await getGemini();
            return editImageWithGemini(blob, instruction);
        },

        async testConnection(): Promise<string> {
            const { testGeminiConnection } = await getGemini();
            return testGeminiConnection();
        },

        getApiKey(): string {
            const stored = localStorage.getItem('photorank_gemini_api_key');
            if (stored) return stored;
            return import.meta.env.VITE_GEMINI_API_KEY || '';
        },
    };
}

// --- Qwen Provider ---

function createQwenProvider(): AIProvider {
    const getQwen = () => import('./qwen');

    return {
        name: 'qwen',

        async analyzeLightingCondition(blob: Blob): Promise<string> {
            const { analyzeLightingCondition } = await getQwen();
            return analyzeLightingCondition(blob);
        },

        async detectImageContent(blob: Blob): Promise<ContentAnalysis> {
            const { detectImageContent } = await getQwen();
            return detectImageContent(blob);
        },

        async extractSubject(blob: Blob): Promise<Blob> {
            const { extractSubjectWithQwen } = await getQwen();
            return extractSubjectWithQwen(blob);
        },

        async removeSubject(blob: Blob): Promise<Blob> {
            const { removeSubjectFromImage } = await getQwen();
            return removeSubjectFromImage(blob);
        },

        async optimizeBackground(blob: Blob, lightingContext: string): Promise<Blob> {
            const { optimizeBackground } = await getQwen();
            return optimizeBackground(blob, lightingContext);
        },

        async mergeAndHarmonize(original: Blob, person: Blob, bg: Blob, lighting: string): Promise<Blob> {
            const { mergeAndHarmonize } = await getQwen();
            return mergeAndHarmonize(original, person, bg, lighting);
        },

        async editImage(blob: Blob, instruction: string): Promise<Blob> {
            const { editImageWithQwen } = await getQwen();
            return editImageWithQwen(blob, instruction);
        },

        async testConnection(): Promise<string> {
            const { testQwenConnection } = await getQwen();
            return testQwenConnection();
        },

        getApiKey(): string {
            const stored = localStorage.getItem('photorank_dashscope_api_key');
            if (stored) return stored;
            return import.meta.env.VITE_DASHSCOPE_API_KEY || '';
        },
    };
}
