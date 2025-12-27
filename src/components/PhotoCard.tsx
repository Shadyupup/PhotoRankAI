import { useEffect, useState, memo } from 'react';
import { PhotoMetadata } from '@/lib/db';
import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';
import { motion } from 'framer-motion';
import { ScoreBadge } from './ScoreBadge';

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
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setSrc(url);
            return () => URL.revokeObjectURL(url);
        }
    }, [photo.previewBlob]);

    return (
        <motion.div
            layout
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            transition={{
                type: "spring",
                stiffness: 300,
                damping: 25,
                layout: { duration: 0.4 }
            }}
            style={style}
            className={cn("relative group", className)}
        >
            <div
                className={cn(
                    "relative w-full aspect-square rounded-xl overflow-hidden bg-[#1A1A1A] border shadow-sm transition-all duration-300",
                    selected ? "border-blue-500 ring-2 ring-blue-500/20" : "border-[#262626] group-hover:border-gray-600"
                )}
                onClick={() => onView?.(photo)}
            >
                {/* Image */}
                {src ? (
                    <img
                        src={src}
                        alt={photo.name}
                        className={cn(
                            "w-full h-full object-cover transition-transform duration-500",
                            "group-hover:scale-105"
                        )}
                        loading="lazy"
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-700">
                        <div className="w-8 h-8 rounded-full border-2 border-current border-t-transparent animate-spin" />
                    </div>
                )}

                {/* Overlays */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60" />

                {/* Selection Checkbox */}
                <div
                    className={cn(
                        "absolute top-3 left-3 z-10 transition-all duration-200",
                        selected ? "opacity-100 scale-100" : "opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100"
                    )}
                    onClick={(e) => {
                        e.stopPropagation();
                        onToggleSelect?.(photo.id);
                    }}
                >
                    <div className={cn(
                        "w-6 h-6 rounded-md border flex items-center justify-center shadow-lg",
                        selected ? "bg-blue-500 border-blue-500 text-white" : "bg-black/40 border-white/30 hover:bg-black/60 backdrop-blur-md"
                    )}>
                        {selected && <Check size={14} />}
                    </div>
                </div>

                {/* Score Badge */}
                <div className="absolute top-3 right-3 z-10">
                    <ScoreBadge score={photo.score} status={photo.status} />
                </div>

                {/* Reason on Hover */}
                {photo.reason && (
                    <div className="absolute inset-x-0 bottom-0 p-3 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out bg-black/80 backdrop-blur-sm border-t border-white/10">
                        <p className="text-[11px] leading-relaxed text-gray-300 font-medium line-clamp-2">
                            "{photo.reason}"
                        </p>
                    </div>
                )}
            </div>
        </motion.div>
    );
});
