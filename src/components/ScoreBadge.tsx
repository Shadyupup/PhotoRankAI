import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';

interface ScoreBadgeProps {
    score?: number;
    status: 'new' | 'processing' | 'done' | 'queued' | 'analyzing' | 'scored' | 'error';
    className?: string;
}

export function ScoreBadge({ score, status, className }: ScoreBadgeProps) {
    if (status === 'analyzing') {
        return (
            <div className={cn("flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/20 backdrop-blur-md border border-blue-500/50", className)}>
                <Loader2 size={12} className="text-blue-400 animate-spin" />
                <span className="text-xs font-medium text-blue-200">Analyzing...</span>
            </div>
        );
    }

    if (status === 'processing') {
        return (
            <div className={cn("flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-500/20 backdrop-blur-md border border-gray-500/50", className)}>
                <Loader2 size={12} className="text-gray-400 animate-spin" />
                <span className="text-xs font-medium text-gray-200">Preprocessing...</span>
            </div>
        );
    }

    if (status === 'queued') {
        return (
            <div className={cn("px-2.5 py-1 rounded-full bg-yellow-500/10 backdrop-blur-md border border-yellow-500/30", className)}>
                <span className="text-xs font-medium text-yellow-500/80">In Queue</span>
            </div>
        );
    }

    if (status === 'error') {
        return (
            <div className={cn("flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-500/20 backdrop-blur-md border border-red-500/50", className)}>
                <span className="text-xs font-bold text-red-500">FAILED</span>
            </div>
        );
    }

    if (status !== 'scored' || score === undefined) {
        return (
            <div className={cn("px-2.5 py-1 rounded-full bg-black/40 backdrop-blur-md border border-white/5", className)}>
                <span className="text-xs font-medium text-gray-500">Waiting</span>
            </div>
        );
    }

    // Score Logic
    let colorClass = "";
    let glowClass = "";

    if (score >= 90) {
        colorClass = "text-[#4ADE80] border-[#4ADE80]/30 bg-[#4ADE80]/10";
        glowClass = "shadow-[0_0_10px_rgba(74,222,128,0.2)]";
    } else if (score >= 70) {
        colorClass = "text-[#60A5FA] border-[#60A5FA]/30 bg-[#60A5FA]/10";
        glowClass = "shadow-[0_0_10px_rgba(96,165,250,0.2)]";
    } else if (score >= 50) {
        colorClass = "text-[#FB923C] border-[#FB923C]/30 bg-[#FB923C]/10";
        glowClass = "shadow-[0_0_10px_rgba(251,146,60,0.2)]";
    } else {
        colorClass = "text-[#F87171] border-[#F87171]/30 bg-[#F87171]/10";
        glowClass = "shadow-[0_0_10px_rgba(248,113,113,0.2)]";
    }

    return (
        <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={cn(
                "px-3 py-1 rounded-full backdrop-blur-md border flex items-center justify-center min-w-[3.5rem]",
                colorClass,
                glowClass,
                className
            )}
        >
            <span className="text-sm font-bold tracking-wide">{score.toFixed(0)}</span>
        </motion.div>
    );
}
