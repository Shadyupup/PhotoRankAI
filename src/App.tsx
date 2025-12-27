import { useState, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, PhotoMetadata } from '@/lib/db';
import { useDirectoryLoader } from '@/hooks/useDirectoryLoader';
import { useAIPipeline } from '@/hooks/useAIPipeline';
import { PhotoGrid } from '@/components/PhotoGrid';
import { Header } from '@/components/Header';
import { Toolbar } from '@/components/Toolbar';
import { PhotoDetailModal } from '@/components/PhotoDetailModal';
import { Toaster, toast } from 'sonner';
import { DebugConsole } from './components/DebugConsole';
import { Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger';
import { AdminDashboard } from './components/AdminDashboard';

// Type for Stats
// Pipeline statistics interface removed (now literal)

function App() {
  const { loadDirectory, loadFiles, files, isLoading: isScanning } = useDirectoryLoader();
  useAIPipeline(); // Start Pipeline silently

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sortMode, setSortMode] = useState<'date' | 'score'>('date');
  const [minScore, setMinScore] = useState<number>(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const [viewingPhoto, setViewingPhoto] = useState<PhotoMetadata | null>(null);
  const [isAdminOpen, setIsAdminOpen] = useState(false);

  // Keyboard shortcut for Admin
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Use Alt+Shift+A for Admin
      if (e.altKey && e.shiftKey && e.key.toLowerCase() === 'a') {
        setIsAdminOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Detailed Pipeline Stats
  const stats = useLiveQuery(async () => {
    const counts = {
      new: await db.photos.where('status').equals('new').count(),
      processing: await db.photos.where('status').equals('processing').count(),
      done: await db.photos.where('status').equals('done').count(),
      queued: await db.photos.where('status').equals('queued').count(),
      analyzing: await db.photos.where('status').equals('analyzing').count(),
      scored: await db.photos.where('status').equals('scored').count(),
      error: await db.photos.where('status').equals('error').count(),
      total: await db.photos.count(),
    };
    return counts;
  }, []) || { new: 0, processing: 0, done: 0, queued: 0, analyzing: 0, scored: 0, error: 0, total: 0 };

  // Main Photos Query
  // Main Photos Query - Fixed to include everything even when sorting
  const photos = useLiveQuery(async () => {
    let result = await db.photos.toArray();

    // Manual sort to prevent Dexie from excluding unscored items during 'orderBy'
    result.sort((a, b) => {
      if (sortMode === 'score') {
        const scoreA = typeof a.score === 'number' ? a.score : 0;
        const scoreB = typeof b.score === 'number' ? b.score : 0;
        return scoreB - scoreA;
      }
      return (b.createdAt || 0) - (a.createdAt || 0); // Default to Newest First
    });

    if (minScore > 0) {
      result = result.filter(p => (p.score || 0) >= minScore);
    }
    return result;
  }, [sortMode, minScore]) || [];

  const hasPhotos = stats.total > 0;
  const isComplete = hasPhotos && stats.scored === stats.total && !isScanning;
  const processedCount = stats.total - stats.new - stats.processing;

  // Auto-switch to Score sort when complete
  useEffect(() => {
    if (isComplete && sortMode !== 'score') {
      toast("All analysis complete!", { description: "Switching to score view for best results." });
      setSortMode('score');
    }
  }, [isComplete]);

  // Image Processor Worker
  const workerRef = useRef<Worker | null>(null);
  useEffect(() => {
    workerRef.current = new Worker(new URL('./workers/imageProcessor.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current.onmessage = async (e) => {
      const { id, status, thumbBlob, analysisBlob } = e.data;
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

  // Sync Files to DB
  useEffect(() => {
    if (files.length > 0) {
      toast.success(`Identified ${files.length} photos`, {
        description: "Starting local preprocessing..."
      });
      // Auto-mode is implicit now
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
        await db.photos.clear(); // Clear old for new import? Or append? Usually clear for this type of app.
        await db.photos.bulkPut(newPhotos);
      });
    }
  }, [files]);

  // Process Loop
  useEffect(() => {
    const processNext = async () => {
      // Find one 'new' photo
      const nextPhoto = await db.photos.where('status').equals('new').first();
      if (nextPhoto && workerRef.current) {
        await db.photos.update(nextPhoto.id, { status: 'processing' });
        try {
          let file: File;
          if (nextPhoto.file) {
            file = nextPhoto.file;
          } else if (nextPhoto.handle) {
            file = await (nextPhoto.handle as FileSystemFileHandle).getFile();
          } else {
            throw new Error("No file or handle available");
          }
          workerRef.current.postMessage({ id: nextPhoto.id, file });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          logger.error("Failed to get file", { id: nextPhoto.id, msg });
          await db.photos.update(nextPhoto.id, { status: 'error' });
        }
      }
    };
    // We trigger this whenever photos change (crudely), simpler than a dedicated loop with 'processing' check
    const hasNew = photos.some(p => p.status === 'new');
    if (hasNew) processNext();
  }, [photos]);

  // Auto-Queue logic - Now independent of the 'photos' grid array
  useEffect(() => {
    if (stats.done > 0) {
      const runAutoQueue = async () => {
        const doneList = await db.photos.where('status').equals('done').toArray();
        if (doneList.length > 0) {
          logger.info(`Auto-queuing ${doneList.length} photos`);
          await db.transaction('rw', db.photos, async () => {
            for (const p of doneList) {
              await db.photos.update(p.id, { status: 'queued' });
            }
          });
          window.dispatchEvent(new CustomEvent('pipeline-wakeup'));
        }
      };
      runAutoQueue();
    }
  }, [stats.done]);

  // Trigger pipeline check if conditions are met
  useEffect(() => {
    // Assuming loadQueue is a state or derived value indicating if files are currently being loaded
    // For this context, we'll assume it's always empty if not explicitly loading, or you might need to define it.
    // For now, let's assume `files.length === 0` implies no active loading from `useDirectoryLoader`
    const loadQueueLength = files.length; // Or a more specific state if available

    if (stats.done > 0 && stats.total > stats.done && loadQueueLength === 0) {
      // If we have photos, and not everything is done, and not currently loading specific files...
      // Trigger pipeline check if not running
      window.dispatchEvent(new CustomEvent('pipeline-wakeup'));
    }
  }, [stats.done, stats.total, files.length]);


  // Drag Handlers
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(false); };
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    const items = e.dataTransfer.items;
    if (!items) return;

    const files: File[] = [];

    async function traverse(item: FileSystemEntry) {
      if (item.isFile) {
        const fileEntry = item as FileSystemFileEntry;
        const file = await new Promise<File>(res => fileEntry.file(res));
        files.push(file);
      } else if (item.isDirectory) {
        const dirEntry = item as FileSystemDirectoryEntry;
        const reader = dirEntry.createReader();
        const entries = await new Promise<FileSystemEntry[]>(res => reader.readEntries(res));
        for (const entry of entries) {
          await traverse(entry);
        }
      }
    }

    const promises = [];
    for (const item of items) {
      const entry = item.webkitGetAsEntry();
      if (entry) promises.push(traverse(entry));
    }

    await Promise.all(promises);
    if (files.length > 0) {
      await loadFiles(files);
    } else {
      logger.warn("Drop event contained no valid files or folders");
    }
  };

  const handleToggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleRetryErrors = async () => {
    logger.info("Retrying all failed analyses...");
    await db.transaction('rw', db.photos, async () => {
      const errorPhotos = await db.photos.where('status').equals('error').toArray();
      for (const p of errorPhotos) {
        await db.photos.update(p.id, { status: 'queued' });
      }
    });
  };

  const isApiKeyMissing = !import.meta.env.VITE_GEMINI_API_KEY;

  return (
    <div className="flex flex-col h-screen bg-[#0F0F0F] text-white overflow-hidden font-sans selection:bg-blue-500/30">
      <Toaster position="bottom-right" theme="dark" />
      <DebugConsole />

      {/* API Key Warning */}
      {isApiKeyMissing && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 bg-red-500/90 backdrop-blur-md text-white px-4 py-2 rounded-full border border-red-400/50 shadow-2xl flex items-center gap-2 animate-bounce">
          <span className="text-xs font-bold ring-1 ring-white/50 rounded-full px-1.5">!</span>
          <span className="text-xs font-medium">VITE_GEMINI_API_KEY is missing in your .env file</span>
        </div>
      )}

      {/* Header */}
      <Header
        onOpenFolder={loadDirectory}
        onOpenAdmin={() => setIsAdminOpen(true)}
        onRetry={handleRetryErrors}
        total={stats.total}
        processed={processedCount}
        analyzed={stats.scored}
        queueLength={stats.queued}
        analyzingCount={stats.analyzing}
        errorCount={stats.error}
      />

      {/* Toolbar */}
      <Toolbar
        sortMode={sortMode}
        onSortChange={setSortMode}
        minScore={minScore}
        onMinScoreChange={setMinScore}
      />

      {/* Main Area */}
      <div className="flex-1 relative overflow-hidden">
        {!hasPhotos ? (
          // Empty State
          <div
            className={cn(
              "absolute inset-0 m-8 rounded-3xl border-2 border-dashed flex flex-col items-center justify-center transition-all duration-200",
              isDragOver ? "border-blue-500 bg-blue-500/5 scale-[0.99]" : "border-[#262626] bg-[#161616]"
            )}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className="w-20 h-20 rounded-full bg-[#1A1A1A] flex items-center justify-center mb-6 shadow-2xl border border-[#262626]">
              <Upload className={cn("transition-colors duration-300", isDragOver ? "text-blue-500" : "text-gray-500")} size={32} />
            </div>
            <h2 className="text-2xl font-bold mb-3 text-white">Drop Folder Here</h2>
            <p className="text-gray-500 text-sm max-w-sm text-center mb-8 leading-relaxed">
              Drag and drop your photos folder to start. AI will automatically analyze specific criteria locally and score aesthetics in the cloud.
            </p>
            <button
              onClick={() => document.getElementById('target-file-input')?.click()}
              className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-3 rounded-xl font-semibold shadow-lg shadow-blue-600/20 hover:scale-105 transition-all"
            >
              Browse Files
            </button>
            <input
              id="target-file-input"
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                if (e.target.files) loadFiles(Array.from(e.target.files));
              }}
            />
          </div>
        ) : (
          // Grid
          <PhotoGrid
            photos={photos}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
            onView={setViewingPhoto}
          />
        )}
      </div>

      {/* Detail Modal */}
      {viewingPhoto && (
        <PhotoDetailModal
          photo={viewingPhoto}
          onClose={() => setViewingPhoto(null)}
        />
      )}

      {/* Admin Dashboard Overlay */}
      {isAdminOpen && (
        <AdminDashboard
          onClose={() => setIsAdminOpen(false)}
          onRetry={handleRetryErrors}
        />
      )}
    </div>
  );
}

export default App;
