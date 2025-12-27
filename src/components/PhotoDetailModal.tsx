import { useEffect, useState } from 'react';
import { PhotoMetadata } from '@/lib/db';
import { X, Check } from 'lucide-react';

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
            setSrc(url);
            return () => URL.revokeObjectURL(url);
        } else if (photo.file) {
            const url = URL.createObjectURL(photo.file);
            setSrc(url);
            return () => URL.revokeObjectURL(url);
        }
    }, [photo]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
            <div
                className="bg-[#1a1a1a] rounded-2xl overflow-hidden max-w-5xl w-full max-h-[90vh] flex flex-col md:flex-row shadow-2xl border border-gray-800"
                onClick={e => e.stopPropagation()}
            >
                {/* Image Section */}
                <div className="flex-1 bg-black flex items-center justify-center p-4 min-h-[400px]">
                    {src ? (
                        <img
                            src={src}
                            alt={photo.name}
                            className="max-w-full max-h-full object-contain"
                        />
                    ) : (
                        <div className="text-gray-500">Loading image...</div>
                    )}
                </div>

                {/* Info Section */}
                <div className="w-full md:w-96 bg-[#1a1a1a] p-6 flex flex-col border-l border-gray-800">
                    <div className="flex justify-between items-start mb-6">
                        <h2 className="text-xl font-bold truncate pr-4" title={photo.name}>{photo.name}</h2>
                        <button
                            onClick={onClose}
                            className="p-1 hover:bg-gray-800 rounded-full transition-colors"
                        >
                            <X size={24} className="text-gray-400 hover:text-white" />
                        </button>
                    </div>

                    <div className="mb-8">
                        <div className="flex items-center gap-4 mb-4">
                            <div className={`text-4xl font-bold ${getScoreColor(photo.score)}`}>
                                {photo.score ? photo.score.toFixed(1) : '-'}
                            </div>
                            <div className="text-sm text-gray-400 font-medium tracking-wider uppercase">
                                Aesthetic Score
                            </div>
                        </div>

                        <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
                            <h3 className="text-sm font-semibold text-gray-300 mb-2 flex items-center gap-2">
                                <span className="w-1 h-4 bg-blue-500 rounded-full" />
                                AI Analysis
                            </h3>
                            <p className="text-gray-300 leading-relaxed">
                                {photo.reason || "No analysis available for this photo."}
                            </p>
                        </div>
                    </div>

                    <div className="mt-auto">
                        <div className="text-xs text-gray-500 font-mono mb-2">
                            ID: {photo.id}
                        </div>
                        {/* Placeholder for future actions like 'Keep' or 'Delete' */}
                    </div>
                </div>
            </div>
        </div>
    );
}

function getScoreColor(score?: number) {
    if (!score) return 'text-gray-500';
    if (score >= 7.5) return 'text-green-400';
    if (score >= 5.0) return 'text-yellow-400';
    return 'text-red-400';
}
