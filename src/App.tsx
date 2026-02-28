import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { useDirectoryLoader } from '@/hooks/useDirectoryLoader';
import { useAIPipeline } from '@/hooks/useAIPipeline';
import { PhotoGrid } from '@/components/PhotoGrid';
import { Header } from '@/components/Header';
import { Toolbar } from '@/components/Toolbar';
import { PhotoDetailModal } from '@/components/PhotoDetailModal';
import { Toaster, toast } from 'sonner';
import { Upload, FolderOpen, ImagePlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger';
import { AdminDashboard } from './components/AdminDashboard';
import { SettingsModal, getStoredApiKey } from './components/SettingsModal';
import { AIEngine, LOCAL_SCORER_URL } from './lib/local-scorer';

// Type for Stats
// Pipeline statistics interface removed (now literal)

// Electron IPC API type
declare global {
  interface Window {
    electronAPI?: {
      isElectron: boolean;
      platform: string;
      selectExportFolder: () => Promise<string | null>;
      selectPhotos: () => Promise<string[] | null>;
      selectPhotoFolder: () => Promise<string[] | null>;
      readFile: (filePath: string) => Promise<{ success: boolean; name: string; path: string; size: number; lastModified: number; data: Uint8Array; error?: string }>;
      copyFile: (srcPath: string, destDir: string, fileName: string) => Promise<{ success: boolean; error?: string }>;
      writeFileData: (destDir: string, fileName: string, data: Uint8Array) => Promise<{ success: boolean; error?: string }>;
    };
  }
}

function App() {
  const { loadFiles, files, isLoading: isScanning, supportsFileSystemAccess } = useDirectoryLoader();

  const aiEngine: AIEngine = 'local-fast+vlm';

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sortMode, setSortMode] = useState<'date' | 'score'>('date');
  const [minScore, setMinScore] = useState<number>(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const [viewingPhotoId, setViewingPhotoId] = useState<string | null>(null);
  const [isAdminOpen, setIsAdminOpen] = useState(false);

  // Added back from lost changes
  const [pausePreprocessing, setPausePreprocessing] = useState(false);
  const [pauseAnalysis, setPauseAnalysis] = useState(false);

  // AI Smart Filter state
  const [aiFilterKeywords, setAiFilterKeywords] = useState('');
  const [aiFilterResults, setAiFilterResults] = useState<Map<string, boolean>>(new Map());
  const [aiFilterProgress, setAiFilterProgress] = useState<{ done: number; total: number } | null>(null);

  // Deduplication state
  const [isDeduping, setIsDeduping] = useState(false);
  const [showGrouped, setShowGrouped] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Import animation state — stays true from folder selection until photos appear
  const [isImporting, setIsImporting] = useState(false);

  useAIPipeline(pauseAnalysis, aiEngine); // Start Pipeline silently

  // Python backend sidecar is launched by Electron's main process (electron/main.cjs)

  // Electron-native file import: uses backend /api/preview for thumbnails (supports RAW + JPEG)
  const importFromPaths = useCallback(async (filePaths: string[]) => {
    if (!window.electronAPI) return;
    setIsImporting(true);
    logger.info(`[Electron Import] Starting import of ${filePaths.length} files via native paths`);
    console.log(`[Electron Import] LOCAL_SCORER_URL = ${LOCAL_SCORER_URL}`);

    try {
      const BATCH_SIZE = 10;
      let dbBatch: any[] = [];
      let imported = 0;
      let failed = 0;
      let firstError = '';

      for (let i = 0; i < filePaths.length; i++) {
        const filePath = filePaths[i];
        const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || filePath;
        try {
          // Check if already exists
          const existing = await db.photos.where('name').equals(fileName).first();
          if (existing && existing.status === 'scored') {
            if (!existing.filePath) {
              await db.photos.update(existing.id, { filePath });
            }
            imported++;
            continue;
          }

          // Use backend /api/preview to get a JPEG (handles RAW formats via rawpy)
          const previewUrl = `${LOCAL_SCORER_URL}/api/preview?path=${encodeURIComponent(filePath)}`;
          console.log(`[Electron Import] Fetching preview: ${previewUrl}`);
          const response = await fetch(previewUrl);
          if (!response.ok) {
            const errText = await response.text();
            const errMsg = `Preview failed for ${fileName}: HTTP ${response.status} - ${errText}`;
            console.error(`[Electron Import] ${errMsg}`);
            if (!firstError) firstError = errMsg;
            failed++;
            continue;
          }

          const imageBlob = await response.blob();
          const bitmap = await createImageBitmap(imageBlob);

          // Create preview thumbnail (300px)
          const previewScale = Math.min(300 / bitmap.width, 300 / bitmap.height, 1);
          const pw = Math.round(bitmap.width * previewScale);
          const ph = Math.round(bitmap.height * previewScale);
          const previewCanvas = new OffscreenCanvas(pw, ph);
          const previewCtx = previewCanvas.getContext('2d')!;
          previewCtx.drawImage(bitmap, 0, 0, pw, ph);
          const pvBlob = await previewCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
          const previewBuf = await pvBlob.arrayBuffer();

          // Create analysis thumbnail (512px)
          const analysisScale = Math.min(512 / bitmap.width, 512 / bitmap.height, 1);
          const aw = Math.round(bitmap.width * analysisScale);
          const ah = Math.round(bitmap.height * analysisScale);
          const analysisCanvas = new OffscreenCanvas(aw, ah);
          const analysisCtx = analysisCanvas.getContext('2d')!;
          analysisCtx.drawImage(bitmap, 0, 0, aw, ah);
          const anBlob = await analysisCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
          const analysisBuf = await anBlob.arrayBuffer();

          bitmap.close();

          const id = `drop-${crypto.randomUUID()}`;
          dbBatch.push({
            id,
            name: fileName,
            size: 0, // Size not critical for processing
            type: 'image/jpeg',
            lastModified: Date.now(),
            webkitRelativePath: fileName,
            filePath,
            previewBlob: previewBuf,
            analysisBlob: analysisBuf,
            status: 'done',
            createdAt: Date.now()
          });
          imported++;
        } catch (err: any) {
          const errMsg = err?.message || String(err);
          console.error(`[Electron Import] Error processing ${fileName}: ${errMsg}`, err);
          if (!firstError) firstError = `${fileName}: ${errMsg}`;
          failed++;
        }

        // Flush to DB periodically
        if (dbBatch.length >= BATCH_SIZE || i === filePaths.length - 1) {
          if (dbBatch.length > 0) {
            try {
              await db.transaction('rw', db.photos, async () => {
                await db.photos.bulkPut(dbBatch);
              });
            } catch (e) {
              console.error('[Electron Import] DB batch write failed:', e);
            }
            dbBatch = [];
          }
        }

        // Yield to UI every 5 files
        if (i % 5 === 4) {
          await new Promise(r => setTimeout(r, 0));
        }
      }

      if (failed > 0 && imported === 0) {
        toast.error(`Import failed: ${failed} photos could not be imported`, {
          description: firstError ? `First error: ${firstError.substring(0, 200)}` : undefined,
          duration: 15000,
        });
      } else {
        toast.success(`Imported ${imported} photos${failed > 0 ? ` (${failed} failed)` : ''}`, {
          description: 'Starting AI analysis...'
        });
      }
    } catch (err: any) {
      console.error('[Electron Import] Import failed:', err);
      toast.error(`Import failed: ${err?.message || err}`, { duration: 15000 });
    } finally {
      setIsImporting(false);
    }
  }, []);

  // Electron-aware handlers for Select Photos / Select Folder
  const handleSelectPhotos = useCallback(async () => {
    if (window.electronAPI) {
      const paths = await window.electronAPI.selectPhotos();
      if (paths && paths.length > 0) {
        await importFromPaths(paths);
      }
    } else {
      document.getElementById('target-file-input')?.click();
    }
  }, [importFromPaths]);

  const handleSelectFolder = useCallback(async () => {
    if (window.electronAPI) {
      const paths = await window.electronAPI.selectPhotoFolder();
      if (paths && paths.length > 0) {
        await importFromPaths(paths);
      }
    } else {
      document.getElementById('folder-input')?.click();
    }
  }, [importFromPaths]);

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

  // Stable, monotonically-increasing progress values (never jump backwards)
  // Preprocessing complete = everything that's past the 'new' + 'processing' stages
  const preprocessed = stats.total - stats.new - stats.processing;
  // AI analysis complete = photos in terminal states (scored or error)
  const aiComplete = stats.scored + stats.error;

  // Polled photos query: refresh every 3 seconds.
  // IMPORTANT: We do NOT use useLiveQuery here because it fires on every DB write,
  // creating huge garbage pressure. After 13 hours of pipeline processing, this
  // caused V8 to hit the 4GB heap limit and crash (OOM).
  const [photos, setPhotos] = useState<any[]>([]);
  const lastFingerprintRef = useRef<string>('');

  useEffect(() => {
    let cancelled = false;

    const fetchPhotos = async () => {
      try {
        const results: any[] = [];
        await db.photos.each(record => {
          results.push({
            id: record.id,
            name: record.name,
            size: record.size,
            type: record.type,
            lastModified: record.lastModified,
            webkitRelativePath: record.webkitRelativePath,
            handle: record.handle,
            score: record.score,
            originalScore: record.originalScore,
            reason: record.reason,
            tags: record.tags,
            groupId: record.groupId,
            status: record.status,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
            rejected: record.rejected,
            magicEdits: record.magicEdits,
            hasPreview: !!record.previewBlob,
            hasAnalysis: !!record.analysisBlob,
            hasOriginal: !!record.originalBlob
          });
        });

        // Only trigger re-render if data actually changed
        const fingerprint = results.map(r => `${r.id}:${r.status}:${r.score}:${r.groupId}:${r.rejected}`).join('|');
        if (!cancelled && fingerprint !== lastFingerprintRef.current) {
          lastFingerprintRef.current = fingerprint;
          setPhotos(results);
        }
      } catch (e) {
        console.error('[Photos Poll] Error:', e);
      }
    };

    fetchPhotos(); // Initial load
    const intervalId = setInterval(fetchPhotos, 3000);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, []);

  const filteredJobs = useMemo(() => {
    let result = photos.filter(p => !p.rejected);

    // Group identical bursts: only keep the best photo per groupId (when toggle is ON)
    if (showGrouped) {
      const groupBestMap = new Map<string, typeof result[0]>();
      for (const p of result) {
        if (p.groupId) {
          const existing = groupBestMap.get(p.groupId);
          if (!existing || Number(p.score || 0) > Number(existing.score || 0)) {
            groupBestMap.set(p.groupId, p);
          }
        }
      }

      result = result.filter(p => {
        if (!p.groupId) return true; // Keep standalones
        if (p.hasOriginal) return true; // Always keep enhanced photos
        return groupBestMap.get(p.groupId)?.id === p.id;
      });
    }

    // sorting
    result.sort((a, b) => {
      if (sortMode === 'score') {
        const scoreA = Number(a.score) || 0;
        const scoreB = Number(b.score) || 0;
        if (scoreA !== scoreB) {
          return scoreB - scoreA;
        }
      }

      return (b.createdAt || 0) - (a.createdAt || 0);
    });

    if (photos.length > 0) {
      console.log(`[Sort Debug] Mode: ${sortMode}. Top 1: Score=${photos[0].score}, ID=${photos[0].id}`);
    }

    if (minScore > 0) {
      return result.filter(p => {
        // AI-enhanced photos (with originalBlob backup) should always be kept visible, preventing them from disappearing if score drops after enhancement.
        if (p.hasOriginal) return true;
        // Always show un-scored photos so they don't disappear while processing
        if (p.status !== 'scored') return true;
        return (Number(p.score) || 0) >= minScore;
      });
    }
    return result;
  }, [photos, sortMode, minScore, showGrouped]) || [];

  // Apply AI Smart Filter on top of score-filtered results
  const displayedJobs = useMemo(() => {
    if (!aiFilterKeywords || aiFilterResults.size === 0) return filteredJobs;
    return filteredJobs.filter(p => {
      // For RAG matching, if the Map explicitly says false, hide it.
      // If the map doesn't contain it yet (still typing/searching), we generally hide it to prevent flashes, 
      // but showing unclassified is safer. Let's strictly only show truthy matches when a keyword is active.
      return aiFilterResults.get(p.id) === true;
    });
  }, [filteredJobs, aiFilterKeywords, aiFilterResults]);

  // Phase 5 RAG-based AI Smart Filter
  // Replaces slow VLM batch classification with instantaneous client-side string matching against pre-computed `tags` & `reason`.
  const handleAiFilterSubmit = useCallback(async (keywords: string) => {
    if (!keywords.trim()) {
      setAiFilterKeywords('');
      setAiFilterResults(new Map());
      return;
    }

    console.log(`[AI Smart Filter / RAG] Searching offline for: "${keywords}"`);
    setAiFilterKeywords(keywords);

    // Simulate slight progress bar for UI feedback
    setAiFilterProgress({ done: 50, total: 100 });

    try {
      const photosToClassify = filteredJobs.filter(p => p.status === 'scored');
      const results = new Map<string, boolean>();
      const searchTerms = keywords.toLowerCase().split(',').map(t => t.trim()).filter(Boolean);

      for (const photo of photosToClassify) {
        let isMatch = false;

        // 1. Exact or partial match in pre-computed tags
        if (photo.tags && photo.tags.length > 0) {
          isMatch = searchTerms.some(term =>
            photo.tags!.some((tag: string) => tag.toLowerCase().includes(term))
          );
        }

        // 2. Fallback to scoring reason text
        if (!isMatch && photo.reason) {
          const reasonLower = photo.reason.toLowerCase();
          isMatch = searchTerms.some(term => reasonLower.includes(term));
        }

        results.set(photo.id, isMatch);
      }

      setAiFilterResults(results);
      const matchCount = [...results.values()].filter(Boolean).length;
      toast.success(`Semantic Filter: ${matchCount} photos match "${keywords}"`);
    } catch (error) {
      logger.error('Semantic filter failed', error);
      toast.error('Search failed.');
    } finally {
      setAiFilterProgress(null);
    }
  }, [filteredJobs]);

  const handleAiFilterClear = useCallback(() => {
    setAiFilterKeywords('');
    setAiFilterResults(new Map());
    setAiFilterProgress(null);
  }, []);

  const hasPhotos = stats.total > 0;
  const isComplete = hasPhotos && stats.scored === stats.total && !isScanning;

  // Auto-clear importing state once photos appear
  useEffect(() => {
    if (hasPhotos && isImporting) setIsImporting(false);
  }, [hasPhotos, isImporting]);


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
      const { id, status, thumbBuf, analysisBuf } = e.data;
      if (status === 'success') {
        try {
          await db.photos.update(id, {
            status: 'done',
            previewBlob: thumbBuf,   // ArrayBuffer, not Blob
            analysisBlob: analysisBuf // ArrayBuffer, not Blob
          });
        } catch (err) {
          console.error('[Worker CB] DB update failed for', id, err);
          await db.photos.update(id, { status: 'error' });
        }
      } else {
        await db.photos.update(id, { status: 'error' });
      }
    };
    return () => { workerRef.current?.terminate(); };
  }, []);

  // Files are now fully processed by useDirectoryLoader (thumbnails + DB writes).
  // This effect just shows a notification when import completes.
  useEffect(() => {
    if (files.length > 0) {
      toast.success(`Imported ${files.length} photos`, {
        description: "Thumbnails created. Starting AI analysis..."
      });
    }
  }, [files]);

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

  const handleReject = async (id: string) => {
    await db.photos.update(id, { rejected: true });
    // Remove from selection if it was selected
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
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

  const handleRescoreAll = async () => {
    logger.info("Rescoring all eligible photos...");
    toast.success("Eligible photos added to queue for re-scoring.");
    await db.transaction('rw', db.photos, async () => {
      // Get all photos that are 'scored' or 'error' (ignore 'processing'/'queued'/'new')
      const allPhotos = await db.photos.toArray();
      const eligiblePhotos = allPhotos.filter(p => ['scored', 'error'].includes(p.status) && (p.previewBlob || p.filePath));
      for (const p of eligiblePhotos) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updateData: any = {
          status: 'queued',
          score: undefined,
          reason: undefined
          // Do NOT touch originalScore or originalBlob
        };
        if (p.previewBlob) {
          // Use previewBlob (enhanced version if enhancement was applied, original preview otherwise)
          updateData.analysisBlob = p.previewBlob;
        }
        // If no previewBlob but has filePath, pipeline will read from disk
        await db.photos.update(p.id, updateData);
      }
    });
    window.dispatchEvent(new CustomEvent('pipeline-wakeup'));
  };

  const handleDeduplicate = async () => {
    // If already grouped, just toggle off
    if (showGrouped) {
      setShowGrouped(false);
      toast.info('Group Similar disabled — showing all photos.');
      return;
    }

    // Check if groupIds already exist (from a previous run)
    const hasGroups = photos.some(p => p.groupId);
    if (hasGroups) {
      // Already clustered, just toggle on
      setShowGrouped(true);
      toast.success('Group Similar enabled — showing best per group.');
      return;
    }

    // No groups yet — run clustering
    setIsDeduping(true);
    try {
      const allScored = await db.photos.where('status').equals('scored').toArray();
      const withEmbeddings = allScored.filter(p => p.clip_embedding && p.clip_embedding.length > 0);

      if (withEmbeddings.length === 0) {
        toast.error("No photos with embeddings found. Try scoring photos locally first.");
        return;
      }

      toast.info(`Clustering ${withEmbeddings.length} photos for deduplication...`);

      const response = await fetch(`${LOCAL_SCORER_URL}/api/cluster`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: withEmbeddings.map(p => ({
            id: p.id,
            embedding: p.clip_embedding
          })),
          threshold: 0.92
        })
      });

      if (!response.ok) throw new Error("Clustering API call failed");
      const data = await response.json();

      const clusters: string[][] = data.clusters || [];
      const actualBursts = clusters.filter(c => c.length > 1);

      await db.transaction('rw', db.photos, async () => {
        const existing = await db.photos.filter(p => !!p.groupId).toArray();
        for (const p of existing) await db.photos.update(p.id, { groupId: undefined });

        for (let i = 0; i < actualBursts.length; i++) {
          const clusterIds = actualBursts[i];
          const groupId = `burst_${i}_${Date.now()}`;
          for (const id of clusterIds) {
            await db.photos.update(id, { groupId });
          }
        }
      });

      setShowGrouped(true);
      toast.success(`Grouped ${actualBursts.length} clusters. Toggle to show/hide.`);
    } catch (e) {
      console.error(e);
      toast.error("Burst deduplication failed checking console.");
    } finally {
      setIsDeduping(false);
    }
  };

  // One-click export: copy qualifying photos to a user-selected folder
  const handleExport = async () => {
    if (!window.electronAPI) {
      toast.error('Export is only available in the desktop app.');
      return;
    }

    // Open native folder picker
    const destDir = await window.electronAPI.selectExportFolder();
    if (!destDir) return; // User cancelled

    setIsExporting(true);
    try {
      let qualified: typeof photos extends (infer T)[] ? T[] : never;

      if (selectedIds.size > 0) {
        // Export only user-selected photos
        const selected = await db.photos.bulkGet([...selectedIds]);
        qualified = selected.filter((p): p is NonNullable<typeof p> => !!p && !p.rejected);
      } else {
        // No selection: export all scored, non-rejected photos above minScore
        const allScored = await db.photos.where('status').equals('scored').toArray();
        qualified = allScored.filter(p =>
          !p.rejected &&
          (minScore === 0 || (Number(p.score) || 0) >= minScore)
        );
      }

      if (qualified.length === 0) {
        toast.info(selectedIds.size > 0
          ? 'No exportable photos in your selection.'
          : `No exportable photos found${minScore > 0 ? ` with score ≥ ${minScore}` : ''}.`
        );
        setIsExporting(false);
        return;
      }

      toast.info(`Exporting ${qualified.length} photos...`);
      let success = 0;
      let fail = 0;

      for (const photo of qualified) {
        try {
          let result: { success: boolean; error?: string };

          if (photo.originalBlob && photo.analysisBlob) {
            // Enhanced photo: export the polished version from DB
            const data = new Uint8Array(photo.analysisBlob);
            result = await window.electronAPI!.writeFileData(destDir, photo.name, data);
          } else if (photo.filePath) {
            // Un-enhanced: copy original file from disk (full quality)
            result = await window.electronAPI!.copyFile(photo.filePath, destDir, photo.name);
          } else {
            // Fallback: write DB blob to file
            const blob = photo.analysisBlob || photo.previewBlob;
            if (!blob) {
              fail++;
              continue;
            }
            const data = new Uint8Array(blob);
            result = await window.electronAPI!.writeFileData(destDir, photo.name, data);
          }

          if (result.success) {
            success++;
          } else {
            logger.warn(`Failed to export ${photo.name}: ${result.error}`);
            fail++;
          }
        } catch {
          fail++;
        }
      }

      toast.success(`Exported ${success} photos!`, {
        description: fail > 0 ? `${fail} files failed.` : `Saved to: ${destDir}`,
      });
    } catch (e) {
      console.error('Export failed:', e);
      toast.error('Export failed. See console for details.');
    } finally {
      setIsExporting(false);
    }
  };

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const isGeminiKeyMissing = !import.meta.env.VITE_GEMINI_API_KEY && !getStoredApiKey();

  return (
    <div className="flex flex-col h-screen bg-[#0F0F0F] text-white overflow-hidden font-sans selection:bg-blue-500/30">
      <Toaster position="bottom-right" theme="dark" />
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />

      {/* Gemini API Key Info (only show when no key and no photos loaded yet) */}
      {isGeminiKeyMissing && stats.total === 0 && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 bg-amber-500/90 backdrop-blur-md text-black px-4 py-2 rounded-full border border-amber-400/50 shadow-2xl flex items-center gap-2">
          <span className="text-xs font-bold">⚙️</span>
          <span className="text-xs font-medium">Gemini API key not set (needed for Fast/Pro modes).</span>
          <button onClick={() => setIsSettingsOpen(true)} className="text-xs font-bold underline underline-offset-2 hover:text-amber-900">Open Settings</button>
        </div>
      )}

      <Header
        onOpenFolder={handleSelectFolder}
        onOpenFiles={handleSelectPhotos}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onRetry={handleRetryErrors}
        onRescoreAll={handleRescoreAll}
        total={stats.total}
        processed={preprocessed}
        analyzed={aiComplete}
        queueLength={stats.queued}
        analyzingCount={stats.analyzing}
        errorCount={stats.error}
        supportsFileSystemAccess={supportsFileSystemAccess}
        pausePreprocessing={pausePreprocessing}
        onTogglePausePreprocessing={() => setPausePreprocessing(p => !p)}
        pauseAnalysis={pauseAnalysis}
        onTogglePauseAnalysis={() => setPauseAnalysis(p => !p)}
        onExport={handleExport}
        isExporting={isExporting}
      />

      {/* Toolbar */}
      <Toolbar
        sortMode={sortMode}
        onSortChange={setSortMode}
        minScore={minScore}
        onMinScoreChange={setMinScore}
        aiFilterKeywords={aiFilterKeywords}
        onAiFilterSubmit={handleAiFilterSubmit}
        onAiFilterClear={handleAiFilterClear}
        aiFilterProgress={aiFilterProgress}
        onDedupeClick={handleDeduplicate}
        isDeduping={isDeduping}
        isGroupActive={showGrouped}
        selectedCount={selectedIds.size}
        totalCount={displayedJobs.length}
        onSelectAll={() => setSelectedIds(new Set(displayedJobs.map(p => p.id)))}
        onDeselectAll={() => setSelectedIds(new Set())}
      />

      {/* Main Area */}
      <div className="flex-1 relative overflow-hidden">
        {!hasPhotos ? (
          isImporting ? (
            // Scanning Animation State
            <div className="absolute inset-0 m-8 rounded-3xl border-2 border-blue-500/30 bg-[#161616] flex flex-col items-center justify-center">
              {/* Animated Spinner */}
              <div className="relative w-24 h-24 mb-8">
                <div className="absolute inset-0 rounded-full border-4 border-[#262626]" />
                <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-blue-500 animate-spin" />
                <div className="absolute inset-2 rounded-full border-4 border-transparent border-b-purple-500 animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
                <div className="absolute inset-0 flex items-center justify-center">
                  <FolderOpen className="text-blue-400" size={28} />
                </div>
              </div>
              <h2 className="text-xl font-bold text-white mb-2 animate-pulse">Scanning Folder...</h2>
              <p className="text-gray-400 text-sm max-w-sm text-center leading-relaxed">
                Discovering and importing your photos. This may take a moment for large folders.
              </p>
              <div className="mt-6 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 rounded-full bg-blue-300 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          ) : (
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
              <h2 className="text-2xl font-bold mb-3 text-white">Drag & Drop or Select Photos</h2>
              <p className="text-gray-500 text-sm max-w-sm text-center mb-8 leading-relaxed">
                Start by selecting a folder or individual photos. AI will automatically analyze lighting, composition, and aesthetics locally.
              </p>
              {/* Separate buttons: select photos vs select folder */}
              <div className="flex gap-4">
                <button
                  onClick={handleSelectPhotos}
                  className="flex items-center gap-2 bg-[#1A1A1A] hover:bg-[#262626] text-white border border-[#333] px-6 py-3 rounded-xl font-semibold transition-all active:scale-95"
                >
                  <ImagePlus size={18} className="text-blue-500" /> Select Photos
                </button>

                <button
                  onClick={handleSelectFolder}
                  className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-xl font-semibold shadow-lg shadow-blue-600/20 hover:scale-105 transition-all active:scale-95"
                >
                  <FolderOpen size={18} /> Select Folder
                </button>
              </div>


            </div>
          )
        ) : (
          // Grid
          <PhotoGrid
            photos={displayedJobs as any}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
            onView={(p) => setViewingPhotoId(p.id)}
            onReject={handleReject}
          />
        )}
      </div>

      {/* Detail Modal */}
      {viewingPhotoId && (
        <PhotoDetailModal
          photoId={viewingPhotoId}
          onClose={() => setViewingPhotoId(null)}
        />
      )}

      {/* Admin Dashboard Overlay */}
      {isAdminOpen && (
        <AdminDashboard
          onClose={() => setIsAdminOpen(false)}
          onRetry={handleRetryErrors}
        />
      )}

      {/* Hidden File Input for "Add Photos" (Must be always present) */}
      <input
        id="target-file-input"
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            setIsImporting(true);
            loadFiles(Array.from(e.target.files));
            e.target.value = '';
          }
        }}
      />

      {/* Cross-platform Directory Input */}
      <input
        id="folder-input"
        type="file"
        /* @ts-expect-error React historically uses custom casing for this */
        webkitdirectory="true"
        directory="true"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            setIsImporting(true);
            loadFiles(Array.from(e.target.files));
            e.target.value = '';
          }
        }}
      />
    </div>
  );
}

export default App;
