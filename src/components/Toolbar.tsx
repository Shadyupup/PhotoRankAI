import { ArrowDownWideNarrow, Calendar, Filter, Sparkles, Search, X, Loader2, Layers, CheckSquare, Square } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';

export type SortMode = 'date' | 'score';

interface ToolbarProps {
    sortMode: SortMode;
    onSortChange: (mode: SortMode) => void;
    minScore: number;
    onMinScoreChange: (score: number) => void;
    // AI Smart Filter
    aiFilterKeywords: string;
    onAiFilterSubmit: (keywords: string) => void;
    onAiFilterClear: () => void;
    aiFilterProgress: { done: number; total: number } | null;
    // Deduplication
    onDedupeClick: () => void;
    isDeduping: boolean;
    isGroupActive: boolean;
    // Selection
    selectedCount: number;
    totalCount: number;
    onSelectAll: () => void;
    onDeselectAll: () => void;
}

export function Toolbar({ sortMode, onSortChange, minScore, onMinScoreChange, aiFilterKeywords, onAiFilterSubmit, onAiFilterClear, aiFilterProgress, onDedupeClick, isDeduping, isGroupActive, selectedCount, totalCount, onSelectAll, onDeselectAll }: ToolbarProps) {
    const [inputValue, setInputValue] = useState('');
    const isFiltering = aiFilterProgress !== null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (inputValue.trim() && !isFiltering) {
            onAiFilterSubmit(inputValue.trim());
        }
    };

    const handleClear = () => {
        setInputValue('');
        onAiFilterClear();
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

                {/* Deduplication (Burst Detection) */}
                <button
                    onClick={onDedupeClick}
                    disabled={isDeduping}
                    className={cn(
                        "ml-2 px-3 py-1.5 border rounded-md text-xs font-semibold flex items-center gap-2 transition-all shadow-sm",
                        isDeduping ? "bg-[#1A1A1A] border-[#262626] text-gray-500 opacity-50 cursor-not-allowed"
                            : isGroupActive ? "bg-green-500/10 border-green-500/50 text-green-400 hover:bg-green-500/20 active:scale-95"
                                : "bg-[#1A1A1A] border-[#262626] text-purple-400 hover:text-white hover:bg-[#262626] active:scale-95 hover:border-purple-500/50"
                    )}
                    title={isGroupActive ? "Click to show all photos (disable grouping)" : "Group similar burst photos and keep only the best one"}
                >
                    {isDeduping ? <Loader2 size={14} className="animate-spin" /> : <Layers size={14} />}
                    <span className="hidden md:inline">{isDeduping ? "Grouping..." : isGroupActive ? "Grouped ✓" : "Group Similar"}</span>
                </button>

                {/* Select All / Deselect All */}
                <button
                    onClick={selectedCount > 0 ? onDeselectAll : onSelectAll}
                    disabled={totalCount === 0}
                    className={cn(
                        "ml-1 px-3 py-1.5 border rounded-md text-xs font-semibold flex items-center gap-2 transition-all shadow-sm",
                        totalCount === 0
                            ? "bg-[#1A1A1A] border-[#262626] text-gray-600 opacity-50 cursor-not-allowed"
                            : selectedCount > 0
                                ? "bg-blue-500/10 border-blue-500/50 text-blue-400 hover:bg-blue-500/20 active:scale-95"
                                : "bg-[#1A1A1A] border-[#262626] text-gray-400 hover:text-white hover:bg-[#262626] active:scale-95"
                    )}
                    title={selectedCount > 0 ? "Deselect all photos" : "Select all visible photos"}
                >
                    {selectedCount > 0 ? <CheckSquare size={14} /> : <Square size={14} />}
                    <span className="hidden md:inline">
                        {selectedCount > 0 ? `${selectedCount} Selected` : "Select All"}
                    </span>
                </button>
            </div>

            {/* Center: AI Smart Filter */}
            <div className="flex-1 max-w-md mx-4">
                <form onSubmit={handleSubmit} className="relative flex items-center">
                    <div className="relative flex-1">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                        <input
                            type="text"
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            placeholder="🔍 AI Smart Filter... (e.g. seal, sunset)"
                            disabled={isFiltering}
                            className={cn(
                                "w-full pl-9 pr-24 py-1.5 bg-[#1A1A1A] border rounded-lg text-sm text-white placeholder-gray-500 outline-none transition-all",
                                isFiltering
                                    ? "border-purple-500/50 bg-purple-500/5"
                                    : aiFilterKeywords
                                        ? "border-emerald-500/50 bg-emerald-500/5"
                                        : "border-[#262626] focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20"
                            )}
                        />
                        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                            {isFiltering && (
                                <span className="text-[10px] text-purple-400 font-mono flex items-center gap-1">
                                    <Loader2 size={12} className="animate-spin" />
                                    {aiFilterProgress.done}/{aiFilterProgress.total}
                                </span>
                            )}
                            {aiFilterKeywords && !isFiltering && (
                                <button
                                    type="button"
                                    onClick={handleClear}
                                    className="p-1 rounded-md text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                                    title="Clear AI filter"
                                >
                                    <X size={14} />
                                </button>
                            )}
                            {!isFiltering && !aiFilterKeywords && inputValue.trim() && (
                                <button
                                    type="submit"
                                    className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors"
                                >
                                    Enter ↵
                                </button>
                            )}
                        </div>
                    </div>
                </form>
                {aiFilterKeywords && !isFiltering && (
                    <div className="mt-0.5 text-[10px] text-emerald-400/80 flex items-center gap-1 pl-1">
                        <Sparkles size={10} />
                        <span>Filtered by: "{aiFilterKeywords}"</span>
                    </div>
                )}
            </div>

            {/* Right: Score Filter Presets */}
            <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 text-gray-400 mr-1">
                    <Filter size={16} />
                    <span className="text-xs font-medium uppercase tracking-wider hidden sm:block">Min Score</span>
                </div>

                <div className="flex items-center bg-[#1A1A1A] p-1 rounded-lg border border-[#262626]">
                    {[
                        { label: 'ALL', value: 0, color: 'text-gray-300' },
                        { label: '70+', value: 70, color: 'text-blue-400' },
                        { label: '85+', value: 85, color: 'text-yellow-400' },
                        { label: '95+', value: 95, color: 'text-emerald-400' }
                    ].map(preset => {
                        const isStrictActive = minScore === preset.value;

                        return (
                            <button
                                key={preset.value}
                                onClick={() => onMinScoreChange(preset.value)}
                                className={cn(
                                    "px-3 py-1.5 rounded-md text-xs font-bold flex items-center gap-1.5 transition-all outline-none",
                                    isStrictActive
                                        ? `bg-[#2d2d2d] ${preset.color} shadow-sm ring-1 ring-white/10`
                                        : "text-gray-500 hover:text-gray-300"
                                )}
                            >
                                {preset.label}
                                {isStrictActive && preset.value >= 95 && <Sparkles size={12} className="text-emerald-400" />}
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

