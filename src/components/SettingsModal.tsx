import { useState, useEffect } from 'react';
import { X, Key, ExternalLink, Check, ShieldCheck, Globe, Cpu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation, type Locale } from '@/i18n';
import { getProviderType, setProviderType, type ProviderType } from '@/lib/ai-provider';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    onOpenAdmin?: () => void;
}

// Storage keys per provider
const GEMINI_STORAGE_KEY = 'photorank_gemini_api_key';
const QWEN_STORAGE_KEY = 'photorank_dashscope_api_key';

export function getStoredApiKey(): string {
    const provider = getProviderType();
    const key = provider === 'qwen' ? QWEN_STORAGE_KEY : GEMINI_STORAGE_KEY;
    return localStorage.getItem(key) || '';
}

export function SettingsModal({ isOpen, onClose, onOpenAdmin }: SettingsModalProps) {
    const { t, locale, setLocale } = useTranslation();
    const [apiKey, setApiKey] = useState('');
    const [saved, setSaved] = useState(false);
    const [provider, setProvider] = useState<ProviderType>(getProviderType);

    useEffect(() => {
        if (isOpen) {
            const p = getProviderType();
            setProvider(p);
            const storageKey = p === 'qwen' ? QWEN_STORAGE_KEY : GEMINI_STORAGE_KEY;
            setApiKey(localStorage.getItem(storageKey) || '');
            setSaved(false);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const isQwen = provider === 'qwen';
    const envKey = isQwen
        ? (import.meta.env.VITE_DASHSCOPE_API_KEY || '')
        : (import.meta.env.VITE_GEMINI_API_KEY || '');
    const effectiveKey = apiKey || envKey;
    const hasKey = effectiveKey.length > 0;

    const handleSave = () => {
        const trimmed = apiKey.trim();
        const storageKey = isQwen ? QWEN_STORAGE_KEY : GEMINI_STORAGE_KEY;
        if (trimmed) {
            localStorage.setItem(storageKey, trimmed);
        } else {
            localStorage.removeItem(storageKey);
        }
        setSaved(true);
        window.dispatchEvent(new CustomEvent('api-key-changed'));
        setTimeout(() => setSaved(false), 2000);
    };

    const handleProviderChange = (newProvider: ProviderType) => {
        setProvider(newProvider);
        setProviderType(newProvider);
        // Load the API key for the new provider
        const storageKey = newProvider === 'qwen' ? QWEN_STORAGE_KEY : GEMINI_STORAGE_KEY;
        setApiKey(localStorage.getItem(storageKey) || '');
        setSaved(false);
        window.dispatchEvent(new CustomEvent('api-key-changed'));
    };

    const apiKeyLabel = isQwen ? t('settings.qwenApiKeyLabel') : t('settings.apiKeyLabel');
    const apiKeyLink = isQwen ? 'https://bailian.console.aliyun.com/' : 'https://aistudio.google.com/apikey';
    const apiKeyLinkText = isQwen ? t('settings.qwenGetApiKey') : t('settings.getApiKey');
    const fastDesc = isQwen ? t('settings.qwenFastDesc') : t('settings.fastDesc');
    const fastMeta = isQwen ? t('settings.qwenFastMeta') : t('settings.fastMeta');
    const proDesc = isQwen ? t('settings.qwenProDesc') : t('settings.proDesc');
    const proMeta = isQwen ? t('settings.qwenProMeta') : t('settings.proMeta');

    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div
                className="bg-[#1A1A1A] border border-[#333] rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b border-[#262626]">
                    <h2 className="text-lg font-bold text-white">{t('settings.title')}</h2>
                    <button onClick={onClose} className="p-1.5 hover:bg-[#333] rounded-lg text-gray-400 hover:text-white transition-colors">
                        <X size={18} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-5 space-y-5">
                    {/* Language Selector */}
                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <Globe size={16} className="text-cyan-400" />
                            <label className="text-sm font-semibold text-white">{t('settings.language')}</label>
                        </div>
                        <div className="flex items-center bg-[#0F0F0F] p-1 rounded-lg border border-[#333]">
                            {([['en', 'English'], ['zh', '中文']] as [Locale, string][]).map(([code, label]) => (
                                <button
                                    key={code}
                                    onClick={() => setLocale(code)}
                                    className={cn(
                                        "flex-1 px-4 py-2 rounded-md text-sm font-semibold transition-all",
                                        locale === code
                                            ? "bg-[#2d2d2d] text-white shadow-sm ring-1 ring-white/10"
                                            : "text-gray-500 hover:text-gray-300"
                                    )}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <hr className="border-[#262626]" />

                    {/* AI Provider Selector */}
                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <Cpu size={16} className="text-violet-400" />
                            <label className="text-sm font-semibold text-white">{t('settings.provider')}</label>
                        </div>
                        <div className="flex items-center bg-[#0F0F0F] p-1 rounded-lg border border-[#333]">
                            {([['gemini', t('settings.providerGemini')], ['qwen', t('settings.providerQwen')]] as [ProviderType, string][]).map(([type, label]) => (
                                <button
                                    key={type}
                                    onClick={() => handleProviderChange(type)}
                                    className={cn(
                                        "flex-1 px-4 py-2 rounded-md text-sm font-semibold transition-all",
                                        provider === type
                                            ? "bg-[#2d2d2d] text-white shadow-sm ring-1 ring-white/10"
                                            : "text-gray-500 hover:text-gray-300"
                                    )}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <hr className="border-[#262626]" />

                    {/* API Key */}
                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <Key size={16} className="text-blue-400" />
                            <label className="text-sm font-semibold text-white">{apiKeyLabel}</label>
                            {hasKey && (
                                <span className="text-[10px] font-bold text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full border border-green-500/20">
                                    {t('settings.apiKeyActive')}
                                </span>
                            )}
                        </div>
                        <p className="text-xs text-gray-400 leading-relaxed">
                            {t('settings.apiKeyDescription')
                                .replace('{fast}', '')
                                .replace('{pro}', '')
                                .split('')
                                .length > 0 && (
                                    <>
                                        {locale === 'zh' ? (
                                            <>用于<strong className="text-blue-400">{t('settings.fast')}</strong>和<strong className="text-purple-400">{t('settings.pro')}</strong>增强模式。AI 评分不需要此密钥。</>
                                        ) : (
                                            <>Required for <strong className="text-blue-400">{t('settings.fast')}</strong> and <strong className="text-purple-400">{t('settings.pro')}</strong> enhancement modes. Not needed for AI scoring.</>
                                        )}
                                    </>
                                )}
                        </p>
                        <div className="relative">
                            <input
                                type="password"
                                value={apiKey}
                                onChange={e => { setApiKey(e.target.value); setSaved(false); }}
                                placeholder={envKey ? `••••••••  (${t('settings.apiKeyUsingEnv').split('.')[0]})` : t('settings.apiKeyPlaceholder')}
                                className="w-full bg-[#0F0F0F] border border-[#333] rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-all font-mono"
                            />
                        </div>
                        {envKey && !apiKey && (
                            <p className="text-[11px] text-gray-500">
                                {t('settings.apiKeyUsingEnv')}
                            </p>
                        )}

                        <div className="flex items-center gap-3">
                            <button
                                onClick={handleSave}
                                className={cn(
                                    "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all",
                                    saved
                                        ? "bg-green-600 text-white"
                                        : "bg-blue-600 hover:bg-blue-500 text-white active:scale-95"
                                )}
                            >
                                {saved ? <><Check size={14} /> {t('settings.saved')}</> : t('settings.saveKey')}
                            </button>
                            <a
                                href={apiKeyLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-blue-400 transition-colors"
                            >
                                <ExternalLink size={12} />
                                {apiKeyLinkText}
                            </a>
                        </div>
                    </div>

                    {/* Divider */}
                    <hr className="border-[#262626]" />

                    {/* Mode Comparison */}
                    <div className="space-y-3">
                        <h3 className="text-sm font-semibold text-white">{t('settings.enhancementModes')}</h3>
                        <div className="grid grid-cols-2 gap-2 text-[11px]">
                            <div className="bg-[#0F0F0F] border border-blue-500/20 rounded-lg p-3 space-y-1">
                                <div className="font-bold text-blue-400">{t('settings.fast')}</div>
                                <div className="text-gray-400">{fastDesc}</div>
                                <div className="text-blue-400 font-semibold mt-2">{fastMeta}</div>
                            </div>
                            <div className="bg-[#0F0F0F] border border-purple-500/20 rounded-lg p-3 space-y-1">
                                <div className="font-bold text-purple-400">{t('settings.pro')}</div>
                                <div className="text-gray-400">{proDesc}</div>
                                <div className="text-purple-400 font-semibold mt-2">{proMeta}</div>
                            </div>
                        </div>
                    </div>

                    {/* Divider */}
                    <hr className="border-[#262626]" />

                    {/* Admin Dashboard */}
                    {onOpenAdmin && (
                        <div className="space-y-3">
                            <h3 className="text-sm font-semibold text-white">{t('settings.advanced')}</h3>
                            <button
                                onClick={() => { onClose(); onOpenAdmin(); }}
                                className="w-full flex items-center gap-3 bg-[#0F0F0F] hover:bg-[#1F1F1F] border border-[#333] hover:border-amber-500/30 rounded-lg p-3 transition-all group"
                            >
                                <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center group-hover:bg-amber-500/20 transition-colors">
                                    <ShieldCheck size={16} className="text-amber-400" />
                                </div>
                                <div className="text-left">
                                    <div className="text-sm font-semibold text-white">{t('settings.adminDashboard')}</div>
                                    <div className="text-[11px] text-gray-500">{t('settings.adminDesc')}</div>
                                </div>
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
