import { useEffect, useState } from 'react';
import { PhotoMetadata } from '@/lib/db';
import { X, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PhotoDetailModalProps {
    photo: PhotoMetadata;
    onClose: () => void;
}

export function PhotoDetailModal({ photo, onClose }: PhotoDetailModalProps) {
    const [src, setSrc] = useState<string | null>(null);

    useEffect(() => {
        // Prefer analysis blob (1024px) for detail view, fall back to preview
        const blob = photo.analysisBlob || photo.previewBlob;
        if (blob) {
            const url = URL.createObjectURL(blob);
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setSrc(url);
            return () => URL.revokeObjectURL(url);
        } else if (photo.file) {
            const url = URL.createObjectURL(photo.file);
            setSrc(url);
            return () => URL.revokeObjectURL(url);
        }
    }, [photo]);

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md p-6" onClick={onClose}>
            <div
                className="bg-[#0F0F0F] rounded-2xl overflow-hidden max-w-6xl w-full h-[85vh] flex flex-col md:flex-row shadow-2xl border border-[#262626]"
                onClick={e => e.stopPropagation()}
            >
                {/* Image Section */}
                <div className="flex-1 bg-[#050505] flex items-center justify-center p-4 relative">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-blue-900/10 via-transparent to-transparent pointer-events-none" />
                    {src ? (
                        <img
                            src={src}
                            alt={photo.name}
                            className="max-w-full max-h-full object-contain shadow-2xl rounded-lg"
                        />
                    ) : (
                        <div className="text-gray-500 animate-pulse">Loading high-res image...</div>
                    )}
                </div>

                {/* Info Section */}
                <div className="w-full md:w-[400px] bg-[#0F0F0F] flex flex-col border-l border-[#262626]">
                    {/* Header */}
                    <div className="p-6 border-b border-[#262626] flex justify-between items-start bg-[#161616]">
                        <div className="overflow-hidden">
                            <h2 className="text-xl font-bold text-white truncate mb-1" title={photo.name}>{photo.name}</h2>
                            <p className="text-xs text-gray-500 font-mono">{photo.status === 'scored' ? 'Analyzed' : 'Processing...'}</p>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-[#262626] rounded-lg transition-colors text-gray-400 hover:text-white"
                        >
                            <X size={20} />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
                        {/* Score Card */}
                        <div className="flex flex-col items-center justify-center p-8 rounded-2xl bg-[#1A1A1A] border border-[#262626] shadow-inner relative overflow-hidden group">
                            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-purple-500/5 opacity-50" />

                            {/* Giant Score */}
                            <div className="relative z-10 flex flex-col items-center">
                                <span className={cn(
                                    "text-6xl font-black tracking-tighter mb-2 bg-clip-text text-transparent bg-gradient-to-br",
                                    (photo.score || 0) >= 9 ? "from-green-400 to-emerald-600" :
                                        (photo.score || 0) >= 7 ? "from-blue-400 to-indigo-600" :
                                            (photo.score || 0) >= 5 ? "from-orange-400 to-red-600" : "from-red-400 to-red-700"
                                )}>
                                    {photo.score ? photo.score.toFixed(1) : 'N/A'}
                                </span>
                                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-semibold text-gray-400 uppercase tracking-widest">
                                    <Sparkles size={12} className="text-blue-400" /> Aesthetic Score
                                </div>
                            </div>
                        </div>

                        {/* Analysis */}
                        <div>
                            <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider mb-4 flex items-center gap-2">
                                <span className="w-1 h-4 bg-purple-500 rounded-full" />
                                Gemini Evaluation
                            </h3>
                            <div className="bg-[#1A1A1A] rounded-xl p-5 border border-[#262626] text-sm leading-relaxed text-gray-300 shadow-sm relative">
                                {photo.reason ? (
                                    <>
                                        <p className="font-serif italic text-gray-400 mb-2 opacity-50 text-2xl absolute top-2 left-3">"</p>
                                        <p className="relative z-10 px-2">{photo.reason}</p>
                                        <p className="font-serif italic text-gray-400 mt-2 opacity-50 text-2xl absolute bottom-0 right-4">"</p>
                                    </>
                                ) : (
                                    <span className="text-gray-600 italic">Analysis pending or unavailable.</span>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="p-4 border-t border-[#262626] bg-[#161616]">
                        <div className="flex justify-between items-center text-[10px] text-gray-600 font-mono uppercase">
                            <span>ID: {photo.id.slice(0, 8)}...</span>
                            <span>{(photo.size / 1024 / 1024).toFixed(2)} MB</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
