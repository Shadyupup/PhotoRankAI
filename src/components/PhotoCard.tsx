import { useEffect, useState, memo } from 'react';
import { PhotoMetadata, db } from '@/lib/db';
import { cn } from '@/lib/utils';
import { Check, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { ScoreBadge } from './ScoreBadge';
import { LOCAL_SCORER_URL } from '@/lib/local-scorer';
import { useTranslation } from '@/i18n';

interface PhotoCardProps {
    photo: PhotoMetadata;
    style?: React.CSSProperties;
    className?: string;
    selected?: boolean;
    onToggleSelect?: (id: string) => void;
    onView?: (photo: PhotoMetadata) => void;
    onReject?: (id: string) => void;
}

export const PhotoCard = memo(({ photo, style, className, selected, onToggleSelect, onView, onReject }: PhotoCardProps) => {
    const [src, setSrc] = useState<string | null>(null);
    const [loadFailed, setLoadFailed] = useState<boolean>(false);
    const { t } = useTranslation();

    // Lazy-load preview: try previewBlob → analysisBlob → original file handle
    useEffect(() => {
        let revoke: string | null = null;
        let cancelled = false;

        (async () => {
            const record = await db.photos.get(photo.id);
            if (cancelled || !record) return;

            const absolutePath = (record.file as any)?.path || (record as any).path;
            const isRaw = /\.(cr2|cr3|nef|arw|dng|raf)$/i.test(record.name);

            if (isRaw && absolutePath) {
                setSrc(`${LOCAL_SCORER_URL}/api/preview?path=${encodeURIComponent(absolutePath)}`);
                setLoadFailed(false);
                return;
            }

            // Priority: previewBlob > analysisBlob > original file
            // DB stores ArrayBuffer (WebKit compat), convert to Blob for display
            let blob: Blob | undefined;
            if (record.previewBlob) {
                blob = new Blob([record.previewBlob], { type: 'image/jpeg' });
            } else if (record.analysisBlob) {
                blob = new Blob([record.analysisBlob], { type: 'image/jpeg' });
            }

            if (!blob) {
                // Fallback: load from file handle and create a thumbnail
                try {
                    let file: File | undefined;
                    if (record.handle) {
                        file = await (record.handle as FileSystemFileHandle).getFile();
                    }
                    if (file) blob = file;
                } catch { /* permission lost, ignore */ }
            }

            if (cancelled) return;

            if (!blob) {
                // If we completely failed to find any image data, stop spinning
                setLoadFailed(true);
                return;
            }

            const url = URL.createObjectURL(blob);
            revoke = url;
            setSrc(url);
            setLoadFailed(false);
        })();

        return () => {
            cancelled = true;
            if (revoke) URL.revokeObjectURL(revoke);
        };
    }, [photo.id, photo.status]);

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
                onClick={(e) => {
                    if (loadFailed) {
                        e.stopPropagation();
                        window.dispatchEvent(new CustomEvent('request-fs-permission'));
                        return;
                    }
                    onView?.(photo);
                }}
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
                ) : loadFailed ? (
                    <div
                        className="w-full h-full flex flex-col items-center justify-center text-gray-400 bg-[#222] cursor-pointer hover:bg-[#333] transition-colors"
                        onClick={(e) => {
                            e.stopPropagation();
                            window.dispatchEvent(new CustomEvent('request-fs-permission'));
                        }}
                    >
                        <X className="w-8 h-8 mb-2 opacity-50 text-red-400" />
                        <span className="text-xs font-medium text-center px-4">{t('card.fileMissing')}<br /><span className="text-blue-400 underline mt-1 block">{t('card.clickToRelink')}</span></span>
                    </div>
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

                {/* Reject (Soft Delete) Button */}
                <div
                    className="absolute bottom-3 right-3 z-10 opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100 transition-all duration-200"
                    onClick={(e) => {
                        e.stopPropagation();
                        onReject?.(photo.id);
                    }}
                >
                    <div className="w-7 h-7 rounded-full bg-red-500/80 hover:bg-red-500 backdrop-blur-md border border-red-400/30 flex items-center justify-center shadow-lg cursor-pointer transition-colors">
                        <X size={14} className="text-white" />
                    </div>
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
}, (prevProps, nextProps) => {
    return (
        prevProps.photo.id === nextProps.photo.id &&
        prevProps.photo.status === nextProps.photo.status &&
        prevProps.photo.score === nextProps.photo.score &&
        prevProps.photo.rejected === nextProps.photo.rejected &&
        prevProps.selected === nextProps.selected &&
        prevProps.className === nextProps.className
    );
});
