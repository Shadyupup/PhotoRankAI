import { useEffect, useState, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { X, Sparkles, Loader2, Crown, Zap, Diamond, ArrowLeftRight, RefreshCw, ArrowLeft } from 'lucide-react';
import { LOCAL_SCORER_URL } from '@/lib/local-scorer';
import { cn } from '@/lib/utils';
import { useAutoOptimizer } from '@/hooks/useAutoOptimizer';
import { ComparisonSlider } from './ComparisonSlider';
import { toast } from 'sonner';

interface PhotoDetailModalProps {
    photoId: string;
    onClose: () => void;
}

export function PhotoDetailModal({ photoId, onClose }: PhotoDetailModalProps) {
    const photo = useLiveQuery(() => db.photos.get(photoId), [photoId]);
    const { startOptimization, isOptimizing } = useAutoOptimizer();

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

                // If photo has been enhanced (originalBlob = backup of pre-enhancement),
                // show the enhanced version from DB, not the original file from disk
                if (photo.originalBlob && (photo.analysisBlob || photo.previewBlob)) {
                    const enhancedData = photo.analysisBlob || photo.previewBlob;
                    const enhancedBlob = new Blob([enhancedData!], { type: 'image/jpeg' });
                    url1 = URL.createObjectURL(enhancedBlob);
                    setCurrentSrc(url1);
                } else if (filePath) {
                    // No enhancement: load original file from disk via backend API
                    url1 = `${LOCAL_SCORER_URL}/api/preview?path=${encodeURIComponent(filePath)}`;
                    setCurrentSrc(url1);
                } else {
                    // No file path available — fall back to stored blobs
                    let mainBlob: Blob | undefined;

                    // 1. Try file handle (File System Access API)
                    if (photo.handle) {
                        try {
                            mainBlob = await photo.handle.getFile();
                        } catch {
                            // Handle may be stale
                        }
                    }

                    // 2. Analysis blob (512px)
                    if (!mainBlob && photo.analysisBlob) {
                        mainBlob = new Blob([photo.analysisBlob], { type: 'image/jpeg' });
                    }

                    // 3. Preview blob (300px)
                    if (!mainBlob && photo.previewBlob) {
                        mainBlob = new Blob([photo.previewBlob], { type: 'image/jpeg' });
                    }

                    if (mainBlob) {
                        url1 = URL.createObjectURL(mainBlob);
                        setCurrentSrc(url1);
                    }
                }

                // 2. If original backup exists (Masterpiece mode), load it for comparison
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

    // Robust close logic: only close when mousedown AND mouseup both on backdrop
    // Prevents accidental close from dragging inside to outside
    const backdropMouseDownRef = useRef<EventTarget | null>(null);

    const handleBackdropMouseDown = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            backdropMouseDownRef.current = e.target;
        } else {
            backdropMouseDownRef.current = null;
        }
    };

    const handleBackdropMouseUp = (e: React.MouseEvent) => {
        // Only close if mousedown also happened on backdrop
        if (e.target === e.currentTarget && backdropMouseDownRef.current === e.currentTarget) {
            onClose();
        }
        backdropMouseDownRef.current = null;
    };

    // Hold to Compare interaction logic
    const startCompare = () => {
        setIsComparing(true);
        prevSliderPositionRef.current = sliderPosition; // Remember current position
        setSliderPosition(0); // Move to far left (show 100% Original)
    };

    const endCompare = () => {
        setIsComparing(false);
        setSliderPosition(prevSliderPositionRef.current); // Restore previous position
    };

    const handleRevert = async () => {
        if (!photo || !photo.originalBlob) return;

        const originalScore = photo.originalScore ?? 0;

        await db.photos.update(photo.id, {
            analysisBlob: undefined,
            previewBlob: photo.originalBlob, // Restore to pre-enhancement
            score: originalScore,
            originalScore: undefined,
            originalBlob: undefined,
            reason: "Enhancement reverted. Original score restored."
        });

        // Notify user in case the photo disappears from the current filter view
        toast.info("AI Enhancement Cancelled", {
            description: `Original score (${originalScore.toFixed(1)}) restored. Photo may be hidden if it doesn't meet the current Min Score filter.`
        });

        // Let the pipeline know
        window.dispatchEvent(new CustomEvent('pipeline-wakeup'));
    };

    const handleRescore = async () => {
        if (!photo) return;

        // Determine what to score:
        // - If enhanced (originalBlob exists): re-score the enhanced version (stored in previewBlob)
        // - If not enhanced but has filePath: use path mode (backend reads original from disk)
        // - Otherwise: fall back to previewBlob (the stored thumbnail/preview)
        const hasEnhancement = !!photo.originalBlob;
        const hasFilePath = !!photo.filePath;

        if (!photo.previewBlob && !hasFilePath) {
            toast.error("No image data available for re-scoring.");
            return;
        }

        toast.success(hasEnhancement
            ? "Re-scoring enhanced version..."
            : "Photo added to queue for re-scoring."
        );

        const updateData: Partial<{
            status: string;
            score: undefined;
            reason: undefined;
            analysisBlob: ArrayBuffer;
        }> = {
            status: 'queued',
            score: undefined,
            reason: undefined,
            // Do NOT touch originalScore or originalBlob so Masterpieces stay Masterpieces
        };

        if (photo.previewBlob) {
            // Use the current previewBlob (enhanced if enhancement was applied, original preview otherwise)
            updateData.analysisBlob = photo.previewBlob;
        }
        // If no previewBlob but has filePath, the pipeline will read via path from disk

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

    // Determine slider mode: must have original backup and main image
    // isMasterpiece = has original backup
    const isMasterpiece = !!photo.originalBlob;
    // canShowComparison = whether comparison can be shown
    const canShowComparison = isMasterpiece && originalSrc && currentSrc;

    // Score display logic: when comparing, show original score; otherwise current score
    // If isComparing (held) -> photo.originalScore
    // Otherwise -> photo.score
    // Note: In ComparisonSlider mode, default shows Enhanced Score; only changes when button held
    const displayScore = (isComparing && photo.originalScore)
        ? photo.originalScore
        : photo.score;

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md p-6"
            onMouseDown={handleBackdropMouseDown}
            onMouseUp={handleBackdropMouseUp}
        >
            <div
                className="bg-[#0F0F0F] rounded-2xl overflow-hidden max-w-6xl w-full h-[85vh] flex flex-col md:flex-row shadow-2xl border border-[#262626]"
                onClick={e => e.stopPropagation()}
            // Removed onMouseDown/Up stopPropagation to fix slider sticky issue
            >
                {/* Image Section */}
                <div className="flex-1 bg-[#050505] flex items-center justify-center relative overflow-hidden">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-blue-900/10 via-transparent to-transparent pointer-events-none" />

                    {/* Floating Back Button */}
                    <button
                        onClick={onClose}
                        className="absolute top-4 left-4 z-10 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-black/60 backdrop-blur-md text-white text-sm font-medium hover:bg-black/80 transition-colors border border-white/10"
                    >
                        <ArrowLeft size={16} />
                        Back
                    </button>

                    <div className="w-full h-full flex items-center justify-center overflow-hidden">
                        {/* Optimized view: always render ComparisonSlider, control via sliderPosition */}
                        {canShowComparison ? (
                            <ComparisonSlider
                                original={originalSrc!}
                                processed={currentSrc!}
                                position={sliderPosition}
                                onPositionChange={setSliderPosition}
                            />
                        ) : currentSrc ? (
                            <img
                                src={currentSrc}
                                alt={photo.name}
                                className="max-w-full max-h-full object-contain shadow-2xl"
                            />
                        ) : (
                            <div className="text-gray-500 animate-pulse">Loading image...</div>
                        )}
                    </div>

                    {/* Hold to Compare button (Overlay) */}
                    {isMasterpiece && canShowComparison && (
                        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-4 z-30">
                            {/* Revert button */}
                            <button
                                onClick={handleRevert}
                                className="flex items-center gap-2 px-4 py-2 bg-red-600/80 backdrop-blur-md border border-red-500/50 rounded-full text-white font-bold hover:bg-red-500 transition-all active:scale-95 select-none shadow-[0_0_15px_rgba(239,68,68,0.4)]"
                            >
                                <X size={16} /> Revert
                            </button>

                            <button
                                onMouseDown={startCompare}
                                onMouseUp={endCompare}
                                onMouseLeave={endCompare}
                                onTouchStart={startCompare}
                                onTouchEnd={endCompare}
                                className="flex items-center gap-2 px-6 py-2 bg-black/60 backdrop-blur-md border border-white/20 rounded-full text-white font-bold hover:bg-black/80 transition-all active:scale-95 select-none shadow-lg group"
                            >
                                <ArrowLeftRight size={16} className="group-hover:rotate-180 transition-transform duration-500" />
                                {isComparing ? 'Showing Original' : 'Hold to Compare'}
                            </button>
                        </div>
                    )}



                </div>

                {/* Info Section */}
                <div className="w-full md:w-[400px] bg-[#0F0F0F] flex flex-col border-l border-[#262626]">
                    <div className="p-4 border-b border-[#262626] bg-[#161616] space-y-3">
                        {/* Row 1: Title + Close */}
                        <div className="flex justify-between items-center">
                            <div className="overflow-hidden mr-4">
                                <h2 className="text-lg font-bold text-white truncate">{photo.name}</h2>
                                <p className="text-xs text-gray-500 font-mono">{photo.status === 'scored' ? 'Analyzed' : 'Processing...'}</p>
                            </div>
                            <button onClick={onClose} className="p-2 hover:bg-[#262626] rounded-lg text-gray-400 hover:text-white transition-colors shrink-0">
                                <X size={20} />
                            </button>
                        </div>
                        {/* Row 2: Mode switcher + Actions */}
                        <div className="flex items-center gap-2 flex-wrap">
                            {/* Mode switcher */}
                            <div className="flex bg-black/40 rounded-lg p-1 border border-white/10">
                                <button
                                    onClick={() => setMode('instant')}
                                    className={cn(
                                        "px-2.5 py-1 rounded-md text-xs font-bold flex items-center gap-1 transition-all",
                                        mode === 'instant' ? "bg-[#262626] text-blue-400 shadow-sm" : "text-gray-500 hover:text-gray-300"
                                    )}
                                    title="AI one-click enhance"
                                >
                                    <Zap size={12} /> Fast
                                </button>

                                <button
                                    onClick={() => setMode('iterative')}
                                    className={cn(
                                        "px-2.5 py-1 rounded-md text-xs font-bold flex items-center gap-1 transition-all",
                                        mode === 'iterative' ? "bg-[#262626] text-purple-400 shadow-sm" : "text-gray-500 hover:text-gray-300"
                                    )}
                                    title="Pro iterative refinement"
                                >
                                    <Diamond size={12} /> Pro
                                </button>
                            </div>

                            <div className="flex items-center gap-2">
                                <button
                                    onClick={handleRescore}
                                    disabled={photo.status === 'queued' || photo.status === 'analyzing'}
                                    className={cn(
                                        "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all border border-[#333] bg-[#1A1A1A] hover:bg-[#262626] text-white shadow-sm",
                                        (photo.status === 'queued' || photo.status === 'analyzing') && "opacity-50 cursor-not-allowed",
                                        !(photo.status === 'queued' || photo.status === 'analyzing') && "active:scale-95"
                                    )}
                                    title="Re-evaluate AI Score"
                                >
                                    <RefreshCw size={12} className={cn((photo.status === 'queued' || photo.status === 'analyzing') && "animate-spin")} />
                                    Re-score
                                </button>

                                <button
                                    onClick={() => startOptimization(photo, mode)}
                                    disabled={isOptimizing}
                                    className={cn(
                                        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border",
                                        isOptimizing
                                            ? "bg-gray-800 border-gray-700 text-gray-500 cursor-not-allowed"
                                            : mode === 'instant'
                                                ? "bg-blue-600 hover:bg-blue-500 border-blue-500 text-white shadow-blue-900/20"
                                                : "bg-purple-600 hover:bg-purple-500 border-purple-500 text-white shadow-purple-900/20",
                                        !isOptimizing && "hover:scale-105 active:scale-95"
                                    )}
                                >
                                    {isOptimizing ? (
                                        <> <Loader2 size={12} className="animate-spin" /> Processing... </>
                                    ) : (
                                        <> <Sparkles size={12} /> Enhance </>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Content Section */}
                    <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
                        {/* Score Card */}
                        <div className="flex flex-col items-center justify-center p-8 rounded-2xl bg-[#1A1A1A] border border-[#262626] shadow-inner relative overflow-hidden group">
                            <div className={cn(
                                "absolute inset-0 bg-gradient-to-br opacity-50 transition-colors duration-500",
                                // Logic: if has original and not comparing, show gold; else gray
                                isMasterpiece && !isComparing ? "from-yellow-600/20 to-orange-600/20" : "from-gray-500/5 to-gray-500/5"
                            )} />

                            <div className="relative z-10 flex flex-col items-center">
                                <span className={cn(
                                    "text-6xl font-black tracking-tighter mb-2 bg-clip-text text-transparent bg-gradient-to-br transition-all duration-300",
                                    // Font color logic
                                    isMasterpiece && !isComparing ? "from-yellow-300 to-amber-500" :
                                        (displayScore || 0) >= 9 ? "from-green-400 to-emerald-600" :
                                            (displayScore || 0) >= 7 ? "from-blue-400 to-indigo-600" :
                                                "from-orange-400 to-red-600",
                                    // Slightly dim during comparison
                                    isComparing && "opacity-80 grayscale-[0.3]"
                                )}>
                                    {displayScore ? displayScore.toFixed(1) : 'N/A'}
                                </span>

                                {isMasterpiece ? (
                                    <div className="flex flex-col items-center gap-1">
                                        <div className={cn(
                                            "flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-semibold uppercase tracking-widest transition-colors",
                                            isComparing ? "text-gray-400" : "text-yellow-400"
                                        )}>
                                            <Crown size={12} /> {isComparing ? 'Original Score' : 'Masterpiece Score'}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-semibold text-gray-400 uppercase tracking-widest">
                                        <Sparkles size={12} className="text-blue-400" /> AI Score
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Feedback */}
                        <div>
                            <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider mb-4 flex items-center gap-2">
                                <span className="w-1 h-4 bg-purple-500 rounded-full" />
                                {isMasterpiece ? 'Masterpiece Analysis' : 'Gemini Evaluation'}
                            </h3>
                            <div className="bg-[#1A1A1A] rounded-xl p-5 border border-[#262626] text-sm leading-relaxed text-gray-300 shadow-sm">
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
