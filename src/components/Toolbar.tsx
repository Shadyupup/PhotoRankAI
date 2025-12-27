import { ArrowDownWideNarrow, Calendar, Filter } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SortMode = 'date' | 'score';

interface ToolbarProps {
    sortMode: SortMode;
    onSortChange: (mode: SortMode) => void;
    minScore: number;
    onMinScoreChange: (score: number) => void;
}

export function Toolbar({ sortMode, onSortChange, minScore, onMinScoreChange }: ToolbarProps) {
    return (
        <div className="h-12 px-6 bg-[#0F0F0F] border-b border-[#262626] flex items-center justify-between z-20">
            <div className="flex items-center gap-2">
                <div className="flex bg-[#1A1A1A] p-1 rounded-lg border border-[#262626]">
                    <button
                        onClick={() => onSortChange('date')}
                        className={cn(
                            "px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-2 transition-all",
                            sortMode === 'date' ? "bg-[#262626] text-white shadow-sm" : "text-gray-500 hover:text-gray-300"
                        )}
                    >
                        <Calendar size={14} /> Date
                    </button>
                    <button
                        onClick={() => onSortChange('score')}
                        className={cn(
                            "px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-2 transition-all",
                            sortMode === 'score' ? "bg-blue-500/10 text-blue-400 border border-blue-500/20 shadow-sm" : "text-gray-500 hover:text-gray-300"
                        )}
                    >
                        <ArrowDownWideNarrow size={14} /> Score
                    </button>
                </div>
            </div>

            <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-[#1A1A1A] rounded-lg border border-[#262626]">
                    <Filter size={14} className="text-gray-400" />
                    <span className="text-xs text-gray-400 font-medium">Min Score:</span>
                    <select
                        value={minScore}
                        onChange={(e) => onMinScoreChange(Number(e.target.value))}
                        className="bg-transparent text-xs font-bold text-white focus:outline-none cursor-pointer"
                    >
                        <option value={0}>All</option>
                        <option value={5}>5.0+</option>
                        <option value={7}>7.0+</option>
                        <option value={8}>8.0+</option>
                        <option value={9}>9.0+</option>
                    </select>
                </div>
            </div>
        </div>
    );
}
