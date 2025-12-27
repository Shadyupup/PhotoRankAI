import { PhotoMetadata } from '@/lib/db';
import { PhotoCard } from './PhotoCard';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';

interface PhotoGridProps {
    photos: PhotoMetadata[];
    selectedIds: Set<string>;
    onToggleSelect: (id: string) => void;
    onView: (photo: PhotoMetadata) => void;
}

export function PhotoGrid({ photos, selectedIds, onToggleSelect, onView }: PhotoGridProps) {
    useEffect(() => {
        const scoredCount = photos.filter(p => p.status === 'scored').length;
        console.log(`[UI] PhotoGrid Rendered. Total=${photos.length}, Scored=${scoredCount}`);
    }, [photos]);

    if (photos.length === 0) {
        return (
            <div className="w-full h-full flex flex-col items-center justify-center text-gray-500">
                <p>No photos match the current filter.</p>
            </div>
        );
    }

    return (
        <div className="w-full h-full p-6 overflow-y-auto custom-scrollbar">
            <motion.div
                layout
                className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-6 pb-20"
            >
                <AnimatePresence mode='popLayout'>
                    {photos.map((photo) => (
                        <PhotoCard
                            key={photo.id}
                            photo={photo}
                            style={{ width: '100%', aspectRatio: '1/1' }}
                            selected={selectedIds.has(photo.id)}
                            onToggleSelect={onToggleSelect}
                            onView={onView}
                        />
                    ))}
                </AnimatePresence>
            </motion.div>
        </div>
    );
}
