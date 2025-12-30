import { ArrowDownWideNarrow, Calendar, Filter, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';

export type SortMode = 'date' | 'score';

interface ToolbarProps {
    sortMode: SortMode;
    onSortChange: (mode: SortMode) => void;
    minScore: number;
    onMinScoreChange: (score: number) => void;
}

export function Toolbar({ sortMode, onSortChange, minScore, onMinScoreChange }: ToolbarProps) {
    // 根据分数计算颜色，提供视觉反馈
    const getScoreColor = (s: number) => {
        if (s >= 8) return "text-emerald-400"; // 高分
        if (s >= 5) return "text-yellow-400";  // 中分
        return "text-blue-400";               // 低分/默认
    };

    const getProgressColor = (s: number) => {
        if (s >= 8) return "bg-emerald-500";
        if (s >= 5) return "bg-yellow-500";
        return "bg-blue-500";
    };

    return (
        <div className="h-14 px-6 bg-[#0F0F0F] border-b border-[#262626] flex items-center justify-between z-20 shadow-sm">
            {/* Left: Sorting Controls */}
            <div className="flex items-center gap-4">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider hidden sm:block">Sort By</span>
                <div className="flex bg-[#1A1A1A] p-1 rounded-lg border border-[#262626]">
                    <button
                        onClick={() => onSortChange('date')}
                        className={cn(
                            "px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-2 transition-all",
                            sortMode === 'date' ? "bg-[#262626] text-white shadow-sm ring-1 ring-white/10" : "text-gray-500 hover:text-gray-300"
                        )}
                    >
                        <Calendar size={14} />
                        <span className="hidden sm:inline">Date</span>
                    </button>
                    <button
                        onClick={() => onSortChange('score')}
                        className={cn(
                            "px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-2 transition-all",
                            sortMode === 'score' ? "bg-blue-500/10 text-blue-400 border border-blue-500/20 shadow-sm" : "text-gray-500 hover:text-gray-300"
                        )}
                    >
                        <ArrowDownWideNarrow size={14} />
                        <span className="hidden sm:inline">Score</span>
                    </button>
                </div>
            </div>

            {/* Right: Score Filter Slider */}
            <div className="flex items-center gap-4 flex-1 justify-end max-w-md">
                <div className="flex items-center gap-2 text-gray-400">
                    <Filter size={16} />
                    <span className="text-xs font-medium uppercase tracking-wider">Min Score</span>
                </div>

                <div className="group relative flex-1 h-10 flex items-center">
                    {/* Background Track */}
                    <div className="absolute inset-x-0 h-1.5 bg-[#1A1A1A] rounded-full overflow-hidden border border-[#333]">
                        {/* Fill Track */}
                        <motion.div
                            className={cn("h-full transition-colors duration-300", getProgressColor(minScore))}
                            initial={false}
                            animate={{ width: `${(minScore / 10) * 100}%` }}
                        />
                    </div>

                    {/* The Range Input (Invisible but interactive) */}
                    <input
                        type="range"
                        min="0"
                        max="10"
                        step="0.1"
                        value={minScore}
                        onChange={(e) => onMinScoreChange(parseFloat(e.target.value))}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize z-20"
                    />

                    {/* Custom Thumb (Visual Only, follows position) */}
                    <motion.div
                        className="absolute h-5 w-5 bg-white rounded-full shadow-lg border-2 border-[#1A1A1A] z-10 pointer-events-none flex items-center justify-center"
                        initial={false}
                        animate={{ left: `calc(${(minScore / 10) * 100}% - 10px)` }}
                    >
                        <div className={cn("w-1.5 h-1.5 rounded-full", getProgressColor(minScore))} />
                    </motion.div>
                </div>

                {/* Score Value Indicator */}
                <div className={cn(
                    "w-12 text-right font-mono font-bold text-lg transition-colors duration-300",
                    getScoreColor(minScore)
                )}>
                    {minScore > 0 ? minScore.toFixed(1) : <span className="text-gray-600 text-sm">ALL</span>}
                </div>

                {/* Visual Hint */}
                {minScore >= 9.0 && (
                    <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        className="p-1.5 bg-yellow-500/10 rounded-full border border-yellow-500/30"
                    >
                        <Sparkles size={14} className="text-yellow-500" />
                    </motion.div>
                )}
            </div>
        </div>
    );
}
