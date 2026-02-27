import React, { useState, useRef, useCallback, useEffect } from 'react';
import { ChevronsLeftRight } from 'lucide-react';

interface ComparisonSliderProps {
    original: string;
    processed: string;
    // Controlled props
    position: number;
    onPositionChange: (pos: number) => void;
}

/**
 * ComparisonSlider that handles images of different dimensions.
 * 
 * Strategy: Both images are rendered inside a shared "display box" that is
 * computed from the container size. Each image uses object-fit:cover on this
 * shared box so they occupy the exact same visual rectangle, preventing any
 * leaking at the slider boundary.
 */
export const ComparisonSlider: React.FC<ComparisonSliderProps> = ({
    original,
    processed,
    position,
    onPositionChange
}) => {
    const [isDragging, setIsDragging] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // Track natural dimensions for both images
    const [origSize, setOrigSize] = useState<{ w: number; h: number } | null>(null);
    const [procSize, setProcSize] = useState<{ w: number; h: number } | null>(null);

    // Unified move handler
    const handleMove = useCallback((clientX: number) => {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
        const percentage = (x / rect.width) * 100;
        onPositionChange(percentage);
    }, [onPositionChange]);

    // Mouse/touch start
    const handleMouseDown = useCallback((e: React.MouseEvent | React.TouchEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);

        let clientX;
        if ('touches' in e) {
            clientX = e.touches[0].clientX;
        } else {
            clientX = (e as React.MouseEvent).clientX;
        }
        handleMove(clientX);
    }, [handleMove]);

    // Mouse/touch end (global)
    const handleMouseUp = useCallback(() => setIsDragging(false), []);

    // Global event listeners (active only during drag)
    useEffect(() => {
        if (!isDragging) return;

        const onMouseMove = (e: MouseEvent) => handleMove(e.clientX);
        const onTouchMove = (e: TouchEvent) => handleMove(e.touches[0].clientX);

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('touchmove', onTouchMove);
        window.addEventListener('mouseup', handleMouseUp);
        window.addEventListener('touchend', handleMouseUp);

        return () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('touchmove', onTouchMove);
            window.removeEventListener('mouseup', handleMouseUp);
            window.removeEventListener('touchend', handleMouseUp);
        };
    }, [isDragging, handleMove, handleMouseUp]);

    // Compute shared display box: the intersection aspect ratio that fits both
    // images within the container. We use the WIDER aspect ratio (larger w/h)
    // so that object-fit:cover on the shared box minimally crops both images.
    const [displayBox, setDisplayBox] = useState<{ width: number; height: number; top: number; left: number } | null>(null);

    useEffect(() => {
        if (!containerRef.current) return;

        const updateBox = () => {
            const container = containerRef.current;
            if (!container) return;
            const cw = container.clientWidth;
            const ch = container.clientHeight;
            if (cw === 0 || ch === 0) return;

            // If we don't have both image sizes yet, just fill container
            if (!origSize || !procSize) {
                setDisplayBox({ width: cw, height: ch, top: 0, left: 0 });
                return;
            }

            // Compute the aspect ratio of each image
            const origAR = origSize.w / origSize.h;
            const procAR = procSize.w / procSize.h;

            // Use the WIDER aspect ratio (larger AR) so both images can be shown
            // with object-fit:cover without excessive cropping
            const sharedAR = Math.max(origAR, procAR);

            // Fit the shared AR box inside the container (contain-style)
            let boxW: number, boxH: number;
            if (sharedAR > cw / ch) {
                // Wider than container → constrained by width
                boxW = cw;
                boxH = cw / sharedAR;
            } else {
                // Taller than container → constrained by height
                boxH = ch;
                boxW = ch * sharedAR;
            }

            setDisplayBox({
                width: boxW,
                height: boxH,
                top: (ch - boxH) / 2,
                left: (cw - boxW) / 2,
            });
        };

        updateBox();

        const observer = new ResizeObserver(updateBox);
        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, [origSize, procSize]);

    const handleOrigLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
        const img = e.currentTarget;
        setOrigSize({ w: img.naturalWidth, h: img.naturalHeight });
    }, []);

    const handleProcLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
        const img = e.currentTarget;
        setProcSize({ w: img.naturalWidth, h: img.naturalHeight });
    }, []);

    const boxStyle: React.CSSProperties = displayBox
        ? {
            position: 'absolute',
            top: displayBox.top,
            left: displayBox.left,
            width: displayBox.width,
            height: displayBox.height,
        }
        : { position: 'absolute', inset: 0 };

    return (
        <div
            ref={containerRef}
            className="relative w-full h-full select-none cursor-ew-resize overflow-hidden group"
            onMouseDown={handleMouseDown}
            onTouchStart={handleMouseDown}
        >
            {/* 1. Base image (Processed / After) — clipped to shared box */}
            <div style={boxStyle} className="overflow-hidden pointer-events-none">
                <img
                    src={processed}
                    alt="After"
                    className="w-full h-full pointer-events-none select-none"
                    style={{ objectFit: 'cover' }}
                    draggable={false}
                    onLoad={handleProcLoad}
                />
            </div>

            {/* 2. Top image (Original / Before) — clipped via clip-path within shared box */}
            <div
                style={{
                    ...boxStyle,
                    clipPath: `inset(0 ${100 - position}% 0 0)`,
                }}
                className="overflow-hidden pointer-events-none select-none"
            >
                <img
                    src={original}
                    alt="Before"
                    className="w-full h-full select-none"
                    style={{ objectFit: 'cover' }}
                    draggable={false}
                    onLoad={handleOrigLoad}
                />

                {/* Before label */}
                <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-md text-white/90 text-[10px] font-bold px-2 py-1 rounded border border-white/10 shadow-lg">
                    ORIGINAL
                </div>
            </div>

            {/* After label */}
            <div
                className="absolute bg-blue-600/80 backdrop-blur-md text-white text-[10px] font-bold px-2 py-1 rounded border border-white/10 shadow-lg z-10"
                style={displayBox ? { top: displayBox.top + 16, right: (containerRef.current?.clientWidth || 0) - displayBox.left - displayBox.width + 16 } : { top: 16, right: 16 }}
            >
                AI ENHANCED
            </div>

            {/* 3. Slider handle — positioned relative to the shared box */}
            <div
                className="absolute top-0 bottom-0 w-1 bg-white/50 backdrop-blur-sm cursor-ew-resize z-20 shadow-[0_0_15px_rgba(0,0,0,0.5)] transition-colors hover:bg-white"
                style={{
                    left: displayBox
                        ? `${displayBox.left + (displayBox.width * position / 100)}px`
                        : `${position}%`,
                    top: displayBox?.top ?? 0,
                    bottom: displayBox ? `${(containerRef.current?.clientHeight || 0) - displayBox.top - displayBox.height}px` : 0,
                }}
            >
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-lg border-2 border-gray-200 text-gray-800">
                    <ChevronsLeftRight size={16} />
                </div>
            </div>
        </div>
    );
};
