import { PhotoMetadata } from '@/lib/db';
import { PhotoCard } from './PhotoCard';
import { useEffect, forwardRef } from 'react';
import { VirtuosoGrid } from 'react-virtuoso';

interface PhotoGridProps {
    photos: PhotoMetadata[];
    selectedIds: Set<string>;
    onToggleSelect: (id: string) => void;
    onView: (photo: PhotoMetadata) => void;
    onReject: (id: string) => void;
}

export function PhotoGrid({ photos, selectedIds, onToggleSelect, onView, onReject }: PhotoGridProps) {
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
        <div className="w-full h-full p-6">
            <VirtuosoGrid
                style={{ height: '100%' }}
                totalCount={photos.length}
                data={photos}
                computeItemKey={(_, item) => item.id}
                components={{
                    List: forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ style, children, ...props }, ref) => (
                        <div
                            ref={ref}
                            {...props}
                            style={style}
                            className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-6 pb-20"
                        >
                            {children}
                        </div>
                    )),
                    Item: (props) => (
                        <div {...props} style={{ ...props.style, width: '100%', aspectRatio: '1/1' }} />
                    )
                }}
                itemContent={(_, photo) => (
                    <PhotoCard
                        key={photo.id}
                        photo={photo}
                        style={{ width: '100%', height: '100%' }}
                        selected={selectedIds.has(photo.id)}
                        onToggleSelect={onToggleSelect}
                        onView={onView}
                        onReject={onReject}
                    />
                )}
            />
        </div>
    );
}
