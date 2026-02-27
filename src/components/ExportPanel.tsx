import { useState, useRef } from 'react';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Download, FolderOutput, ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface ExportPanelProps {
    minScore: number;
}

export function ExportPanel({ minScore }: ExportPanelProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [progress, setProgress] = useState({ current: 0, total: 0 });
    const destHandleRef = useRef<FileSystemDirectoryHandle | null>(null);
    const [destName, setDestName] = useState<string | null>(null);

    const handleSelectFolder = async () => {
        try {
            const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
            destHandleRef.current = handle;
            setDestName(handle.name);
            toast.success(`Output folder set: ${handle.name}`);
        } catch (err: unknown) {
            if ((err as Error)?.name !== 'AbortError') {
                logger.error("Failed to select output folder", err);
            }
        }
    };

    const handleExport = async () => {
        if (!destHandleRef.current) {
            toast.error("Please select an output folder first.");
            return;
        }

        setIsExporting(true);
        setProgress({ current: 0, total: 0 });

        try {
            const qualified = (await db.photos
                .where('score')
                .aboveOrEqual(minScore)
                .toArray())
                .filter(p => !p.rejected);

            if (qualified.length === 0) {
                toast.info(`No photos found with score ≥ ${minScore.toFixed(1)}`);
                setIsExporting(false);
                return;
            }

            setProgress({ current: 0, total: qualified.length });
            toast.info(`Exporting ${qualified.length} photos...`);

            let successCount = 0;
            let failCount = 0;

            for (let i = 0; i < qualified.length; i++) {
                const photo = qualified[i];
                setProgress({ current: i + 1, total: qualified.length });

                try {
                    // Re-read full record from DB to access blobs
                    const fullRecord = await db.photos.get(photo.id);
                    let exportData: Blob | File | null = null;

                    // If AI-edited (originalBlob exists as backup), export the AI result
                    if (fullRecord?.originalBlob && fullRecord?.analysisBlob) {
                        exportData = new Blob([fullRecord.analysisBlob], { type: 'image/jpeg' });
                    } else {
                        // Otherwise export original file from disk
                        if (photo.handle) {
                            exportData = await (photo.handle as FileSystemFileHandle).getFile();
                        }
                    }

                    if (!exportData) {
                        logger.warn(`Skipping ${photo.name}: no file access`);
                        failCount++;
                        continue;
                    }

                    const destFile = await destHandleRef.current!.getFileHandle(
                        photo.name,
                        { create: true }
                    );
                    const writable = await destFile.createWritable();
                    await writable.write(exportData);
                    await writable.close();

                    successCount++;
                } catch (err) {
                    logger.warn(`Failed to export ${photo.name}`, err);
                    failCount++;
                }
            }

            toast.success(`Export complete! ${successCount} photos copied.`, {
                description: failCount > 0 ? `${failCount} files could not be exported.` : undefined
            });
        } catch (err) {
            logger.error("Export failed", err);
            toast.error("Export failed. See console for details.");
        } finally {
            setIsExporting(false);
        }
    };

    const exportProgress = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;

    return (
        <div className="border-b border-[#262626] bg-[#0A0A0A]">
            {/* Toggle Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full h-10 px-6 flex items-center justify-between text-xs font-semibold text-gray-400 hover:text-white transition-colors"
            >
                <div className="flex items-center gap-2">
                    <Download size={14} className="text-emerald-500" />
                    <span className="uppercase tracking-wider">Export High-Scoring Photos</span>
                </div>
                {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            {/* Collapsible Panel */}
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                    >
                        <div className="px-6 pb-4 flex items-center gap-6 flex-wrap">
                            {/* Score info (uses Toolbar's filter) */}
                            <span className="text-xs text-gray-500 font-medium">
                                Exporting photos with score ≥ <span className="text-emerald-400 font-bold">{minScore.toFixed(1)}</span>
                                {minScore === 0 && <span className="text-gray-600 ml-1">(all)</span>}
                            </span>

                            {/* Destination Folder */}
                            <button
                                onClick={handleSelectFolder}
                                className="flex items-center gap-2 px-4 py-2 bg-[#1A1A1A] text-white border border-[#262626] rounded-lg text-xs font-semibold hover:bg-[#262626] transition-colors active:scale-95"
                            >
                                <FolderOutput size={14} className="text-amber-500" />
                                {destName ? `📁 ${destName}` : "Select Output Folder"}
                            </button>

                            {/* Export Button */}
                            <button
                                onClick={handleExport}
                                disabled={isExporting || !destName}
                                className={cn(
                                    "flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-bold transition-all active:scale-95 shadow-lg",
                                    destName && !isExporting
                                        ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/20"
                                        : "bg-[#1A1A1A] text-gray-600 cursor-not-allowed border border-[#262626]"
                                )}
                            >
                                <Download size={14} />
                                {isExporting ? `Exporting ${progress.current}/${progress.total}...` : "Export"}
                            </button>
                        </div>

                        {/* Export Progress Bar */}
                        {isExporting && (
                            <div className="px-6 pb-3">
                                <div className="h-1 bg-[#1A1A1A] rounded-full overflow-hidden border border-[#333]">
                                    <motion.div
                                        className="h-full bg-emerald-500"
                                        initial={{ width: 0 }}
                                        animate={{ width: `${exportProgress}%` }}
                                        transition={{ ease: "easeInOut" }}
                                    />
                                </div>
                            </div>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

