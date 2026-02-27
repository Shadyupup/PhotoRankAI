import { FolderOpen, Settings, ImagePlus, Pause, Play, RefreshCw, Download } from 'lucide-react';
import { motion } from 'framer-motion';

interface HeaderProps {
    onOpenFolder: () => void;
    onOpenFiles: () => void;
    onOpenAdmin?: () => void;
    onOpenSettings?: () => void;
    onRetry?: () => void;
    onRescoreAll?: () => void;
    total: number;
    processed: number;
    analyzed: number;
    queueLength: number;
    analyzingCount: number;
    errorCount: number;
    supportsFileSystemAccess?: boolean;
    pausePreprocessing: boolean;
    onTogglePausePreprocessing: () => void;
    pauseAnalysis: boolean;
    onTogglePauseAnalysis: () => void;
    onExport?: () => void;
    isExporting?: boolean;
}


export function Header({ onOpenFolder, onOpenFiles, onOpenSettings, onRetry, onRescoreAll, total, processed, analyzed, queueLength, analyzingCount, errorCount, supportsFileSystemAccess = true, pausePreprocessing, onTogglePausePreprocessing, pauseAnalysis, onTogglePauseAnalysis, onExport, isExporting }: HeaderProps) {
    const processingProgress = total > 0 ? (processed / total) * 100 : 0;
    const analysisProgress = total > 0 ? (analyzed / total) * 100 : 0;

    return (
        <header className="h-16 pl-20 pr-6 border-b border-[#262626] bg-[#0F0F0F] flex items-center justify-between z-30 relative shadow-sm" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
            {/* Left: Logo */}
            <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center font-bold text-white shadow-lg shadow-blue-500/20">
                    PR
                </div>
                <h1 className="text-lg font-bold text-white tracking-tight leading-none">
                    PhotoRank <span className="text-blue-500">AI</span>
                </h1>
            </div>

            {/* Middle: Progress / Completion */}
            {total > 0 && (() => {
                const isAllComplete = processingProgress >= 100 && analysisProgress >= 100;

                if (isAllComplete) {
                    return (
                        <div className="flex-1 max-w-xl mx-8 flex items-center justify-center gap-3 text-sm" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
                            <span className="text-green-400 font-medium">✅ All {total} photos scored</span>
                            {errorCount > 0 && onRetry && (
                                <button
                                    onClick={onRetry}
                                    className="text-red-400 hover:text-red-300 text-xs underline underline-offset-2"
                                >
                                    Retry {errorCount} errors
                                </button>
                            )}
                            {onRescoreAll && (
                                <button
                                    onClick={onRescoreAll}
                                    title="Re-score all photos"
                                    className="p-1.5 rounded-md text-gray-500 hover:text-white hover:bg-white/10 transition-colors"
                                >
                                    <RefreshCw size={14} />
                                </button>
                            )}
                        </div>
                    );
                }

                return (
                    <div className="flex-1 max-w-xl mx-8 flex flex-col gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
                        {/* Bar 1: Local Processing */}
                        <div className="flex items-center gap-3 text-xs">
                            <span className={`w-20 text-right ${pausePreprocessing ? 'text-amber-400' : 'text-gray-400'}`}>
                                {pausePreprocessing ? 'Paused' : 'Preprocessing'}
                            </span>
                            <div className="flex-1 h-1.5 bg-[#1A1A1A] rounded-full overflow-hidden border border-[#262626]">
                                <motion.div
                                    className={`h-full ${pausePreprocessing ? 'bg-amber-500' : 'bg-blue-500'}`}
                                    initial={{ width: 0 }}
                                    animate={{ width: `${processingProgress}% ` }}
                                    transition={{ ease: "easeInOut" }}
                                />
                            </div>
                            <span className="w-8 text-gray-500 font-mono text-right">{Math.round(processingProgress)}%</span>
                            <button
                                onClick={onTogglePausePreprocessing}
                                title={pausePreprocessing ? 'Resume preprocessing' : 'Pause preprocessing'}
                                className={`p-1 rounded-md transition-colors ${pausePreprocessing ? 'text-amber-400 bg-amber-500/10 hover:bg-amber-500/20' : 'text-gray-500 hover:text-white hover:bg-white/10'}`}
                            >
                                {pausePreprocessing ? <Play size={12} /> : <Pause size={12} />}
                            </button>
                        </div>

                        {/* Bar 2: AI Analysis */}
                        <div className="flex items-center gap-3 text-xs">
                            <div className="w-20 flex justify-end">
                                <span className={pauseAnalysis ? 'text-amber-400' : 'text-gray-400'}>
                                    {pauseAnalysis ? 'Paused' : 'AI Grading'}
                                </span>
                            </div>
                            <div className="flex-1 h-1.5 bg-[#1A1A1A] rounded-full overflow-hidden border border-[#262626]">
                                <motion.div
                                    className={`h-full ${pauseAnalysis ? 'bg-amber-500' : 'bg-purple-500'}`}
                                    initial={{ width: 0 }}
                                    animate={{ width: `${analysisProgress}% ` }}
                                    transition={{ ease: "easeInOut" }}
                                />
                            </div>
                            <span className="w-8 text-gray-500 font-mono text-right">{Math.round(analysisProgress)}%</span>
                            <button
                                onClick={onTogglePauseAnalysis}
                                title={pauseAnalysis ? 'Resume AI analysis' : 'Pause AI analysis'}
                                className={`p-1 rounded-md transition-colors ${pauseAnalysis ? 'text-amber-400 bg-amber-500/10 hover:bg-amber-500/20' : 'text-gray-500 hover:text-white hover:bg-white/10'}`}
                            >
                                {pauseAnalysis ? <Play size={12} /> : <Pause size={12} />}
                            </button>
                            <button
                                onClick={onRescoreAll}
                                title="Re-score all eligible photos"
                                className="p-1 rounded-md transition-colors text-gray-500 hover:text-white hover:bg-white/10"
                            >
                                <RefreshCw size={12} />
                            </button>
                        </div>
                    </div>
                );
            })()}

            {/* Pipeline Stats — only show during active processing */}
            {total > 0 && (processingProgress < 100 || analysisProgress < 100) && (
                <div className="mr-6 flex items-center gap-4 text-xs font-mono text-gray-500 border-r border-[#262626] pr-6" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
                    <div className="flex flex-col items-end">
                        <span className={queueLength > 0 ? "text-yellow-500" : "text-gray-600"}>Queue: {queueLength}</span>
                        <span className={analyzingCount > 0 ? "text-purple-400 animate-pulse" : "text-gray-600"}>Analyzing: {analyzingCount}</span>
                        {errorCount > 0 && (
                            <button
                                onClick={onRetry}
                                className="text-red-400 hover:text-red-300 underline decoration-red-500/30 underline-offset-2 transition-colors mt-0.5"
                            >
                                Errors: {errorCount} (Retry?)
                            </button>
                        )}
                    </div>
                </div>
            )}


            {/* Right: Actions */}
            <div className="flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
                <button
                    onClick={onOpenSettings}
                    title="Settings"
                    className="p-2.5 bg-[#1A1A1A] text-gray-400 border border-[#262626] rounded-xl hover:text-white hover:bg-[#262626] transition-all active:scale-95"
                >
                    <Settings size={18} />
                </button>

                {/* Split into two distinct buttons */}
                {total > 0 && (
                    <>
                        <button
                            onClick={onOpenFiles}
                            title="Select individual photos to analyze"
                            className="flex items-center gap-2 px-4 py-2 bg-[#1A1A1A] text-white border border-[#262626] rounded-lg text-sm font-semibold hover:bg-[#262626] transition-colors active:scale-95 duration-100"
                        >
                            <ImagePlus size={16} className="text-blue-500" />
                            Add Photos
                        </button>

                        {supportsFileSystemAccess ? (
                            <button
                                onClick={onOpenFolder}
                                title="Import a full folder (Standard Mode)"
                                className="flex items-center gap-2 px-4 py-2 bg-white text-black rounded-lg text-sm font-semibold hover:bg-gray-200 transition-colors shadow-lg shadow-white/5 active:scale-95 duration-100"
                            >
                                <FolderOpen size={16} />
                                Import Folder
                            </button>
                        ) : null}

                        {/* Export Button — only show when analysis is complete */}
                        {processingProgress >= 100 && analysisProgress >= 100 && onExport && (
                            <button
                                onClick={onExport}
                                disabled={isExporting}
                                title="Export high-scoring photos to a folder"
                                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-500 transition-colors shadow-lg shadow-green-500/20 active:scale-95 duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Download size={16} />
                                {isExporting ? 'Exporting...' : 'Export'}
                            </button>
                        )}
                    </>
                )}
            </div>
        </header>
    );
}
