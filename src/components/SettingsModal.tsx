import { useState, useEffect } from 'react';
import { X, Key, ExternalLink, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const STORAGE_KEY = 'photorank_gemini_api_key';

export function getStoredApiKey(): string {
    return localStorage.getItem(STORAGE_KEY) || '';
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
    const [apiKey, setApiKey] = useState('');
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setApiKey(getStoredApiKey());
            setSaved(false);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const envKey = import.meta.env.VITE_GEMINI_API_KEY || '';
    const effectiveKey = apiKey || envKey;
    const hasKey = effectiveKey.length > 0;

    const handleSave = () => {
        const trimmed = apiKey.trim();
        if (trimmed) {
            localStorage.setItem(STORAGE_KEY, trimmed);
        } else {
            localStorage.removeItem(STORAGE_KEY);
        }
        setSaved(true);
        // Force re-init of GenAI on next use
        window.dispatchEvent(new CustomEvent('api-key-changed'));
        setTimeout(() => setSaved(false), 2000);
    };

    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div
                className="bg-[#1A1A1A] border border-[#333] rounded-2xl w-full max-w-lg shadow-2xl"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b border-[#262626]">
                    <h2 className="text-lg font-bold text-white">Settings</h2>
                    <button onClick={onClose} className="p-1.5 hover:bg-[#333] rounded-lg text-gray-400 hover:text-white transition-colors">
                        <X size={18} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-5 space-y-5">
                    {/* Gemini API Key */}
                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <Key size={16} className="text-blue-400" />
                            <label className="text-sm font-semibold text-white">Gemini API Key</label>
                            {hasKey && (
                                <span className="text-[10px] font-bold text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full border border-green-500/20">
                                    Active
                                </span>
                            )}
                        </div>
                        <p className="text-xs text-gray-400 leading-relaxed">
                            Required for <strong className="text-blue-400">Fast</strong> and <strong className="text-purple-400">Pro</strong> enhancement modes.
                            Not needed for AI scoring.
                        </p>
                        <div className="relative">
                            <input
                                type="password"
                                value={apiKey}
                                onChange={e => { setApiKey(e.target.value); setSaved(false); }}
                                placeholder={envKey ? '••••••••  (using .env key)' : 'Paste your API key here...'}
                                className="w-full bg-[#0F0F0F] border border-[#333] rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-all font-mono"
                            />
                        </div>
                        {envKey && !apiKey && (
                            <p className="text-[11px] text-gray-500">
                                Currently using key from <code className="text-gray-400">.env</code> file. Enter a key above to override.
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
                                {saved ? <><Check size={14} /> Saved</> : 'Save Key'}
                            </button>
                            <a
                                href="https://aistudio.google.com/apikey"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-blue-400 transition-colors"
                            >
                                <ExternalLink size={12} />
                                Get a free API key
                            </a>
                        </div>
                    </div>

                    {/* Divider */}
                    <hr className="border-[#262626]" />

                    {/* Mode Comparison */}
                    <div className="space-y-3">
                        <h3 className="text-sm font-semibold text-white">Enhancement Modes</h3>
                        <div className="grid grid-cols-2 gap-2 text-[11px]">
                            <div className="bg-[#0F0F0F] border border-blue-500/20 rounded-lg p-3 space-y-1">
                                <div className="font-bold text-blue-400">Fast</div>
                                <div className="text-gray-400">AI single-pass enhancement (Gemini)</div>
                                <div className="text-blue-400 font-semibold mt-2">API Key · ~30s</div>
                            </div>
                            <div className="bg-[#0F0F0F] border border-purple-500/20 rounded-lg p-3 space-y-1">
                                <div className="font-bold text-purple-400">Pro</div>
                                <div className="text-gray-400">Iterative AI refinement with critique loop</div>
                                <div className="text-purple-400 font-semibold mt-2">API Key · ~2min</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
