import { useEffect, useState, memo } from 'react';
import { PhotoMetadata } from '@/lib/db';
import { cn } from '@/lib/utils';
import { Check, Loader2, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface PhotoCardProps {
    photo: PhotoMetadata;
    style?: React.CSSProperties;
    className?: string;
    selected?: boolean;
    onToggleSelect?: (id: string) => void;
    onView?: (photo: PhotoMetadata) => void;
}

export const PhotoCard = memo(({ photo, style, className, selected, onToggleSelect, onView }: PhotoCardProps) => {
    const [src, setSrc] = useState<string | null>(null);

    useEffect(() => {
        if (photo.previewBlob) {
            const url = URL.createObjectURL(photo.previewBlob);
            setSrc(url);
            return () => URL.revokeObjectURL(url);
        }
    }, [photo.previewBlob]);

    // SaaS Style Badge Colors - Vibrant & Distinct
    const getBadgeStyle = (score?: number) => {
        if (!score) return 'bg-gray-800/90 text-gray-400 border border-white/10';

        // High Score (> 8.0): Electric Green/Blue Gradient + Glow
        if (score >= 8.0) return 'bg-gradient-to-r from-emerald-500/80 to-teal-500/80 text-white font-bold border border-emerald-400/50 shadow-[0_0_12px_rgba(16,185,129,0.4)]';

        // Good Score (6.0 - 7.9): Bright Amber/Orange
        if (score >= 6.0) return 'bg-amber-500/80 text-white font-medium border border-amber-400/50 shadow-[0_0_8px_rgba(245,158,11,0.2)]';

        // Average/Low (< 6.0): Muted Blue-Grey (Visible but receded)
        return 'bg-slate-700/80 text-gray-200 border border-white/10';
    };

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            style={style}
            className={cn("p-2", className)}
        >
            <div
                className={cn(
                    "relative w-full h-full rounded-xl overflow-hidden cursor-pointer group bg-[#161618]",
                    "border transition-all duration-300",
                    selected ? "border-blue-500 ring-1 ring-blue-500/50" : "border-white/5 hover:border-white/20"
                )}
                onClick={() => onView?.(photo)}
            >
                {/* Image Layer */}
                <div className="w-full h-full overflow-hidden">
                    {src ? (
                        <motion.img
                            src={src}
                            alt={photo.name}
                            className="w-full h-full object-cover"
                            whileHover={{ scale: 1.05 }}
                            transition={{ duration: 0.4 }}
                            loading="lazy"
                        />
                    ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center bg-[#161618] text-gray-600 gap-2">
                            <div className="w-8 h-8 rounded-full border-2 border-current border-t-transparent animate-spin" />
                            <span className="text-xs font-medium tracking-wide">PROCESSING</span>
                        </div>
                    )}
                </div>

                {/* Hover Overlay with Reason */}
                {photo.reason && (
                    <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/90 via-black/60 to-transparent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out flex flex-col justify-end">
                        <p className="text-white/90 text-sm font-light leading-relaxed line-clamp-3">
                            {photo.reason}
                        </p>
                    </div>
                )}

                {/* Selection Checkbox (Top Left) */}
                <div
                    className="absolute top-3 left-3 z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                    onClick={(e) => {
                        e.stopPropagation();
                        onToggleSelect?.(photo.id);
                    }}
                >
                    <div className={cn(
                        "w-6 h-6 rounded-lg border flex items-center justify-center transition-all bg-black/40 backdrop-blur-sm",
                        selected ? "bg-blue-500 border-blue-500 opacity-100" : "border-white/30 hover:bg-black/60 hover:border-white/60"
                    )}>
                        {selected && <Check size={14} className="text-white" />}
                    </div>
                </div>
                {/* Always show checkbox if selected */}
                {selected && (
                    <div className="absolute top-3 left-3 z-10 p-1">
                        <div className="w-6 h-6 rounded-lg bg-blue-500 border-blue-500 flex items-center justify-center shadow-lg">
                            <Check size={14} className="text-white" />
                        </div>
                    </div>
                )}


                {/* Score Badge (Top Right) */}
                {photo.score !== undefined && (
                    <div className={cn(
                        "absolute top-3 right-3 px-2.5 py-1 rounded-lg text-xs font-semibold backdrop-blur-md flex items-center gap-1.5",
                        getBadgeStyle(photo.score)
                    )}>
                        {photo.score >= 8.5 && <Sparkles size={10} className="text-emerald-300" />}
                        {photo.score.toFixed(1)}
                    </div>
                )}

                {/* Loading/Processing Overlay */}
                {photo.status === 'processing' && (
                    <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px] flex flex-col items-center justify-center z-20">
                        <Loader2 className="animate-spin text-white/80 mb-2" size={24} />
                        <span className="text-xs text-white/60 font-medium tracking-widest uppercase">Analyzing</span>
                    </div>
                )}
            </div>
        </motion.div>
    );
});

