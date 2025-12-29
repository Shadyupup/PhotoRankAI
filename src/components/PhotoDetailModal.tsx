import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { X, Sparkles, ArrowLeftRight, Loader2, Crown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAutoOptimizer } from '@/hooks/useAutoOptimizer';

interface PhotoDetailModalProps {
    photoId: string;
    onClose: () => void;
}

export function PhotoDetailModal({ photoId, onClose }: PhotoDetailModalProps) {
    const photo = useLiveQuery(() => db.photos.get(photoId), [photoId]);
    const { startOptimization, isOptimizing } = useAutoOptimizer();

    const [src, setSrc] = useState<string | null>(null);
    const [isComparing, setIsComparing] = useState(false);

    // --- 核心修复：更智能的图片加载逻辑 (支持对比原图) ---
    useEffect(() => {
        if (!photo) {
            return;
        };

        let activeUrl = '';
        let cancelled = false;

        const loadContent = async () => {
            try {
                let blobToLoad: Blob | undefined | File;

                // 1. 决定要显示哪个 Blob
                if (isComparing && photo.originalBlob) {
                    // 情况 A: 正在对比，且存在“绝对原图备份” (Auto Masterpiece 模式)
                    blobToLoad = photo.originalBlob;
                } else if (photo.analysisBlob) {
                    // 情况 B: 默认显示当前高清图 (可能是 AI 修过的，也可能是原图)
                    blobToLoad = photo.analysisBlob;
                } else if (photo.file) {
                    blobToLoad = photo.file;
                } else if (photo.handle) {
                    blobToLoad = await photo.handle.getFile();
                } else {
                    blobToLoad = photo.previewBlob;
                }

                if (blobToLoad) {
                    activeUrl = URL.createObjectURL(blobToLoad);
                    if (!cancelled) setSrc(activeUrl);
                }
            } catch (e) {
                console.error("Failed to load image content", e);
            }
        };

        // 不要在这里 setSrc(null)，否则按住对比时会闪烁
        loadContent();

        return () => {
            cancelled = true;
            if (activeUrl) URL.revokeObjectURL(activeUrl);
        };
    }, [photo, isComparing]); // 监听 isComparing 变化


    if (!photo) {
        return (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md">
                <Loader2 className="animate-spin text-white" size={48} />
            </div>
        );
    }

    // --- 核心修复：分数显示逻辑 ---
    // 如果有 originalBlob，说明是 Auto Masterpiece，直接显示当前 score
    const isMasterpiece = !!photo.originalBlob;

    // 如果正在对比(isComparing)且有原始分，显示原始分；否则显示当前分
    const displayScore = (isComparing && photo.originalScore)
        ? photo.originalScore
        : photo.score;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md p-6" onClick={onClose}>
            <div
                className="bg-[#0F0F0F] rounded-2xl overflow-hidden max-w-6xl w-full h-[85vh] flex flex-col md:flex-row shadow-2xl border border-[#262626]"
                onClick={e => e.stopPropagation()}
            >
                {/* Image Section */}
                {/* 【修改】移除了 p-4，让图片可以撑满容器 */}
                <div className="flex-1 bg-[#050505] flex items-center justify-center relative overflow-hidden">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-blue-900/10 via-transparent to-transparent pointer-events-none" />

                    <div className="w-full h-full flex items-center justify-center overflow-hidden">
                        {src ? (
                            <img
                                src={src}
                                alt={photo.name}
                                // 这里保留 object-contain 确保图片完整显示，移除 padding 后它会贴边
                                className="max-w-full max-h-full object-contain shadow-2xl will-change-transform transition-all duration-300"
                            />
                        ) : (
                            <div className="text-gray-500 animate-pulse">Loading image...</div>
                        )}
                    </div>

                    {/* Compare Button Overlay */}
                    {/* 只要有 AutoMasterpiece (即 originalBlob 存在)，就显示对比按钮 */}
                    {(photo.originalBlob) && (
                        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 z-20">
                            <button
                                onMouseDown={() => setIsComparing(true)}
                                onMouseUp={() => setIsComparing(false)}
                                onMouseLeave={() => setIsComparing(false)}
                                className="flex items-center gap-2 px-6 py-2 bg-black/60 backdrop-blur-md border border-white/20 rounded-full text-white font-bold hover:bg-black/80 transition-all active:scale-95 select-none"
                            >
                                <ArrowLeftRight size={16} />
                                {isComparing ? 'Showing Original' : 'Hold to Compare'}
                            </button>
                        </div>
                    )}

                    {/* Auto Masterpiece 专属角标 */}
                    {isMasterpiece && !isComparing && (
                        <div className="absolute top-6 left-6 flex items-center gap-2 px-3 py-1.5 bg-yellow-500/20 border border-yellow-500/40 text-yellow-200 text-xs font-bold rounded-full backdrop-blur-md shadow-[0_0_15px_rgba(234,179,8,0.3)] animate-in fade-in zoom-in duration-300">
                            <Crown size={14} className="text-yellow-400" /> AI Masterpiece
                        </div>
                    )}
                </div>

                {/* Info Section */}
                <div className="w-full md:w-[400px] bg-[#0F0F0F] flex flex-col border-l border-[#262626]">
                    {/* Header ... */}
                    <div className="p-6 border-b border-[#262626] flex justify-between items-start bg-[#161616]">
                        <div className="overflow-hidden mr-4">
                            <h2 className="text-xl font-bold text-white truncate">{photo.name}</h2>
                            <p className="text-xs text-gray-500 font-mono">{photo.status === 'scored' ? 'Analyzed' : 'Processing...'}</p>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => startOptimization(photo)}
                                disabled={isOptimizing}
                                className={cn(
                                    "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border",
                                    "bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border-yellow-500/50 text-yellow-200 hover:bg-yellow-500/30",
                                    isOptimizing ? "opacity-80 cursor-not-allowed" : "hover:scale-105 active:scale-95"
                                )}
                            >
                                {isOptimizing ? (
                                    <> <Loader2 size={14} className="animate-spin" /> <span>Looping...</span> </>
                                ) : (
                                    <> <Sparkles size={14} className="text-yellow-400" /> <span>Auto Masterpiece</span> </>
                                )}
                            </button>

                            <button onClick={onClose} className="p-2 hover:bg-[#262626] rounded-lg text-gray-400 hover:text-white transition-colors">
                                <X size={20} />
                            </button>
                        </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
                        {/* Score Card */}
                        <div className="flex flex-col items-center justify-center p-8 rounded-2xl bg-[#1A1A1A] border border-[#262626] shadow-inner relative overflow-hidden group">
                            <div className={cn(
                                "absolute inset-0 bg-gradient-to-br opacity-50 transition-colors duration-500",
                                // 颜色逻辑：如果是 Masterpiece 且不在对比状态，显示金色
                                isMasterpiece && !isComparing ? "from-yellow-600/20 to-orange-600/20" : "from-gray-500/5 to-gray-500/5"
                            )} />

                            <div className="relative z-10 flex flex-col items-center">
                                <span className={cn(
                                    "text-6xl font-black tracking-tighter mb-2 bg-clip-text text-transparent bg-gradient-to-br transition-all duration-300",
                                    // 字体颜色逻辑
                                    isMasterpiece && !isComparing ? "from-yellow-300 to-amber-500" :
                                        (displayScore || 0) >= 9 ? "from-green-400 to-emerald-600" :
                                            (displayScore || 0) >= 7 ? "from-blue-400 to-indigo-600" :
                                                "from-orange-400 to-red-600",
                                    // 对比时让当前分数变灰，或者因为我们现在切换了数值，这里可以去掉 grayscale，让它显示原分的颜色
                                    // isComparing && "opacity-50 grayscale" <--- 建议移除这一行，因为现在数值会变
                                )}>
                                    {displayScore ? displayScore.toFixed(1) : 'N/A'}
                                </span>
                                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-semibold text-gray-400 uppercase tracking-widest">
                                    <Sparkles size={12} className={cn(
                                        isMasterpiece && !isComparing ? "text-yellow-400" : "text-blue-400"
                                    )} />
                                    {isMasterpiece && !isComparing ? 'Masterpiece Score' : 'Original Score'}
                                </div>
                            </div>
                        </div>

                        {/* Feedback / Fix Reason */}
                        <div>
                            <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider mb-4 flex items-center gap-2">
                                <span className="w-1 h-4 bg-purple-500 rounded-full" />
                                {isMasterpiece ? 'Masterpiece Analysis' : 'Gemini Evaluation'}
                            </h3>
                            <div className="bg-[#1A1A1A] rounded-xl p-5 border border-[#262626] text-sm leading-relaxed text-gray-300 shadow-sm relative">
                                {/* 对于 Auto Masterpiece，photo.reason 里存的是最后的修改意见 */}
                                <p>{photo.reason || "Analysis pending..."}</p>
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
