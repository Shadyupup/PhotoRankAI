import { useEffect, useState, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { X, Sparkles, Loader2, Crown, Zap, Diamond, ArrowLeftRight, RefreshCw, ArrowLeft } from 'lucide-react';
import { LOCAL_SCORER_URL } from '@/lib/local-scorer';
import { cn } from '@/lib/utils';
import { useAutoOptimizer } from '@/hooks/useAutoOptimizer';
import { ComparisonSlider } from './ComparisonSlider';
import { toast } from 'sonner';
import { useTranslation } from '@/i18n';

interface PhotoDetailModalProps {
    photoId: string;
    onClose: () => void;
}

export function PhotoDetailModal({ photoId, onClose }: PhotoDetailModalProps) {
    const photo = useLiveQuery(() => db.photos.get(photoId), [photoId]);
    const { startOptimization, isOptimizing } = useAutoOptimizer();
    const { t } = useTranslation();

    // Image URL state
    const [currentSrc, setCurrentSrc] = useState<string | null>(null);
    const [originalSrc, setOriginalSrc] = useState<string | null>(null);

    // UI state
    const [mode, setMode] = useState<'instant' | 'iterative'>('instant');
    const [isComparing, setIsComparing] = useState(false); // Manual comparison state

    // Comparison axis position state (Controlled)
    const [sliderPosition, setSliderPosition] = useState(50);
    const prevSliderPositionRef = useRef(50);

    // Image loading logic
    useEffect(() => {
        if (!photo) return;

        let url1 = '';
        let url2 = '';

        const loadContent = async () => {
            try {
                const filePath = photo.filePath || (photo.file as any)?.path || (photo as any).path;

                if (photo.originalBlob && (photo.analysisBlob || photo.previewBlob)) {
                    const enhancedData = photo.analysisBlob || photo.previewBlob;
                    const enhancedBlob = new Blob([enhancedData!], { type: 'image/jpeg' });
                    url1 = URL.createObjectURL(enhancedBlob);
                    setCurrentSrc(url1);
                } else if (filePath) {
                    url1 = `${LOCAL_SCORER_URL}/api/preview?path=${encodeURIComponent(filePath)}`;
                    setCurrentSrc(url1);
                } else {
                    let mainBlob: Blob | undefined;
                    if (photo.handle) {
                        try { mainBlob = await photo.handle.getFile(); } catch { /* stale handle */ }
                    }
                    if (!mainBlob && photo.analysisBlob) mainBlob = new Blob([photo.analysisBlob], { type: 'image/jpeg' });
                    if (!mainBlob && photo.previewBlob) mainBlob = new Blob([photo.previewBlob], { type: 'image/jpeg' });
                    if (mainBlob) { url1 = URL.createObjectURL(mainBlob); setCurrentSrc(url1); }
                }

                if (photo.originalBlob) {
                    url2 = URL.createObjectURL(new Blob([photo.originalBlob], { type: 'image/jpeg' }));
                    setOriginalSrc(url2);
                } else {
                    setOriginalSrc(null);
                }
            } catch (e) {
                console.error("Failed to load image content", e);
            }
        };

        loadContent();
        return () => {
            if (url1 && url1.startsWith('blob:')) URL.revokeObjectURL(url1);
            if (url2 && url2.startsWith('blob:')) URL.revokeObjectURL(url2);
        };
    }, [photo]);

    const backdropMouseDownRef = useRef<EventTarget | null>(null);
    const handleBackdropMouseDown = (e: React.MouseEvent) => {
        backdropMouseDownRef.current = e.target === e.currentTarget ? e.target : null;
    };
    const handleBackdropMouseUp = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget && backdropMouseDownRef.current === e.currentTarget) onClose();
        backdropMouseDownRef.current = null;
    };

    const startCompare = () => {
        setIsComparing(true);
        prevSliderPositionRef.current = sliderPosition;
        setSliderPosition(0);
    };
    const endCompare = () => {
        setIsComparing(false);
        setSliderPosition(prevSliderPositionRef.current);
    };

    const handleRevert = async () => {
        if (!photo || !photo.originalBlob) return;
        const originalScore = photo.originalScore ?? 0;
        await db.photos.update(photo.id, {
            analysisBlob: undefined, previewBlob: photo.originalBlob,
            score: originalScore, originalScore: undefined, originalBlob: undefined,
            reason: t('detail.revertedReason')
        });
        toast.info(t('detail.revertTitle'), {
            description: t('detail.revertDesc').replace('{score}', originalScore.toFixed(1))
        });
        window.dispatchEvent(new CustomEvent('pipeline-wakeup'));
    };

    const handleRescore = async () => {
        if (!photo) return;
        const hasEnhancement = !!photo.originalBlob;
        const hasFilePath = !!photo.filePath;
        if (!photo.previewBlob && !hasFilePath) {
            toast.error(t('detail.noDataForRescore'));
            return;
        }
        toast.success(hasEnhancement ? t('detail.rescoringEnhanced') : t('detail.addedToQueue'));
        const updateData: Partial<{ status: string; score: undefined; reason: undefined; analysisBlob: ArrayBuffer }> = {
            status: 'queued', score: undefined, reason: undefined,
        };
        if (photo.previewBlob) updateData.analysisBlob = photo.previewBlob;
        await db.photos.update(photo.id, updateData as any);
        window.dispatchEvent(new CustomEvent('pipeline-wakeup'));
    };

    if (!photo) {
        return (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md">
                <Loader2 className="animate-spin text-white" size={48} />
            </div>
        );
    }

    const isMasterpiece = !!photo.originalBlob;
    const canShowComparison = isMasterpiece && originalSrc && currentSrc;
    const displayScore = (isComparing && photo.originalScore) ? photo.originalScore : photo.score;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md p-6"
            onMouseDown={handleBackdropMouseDown} onMouseUp={handleBackdropMouseUp}>
            <div className="bg-[#0F0F0F] rounded-2xl overflow-hidden max-w-6xl w-full h-[85vh] flex flex-col md:flex-row shadow-2xl border border-[#262626]"
                onClick={e => e.stopPropagation()}>
                {/* Image Section */}
                <div className="flex-1 bg-[#050505] flex items-center justify-center relative overflow-hidden">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-blue-900/10 via-transparent to-transparent pointer-events-none" />

                    <button onClick={onClose}
                        className="absolute top-4 left-4 z-10 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-black/60 backdrop-blur-md text-white text-sm font-medium hover:bg-black/80 transition-colors border border-white/10">
                        <ArrowLeft size={16} />
                        {t('detail.back')}
                    </button>

                    <div className="w-full h-full flex items-center justify-center overflow-hidden">
                        {canShowComparison ? (
                            <ComparisonSlider original={originalSrc!} processed={currentSrc!} position={sliderPosition} onPositionChange={setSliderPosition} />
                        ) : currentSrc ? (
                            <img src={currentSrc} alt={photo.name} className="max-w-full max-h-full object-contain shadow-2xl" />
                        ) : (
                            <div className="text-gray-500 animate-pulse">{t('detail.loading')}</div>
                        )}
                    </div>

                    {isMasterpiece && canShowComparison && (
                        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-4 z-30">
                            <button onClick={handleRevert}
                                className="flex items-center gap-2 px-4 py-2 bg-red-600/80 backdrop-blur-md border border-red-500/50 rounded-full text-white font-bold hover:bg-red-500 transition-all active:scale-95 select-none shadow-[0_0_15px_rgba(239,68,68,0.4)]">
                                <X size={16} /> {t('detail.revert')}
                            </button>
                            <button onMouseDown={startCompare} onMouseUp={endCompare} onMouseLeave={endCompare}
                                onTouchStart={startCompare} onTouchEnd={endCompare}
                                className="flex items-center gap-2 px-6 py-2 bg-black/60 backdrop-blur-md border border-white/20 rounded-full text-white font-bold hover:bg-black/80 transition-all active:scale-95 select-none shadow-lg group">
                                <ArrowLeftRight size={16} className="group-hover:rotate-180 transition-transform duration-500" />
                                {isComparing ? t('detail.showingOriginal') : t('detail.holdToCompare')}
                            </button>
                        </div>
                    )}
                </div>

                {/* Info Section */}
                <div className="w-full md:w-[400px] bg-[#0F0F0F] flex flex-col border-l border-[#262626]">
                    <div className="p-4 border-b border-[#262626] bg-[#161616] space-y-3">
                        <div className="flex justify-between items-center">
                            <div className="overflow-hidden mr-4">
                                <h2 className="text-lg font-bold text-white truncate">{photo.name}</h2>
                                <p className="text-xs text-gray-500 font-mono">{photo.status === 'scored' ? t('detail.analyzed') : t('detail.processing')}</p>
                            </div>
                            <button onClick={onClose} className="p-2 hover:bg-[#262626] rounded-lg text-gray-400 hover:text-white transition-colors shrink-0">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                            <div className="flex bg-black/40 rounded-lg p-1 border border-white/10">
                                <button onClick={() => setMode('instant')}
                                    className={cn("px-2.5 py-1 rounded-md text-xs font-bold flex items-center gap-1 transition-all",
                                        mode === 'instant' ? "bg-[#262626] text-blue-400 shadow-sm" : "text-gray-500 hover:text-gray-300")}
                                    title={t('detail.fastTip')}>
                                    <Zap size={12} /> {t('detail.fast')}
                                </button>
                                <button onClick={() => setMode('iterative')}
                                    className={cn("px-2.5 py-1 rounded-md text-xs font-bold flex items-center gap-1 transition-all",
                                        mode === 'iterative' ? "bg-[#262626] text-purple-400 shadow-sm" : "text-gray-500 hover:text-gray-300")}
                                    title={t('detail.proTip')}>
                                    <Diamond size={12} /> {t('detail.pro')}
                                </button>
                            </div>

                            <div className="flex items-center gap-2">
                                <button onClick={handleRescore}
                                    disabled={photo.status === 'queued' || photo.status === 'analyzing'}
                                    className={cn("flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all border border-[#333] bg-[#1A1A1A] hover:bg-[#262626] text-white shadow-sm",
                                        (photo.status === 'queued' || photo.status === 'analyzing') && "opacity-50 cursor-not-allowed",
                                        !(photo.status === 'queued' || photo.status === 'analyzing') && "active:scale-95")}
                                    title={t('detail.rescoreTip')}>
                                    <RefreshCw size={12} className={cn((photo.status === 'queued' || photo.status === 'analyzing') && "animate-spin")} />
                                    {t('detail.rescore')}
                                </button>

                                <button onClick={() => startOptimization(photo, mode)} disabled={isOptimizing}
                                    className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border",
                                        isOptimizing ? "bg-gray-800 border-gray-700 text-gray-500 cursor-not-allowed"
                                            : mode === 'instant' ? "bg-blue-600 hover:bg-blue-500 border-blue-500 text-white shadow-blue-900/20"
                                                : "bg-purple-600 hover:bg-purple-500 border-purple-500 text-white shadow-purple-900/20",
                                        !isOptimizing && "hover:scale-105 active:scale-95")}>
                                    {isOptimizing ? (
                                        <> <Loader2 size={12} className="animate-spin" /> {t('detail.processing')} </>
                                    ) : (
                                        <> <Sparkles size={12} /> {t('detail.enhance')} </>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
                        <div className="flex flex-col items-center justify-center p-8 rounded-2xl bg-[#1A1A1A] border border-[#262626] shadow-inner relative overflow-hidden group">
                            <div className={cn("absolute inset-0 bg-gradient-to-br opacity-50 transition-colors duration-500",
                                isMasterpiece && !isComparing ? "from-yellow-600/20 to-orange-600/20" : "from-gray-500/5 to-gray-500/5")} />
                            <div className="relative z-10 flex flex-col items-center">
                                <span className={cn("text-6xl font-black tracking-tighter mb-2 bg-clip-text text-transparent bg-gradient-to-br transition-all duration-300",
                                    isMasterpiece && !isComparing ? "from-yellow-300 to-amber-500"
                                        : (displayScore || 0) >= 9 ? "from-green-400 to-emerald-600"
                                            : (displayScore || 0) >= 7 ? "from-blue-400 to-indigo-600"
                                                : "from-orange-400 to-red-600",
                                    isComparing && "opacity-80 grayscale-[0.3]")}>
                                    {displayScore ? displayScore.toFixed(1) : 'N/A'}
                                </span>
                                {isMasterpiece ? (
                                    <div className="flex flex-col items-center gap-1">
                                        <div className={cn("flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-semibold uppercase tracking-widest transition-colors",
                                            isComparing ? "text-gray-400" : "text-yellow-400")}>
                                            <Crown size={12} /> {isComparing ? t('detail.originalScore') : t('detail.masterpieceScore')}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-semibold text-gray-400 uppercase tracking-widest">
                                        <Sparkles size={12} className="text-blue-400" /> {t('detail.aiScore')}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div>
                            <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider mb-4 flex items-center gap-2">
                                <span className="w-1 h-4 bg-purple-500 rounded-full" />
                                {isMasterpiece ? t('detail.masterpieceAnalysis') : t('detail.aiEvaluation')}
                            </h3>
                            <div className="bg-[#1A1A1A] rounded-xl p-5 border border-[#262626] text-sm leading-relaxed text-gray-300 shadow-sm">
                                <p>{photo.reason || t('detail.analysisPending')}</p>
                            </div>
                        </div>
                    </div>

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
