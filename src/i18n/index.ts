import { useState, useCallback, useEffect } from 'react';
import en from './en.json';
import zh from './zh.json';

export type Locale = 'en' | 'zh';

const LOCALE_STORAGE_KEY = 'photorank_locale';
const LOCALE_CHANGE_EVENT = 'photorank-locale-changed';

const translations: Record<Locale, Record<string, string>> = { en, zh };

export function getLocale(): Locale {
    if (typeof localStorage === 'undefined') return 'en';
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored === 'zh' || stored === 'en') return stored;
    // Auto-detect from browser
    const browserLang = navigator.language?.toLowerCase() || '';
    return browserLang.startsWith('zh') ? 'zh' : 'en';
}

export function setLocale(locale: Locale): void {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    // Use window custom event for reliable cross-component notification
    window.dispatchEvent(new CustomEvent(LOCALE_CHANGE_EVENT, { detail: locale }));
}

/**
 * Lightweight i18n hook. Returns:
 * - t(key): lookup translation string
 * - locale: current locale
 * - setLocale: change locale (triggers re-render across ALL components using this hook)
 */
export function useTranslation() {
    const [locale, setLocaleState] = useState<Locale>(getLocale);

    useEffect(() => {
        const handler = () => setLocaleState(getLocale());
        // Listen for locale changes from any component via window event
        window.addEventListener(LOCALE_CHANGE_EVENT, handler);
        // Also listen for storage changes (e.g. from another tab)
        window.addEventListener('storage', handler);
        return () => {
            window.removeEventListener(LOCALE_CHANGE_EVENT, handler);
            window.removeEventListener('storage', handler);
        };
    }, []);

    const t = useCallback((key: string): string => {
        return translations[locale]?.[key] ?? translations['en']?.[key] ?? key;
    }, [locale]);

    const changeLocale = useCallback((newLocale: Locale) => {
        setLocale(newLocale);
    }, []);

    return { t, locale, setLocale: changeLocale };
}
