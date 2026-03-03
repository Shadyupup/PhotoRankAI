import Dexie, { type Table } from 'dexie';

// Define photo editing parameters structure
export interface EditConfig {
    crop: { x: number; y: number; width: number; height: number }; // Percentage 0.0 - 1.0
    filters: {
        brightness: number; // default 1.0
        contrast: number;   // default 1.0
        saturate: number;   // default 1.0
        grayscale: number;  // default 0.0
        sepia: number;      // default 0.0
    };
    predictedScore: number;
    fixReason: string;
}

export interface PhotoMetadata {
    id: string;
    file?: File;
    name: string;
    size: number;
    type: string;
    lastModified: number;
    webkitRelativePath: string; // Keep path for folder structure

    // Binary data stored as ArrayBuffer (NOT Blob — WebKit/Tauri cannot store Blobs in IndexedDB)
    analysisBlob?: ArrayBuffer;      // Current display image (original or AI-enhanced)
    previewBlob?: ArrayBuffer;       // Tiny Thumbnail (e.g. 200px) for Grid

    // --- Additional fields ---
    originalBlob?: ArrayBuffer;      // Absolute original backup (for comparison)
    // ----------------

    handle?: FileSystemFileHandle; // For zero-upload access
    filePath?: string; // Absolute path from Electron's File.path
    enhancedFilePath?: string; // Path to the enhanced image saved on disk

    // AI Results
    score?: number;
    originalScore?: number;   // Original score before enhancement
    reason?: string;
    tags?: string[];          // AI-extracted semantic tags for offline RAG search
    clip_embedding?: number[]; // Store 768-D visual feature for clustering
    groupId?: string;          // Defines which deduplication cluster this belongs to
    status: 'new' | 'processing' | 'queued' | 'analyzing' | 'scored' | 'error' | 'done';

    createdAt?: number;
    updatedAt?: number;

    // Soft-delete: hide from grid & export without removing original file
    rejected?: boolean;

    // Additional field: store AI editing suggestions
    magicEdits?: EditConfig;
}

export interface LogEntry {
    id?: number;
    timestamp: number;
    level: 'info' | 'warn' | 'error' | 'success';
    message: string;
    data?: unknown;
}

export class PhotoRankDB extends Dexie {
    photos!: Table<PhotoMetadata>;
    logs!: Table<LogEntry>;

    constructor() {
        super('PhotoRankDB');
        // Upgrade to version 28, add name index for dedup queries on import
        this.version(28).stores({
            photos: 'id, status, score, name, *tags, createdAt',
            logs: '++id, timestamp, level'
        });
    }
}


export const db = new PhotoRankDB();

export async function resetDatabase() {
    try {
        await db.delete();
        return true;
    } catch (e) {
        console.error("Failed to delete database", e);
        return false;
    }
}
