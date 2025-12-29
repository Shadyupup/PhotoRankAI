import { FolderOpen, Settings, ImagePlus } from 'lucide-react'; // 引入 ImagePlus 图标
import { motion } from 'framer-motion';

interface HeaderProps {
    onOpenFolder: () => void;
    onOpenFiles: () => void; // 新增：打开文件选择器的回调
    onOpenAdmin?: () => void;
    onRetry?: () => void;
    total: number;
    processed: number;
    analyzed: number;
    queueLength: number;
    analyzingCount: number;
    errorCount: number;
    supportsFileSystemAccess?: boolean;
}

export function Header({ onOpenFolder, onOpenFiles, onOpenAdmin, onRetry, total, processed, analyzed, queueLength, analyzingCount, errorCount, supportsFileSystemAccess = true }: HeaderProps) {
    const processingProgress = total > 0 ? (processed / total) * 100 : 0;
    const analysisProgress = total > 0 ? (analyzed / total) * 100 : 0;

    return (
        <header className="h-16 px-6 border-b border-[#262626] bg-[#0F0F0F] flex items-center justify-between z-30 relative shadow-sm">
            {/* Left: Logo */}
            <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center font-bold text-white shadow-lg shadow-blue-500/20">
                    PR
                </div>
                <div>
                    <h1 className="text-lg font-bold text-white tracking-tight leading-none">
                        PhotoRank <span className="text-blue-500">AI</span>
                    </h1>
                    <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider bg-[#1A1A1A] px-1.5 py-0.5 rounded border border-[#262626]">v1.0 Pro</span>
                </div>
            </div>

            {/* Middle: Dual Progress */}
            {total > 0 && (
                <div className="flex-1 max-w-xl mx-8 flex flex-col gap-2">
                    {/* Bar 1: Local Processing */}
                    <div className="flex items-center gap-3 text-xs">
                        <span className="w-20 text-gray-400 text-right">Preprocessing</span>
                        <div className="flex-1 h-1.5 bg-[#1A1A1A] rounded-full overflow-hidden border border-[#262626]">
                            <motion.div
                                className="h-full bg-blue-500"
                                initial={{ width: 0 }}
                                animate={{ width: `${processingProgress}% ` }}
                                transition={{ ease: "easeInOut" }}
                            />
                        </div>
                        <span className="w-8 text-gray-500 font-mono text-right">{Math.round(processingProgress)}%</span>
                    </div>

                    {/* Bar 2: AI Analysis */}
                    <div className="flex items-center gap-3 text-xs">
                        <div className="w-20 flex justify-end">
                            <span className="text-gray-400 text-right">AI Grading</span>
                        </div>
                        <div className="flex-1 h-1.5 bg-[#1A1A1A] rounded-full overflow-hidden border border-[#262626]">
                            <motion.div
                                className="h-full bg-purple-500"
                                initial={{ width: 0 }}
                                animate={{ width: `${analysisProgress}% ` }}
                                transition={{ ease: "easeInOut" }}
                            />
                        </div>
                        <span className="w-8 text-gray-500 font-mono text-right">{Math.round(analysisProgress)}%</span>
                    </div>
                </div>
            )}

            {/* Pipeline Stats */}
            {total > 0 && (
                <div className="mr-6 flex items-center gap-4 text-xs font-mono text-gray-500 border-r border-[#262626] pr-6">
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
            <div className="flex items-center gap-3">
                {/* Admin Button - Hidden in Prod, accessible via Alt+Shift+A */}
                {import.meta.env.DEV && (
                    <button
                        onClick={onOpenAdmin}
                        title="Admin Console (Alt+Shift+A)"
                        className="p-2.5 bg-[#1A1A1A] text-gray-400 border border-[#262626] rounded-xl hover:text-white hover:bg-[#262626] transition-all active:scale-95"
                    >
                        <Settings size={18} />
                    </button>
                )}

                {/* 拆分为两个明确的按钮 */}
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
            </div>
        </header>
    );
}
