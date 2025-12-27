import { useState, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, PhotoMetadata } from '@/lib/db';
import { useDirectoryLoader } from '@/hooks/useDirectoryLoader';
import { useAIPipeline } from '@/hooks/useAIPipeline';
import { AppShell } from '@/components/AppShell';
import { PhotoGrid } from '@/components/PhotoGrid';
import { FolderOpen, ArrowDownWideNarrow, Filter, Upload, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger';

import { PhotoDetailModal } from '@/components/PhotoDetailModal';

type SortMode = 'date' | 'score';

function App() {
  const { loadDirectory, loadFiles, cancelLoad, files, isLoading: isScanning } = useDirectoryLoader();
  const { queueAll, isAnalyzing } = useAIPipeline();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sortMode, setSortMode] = useState<SortMode>('date');
  const [minScore, setMinScore] = useState<number>(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const [autoMode, setAutoMode] = useState(false);
  const [viewingPhoto, setViewingPhoto] = useState<PhotoMetadata | null>(null);

  const photos = useLiveQuery(async () => {
    let collection;
    if (sortMode === 'score') {
      collection = db.photos.orderBy('score').reverse();
    } else {
      collection = db.photos.orderBy('createdAt');
    }

    let result = await collection.toArray();
    if (minScore > 0) {
      result = result.filter(p => (p.score || 0) >= minScore);
    }
    return result;
  }, [sortMode, minScore]) || [];

  // Derived State
  const totalCount = photos.length;
  const finishedCount = photos.filter(p => ['scored', 'error'].includes(p.status)).length;
  const hasPhotos = totalCount > 0;
  const isComplete = hasPhotos && finishedCount === totalCount && !isScanning;

  const [forceShowResults, setForceShowResults] = useState(false);

  // Show grid if complete OR forced
  const showGrid = (isComplete || forceShowResults) && hasPhotos;
  // Busy if not showing grid and drag-dropping is not happening (and has photos)
  const isBusy = (isScanning || (hasPhotos && !isComplete)) && !showGrid;

  // Auto-switch to Score sort when complete
  useEffect(() => {
    if (isComplete && sortMode !== 'score') {
      setSortMode('score');
    }
  }, [isComplete, sortMode]);

  // Image Processor Worker
  const workerRef = useRef<Worker | null>(null);
  useEffect(() => {
    workerRef.current = new Worker(new URL('./workers/imageProcessor.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current.onmessage = async (e) => {
      const { id, status, thumbBlob, analysisBlob, error } = e.data;
      if (status === 'success') {
        await db.photos.update(id, {
          status: 'done',
          previewBlob: thumbBlob,
          analysisBlob: analysisBlob
        });
      } else {
        await db.photos.update(id, { status: 'error' });
      }
    };
    return () => { workerRef.current?.terminate(); };
  }, []);

  const cancelProcessing = async () => {
    cancelLoad();
    setForceShowResults(true);
  };

  // Sync Files to DB
  useEffect(() => {
    if (files.length > 0) {
      setAutoMode(true);
      const newPhotos: PhotoMetadata[] = files.map(f => ({
        id: f.id,
        name: f.name,
        path: f.path,
        size: f.file ? f.file.size : 0,
        handle: f.handle,
        file: f.file,
        status: 'new',
        createdAt: Date.now()
      }));

      db.transaction('rw', db.photos, async () => {
        await db.photos.bulkPut(newPhotos);
      });
    }
  }, [files]);

  // Process Loop
  useEffect(() => {
    const processNext = async () => {
      const nextPhoto = await db.photos.where('status').equals('new').first();
      if (nextPhoto && workerRef.current) {
        await db.photos.update(nextPhoto.id, { status: 'processing' });
        try {
          let file: File;
          if (nextPhoto.file) {
            file = nextPhoto.file;
          } else if (nextPhoto.handle) {
            // @ts-ignore
            file = await nextPhoto.handle.getFile();
          } else {
            throw new Error("No file or handle available");
          }

          workerRef.current.postMessage({ id: nextPhoto.id, file });
        } catch (e: any) {
          logger.error("Failed to get file", { id: nextPhoto.id, msg: e.message });
          await db.photos.update(nextPhoto.id, { status: 'error' });
        }
      }
    };
    const hasNew = photos.some(p => p.status === 'new');
    if (hasNew) processNext();
  }, [photos]);

  // Auto-Queue logic
  useEffect(() => {
    if (autoMode) {
      const donePhotos = photos.filter(p => p.status === 'done');
      if (donePhotos.length > 0) {
        db.transaction('rw', db.photos, async () => {
          for (const p of donePhotos) {
            await db.photos.update(p.id, { status: 'queued' });
          }
        }).catch(e => logger.error("Failed to auto-queue", e));
      }
    }
  }, [photos, autoMode]);


  // Drag Handlers
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(false); };
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFiles = Array.from(e.dataTransfer.files);
      await loadFiles(droppedFiles);
    } else {
      logger.warn("Drop event contained no files");
    }
  };

  const handleToggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  return (
    <AppShell>
      {/* Toolbar */}
      <div className="flex-none h-16 px-6 flex items-center justify-end gap-3 border-b border-gray-800 bg-[#0f0f0f] z-20">
        <div className="flex bg-gray-800 rounded-lg p-1 border border-gray-700 items-center">
          <span className="text-blue-400 font-bold text-sm px-3 flex items-center gap-2">
            <ArrowDownWideNarrow size={16} /> Score
          </span>
          <div className="w-px h-4 bg-gray-600 mx-1" />
          <div className="flex items-center px-2 gap-2 text-sm">
            <Filter size={14} className="text-gray-400" />
            <input
              type="range" min="0" max="9" step="0.5"
              value={minScore} onChange={e => setMinScore(Number(e.target.value))}
              className="w-20"
            />
            <span className="w-4">{minScore > 0 ? minScore : ''}</span>
          </div>
        </div>
        <button onClick={loadDirectory} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg flex items-center gap-2">
          <FolderOpen size={18} /> Open Folder
        </button>
      </div>

      <div className="flex-1 w-full h-full relative">
        {!hasPhotos && !isScanning && (
          <div
            className={cn(
              "absolute inset-0 m-12 border-2 border-dashed rounded-3xl flex flex-col items-center justify-center transition-colors duration-200 cursor-pointer",
              isDragOver ? "border-blue-500 bg-blue-500/10" : "border-gray-700 hover:border-gray-600"
            )}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <Upload size={64} className={cn("mb-6 transition-colors", isDragOver ? "text-blue-500" : "text-gray-600")} />
            <h2 className="text-3xl font-bold mb-2">Drag and drop files here</h2>
            <p className="text-gray-500 mb-8">or click to browse</p>
            <button
              onClick={(e) => {
                e.stopPropagation();
                loadDirectory();
              }}
              className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-3 rounded-xl font-medium text-lg shadow-lg hover:shadow-blue-500/25 transition-all"
            >
              Browse Files
            </button>
          </div>
        )}

        {isBusy && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0f0f0f] z-50">
            <div className="w-96 text-center">
              <Loader2 size={64} className="animate-spin text-purple-500 mx-auto mb-8" />
              <h2 className="text-2xl font-bold mb-4">
                {isScanning ? "Uploading files..." : "Analyzing with Gemini..."}
              </h2>
              <div className="h-2 w-full bg-gray-800 rounded-full overflow-hidden mb-4">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-purple-600 transition-all duration-300 ease-out"
                  style={{ width: `${(finishedCount / (totalCount || 1)) * 100}%` }}
                />
              </div>
              <p className="text-gray-400 mb-6">
                {isScanning ? (
                  <span className="flex items-center justify-center gap-2">
                    <span>Scanning...</span>
                    <button onClick={(e) => { e.stopPropagation(); cancelProcessing(); }} className="text-red-400 underline hover:text-red-300">Cancel</button>
                  </span>
                ) : (
                  <span>Finished: <span className="text-green-400">{finishedCount}</span> / <span className="text-gray-400">{totalCount}</span></span>
                )}
              </p>
            </div>
          </div>
        )}

        {showGrid && (
          <PhotoGrid
            photos={photos}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
            onView={setViewingPhoto}
          />
        )}
      </div>

      {viewingPhoto && (
        <PhotoDetailModal
          photo={viewingPhoto}
          onClose={() => setViewingPhoto(null)}
        />
      )}
    </AppShell >
  )
}

export default App
