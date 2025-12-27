import { useState, useEffect, useRef } from 'react';

export function useResizeObserver<T extends HTMLElement>() {
    const ref = useRef<T>(null);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

    useEffect(() => {
        const element = ref.current;
        if (!element) return;

        const observer = new ResizeObserver((entries) => {
            if (!entries || entries.length === 0) return;
            const entry = entries[0];
            const { width, height } = entry.contentRect;
            setDimensions({ width, height });
        });

        observer.observe(element);

        return () => {
            observer.disconnect();
        };
    }, []);

    return { ref, width: dimensions.width, height: dimensions.height };
}
