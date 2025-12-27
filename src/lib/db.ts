import Dexie, { type Table } from 'dexie';

export interface PhotoMetadata {
    id: string; // Unique path
    name: string;
    path: string; // Relative path
    size: number;
    handle?: FileSystemFileHandle;

    // Generated Content
    previewBlob?: Blob;
    analysisBlob?: Blob; // 1024px version

    // AI Results
    score?: number;
    reason?: string;

    file?: File; // Store direct File object for dropped files (supported by IndexedDB)
    // Meta
    status: 'new' | 'processing' | 'done' | 'queued' | 'analyzing' | 'scored' | 'error';
    width?: number;
    height?: number;
    createdAt: number;
    updatedAt?: number;
}

export interface LogEntry {
    id?: number;
    timestamp: number;
    level: 'info' | 'warn' | 'error';
    message: string;
    details?: unknown;
}

export class PhotoRankDB extends Dexie {
    photos!: Table<PhotoMetadata>;
    logs!: Table<LogEntry>;

    constructor() {
        super('PhotoRankDB');
        // 强行提到 25（必须比你之前看到的 21 大）
        this.version(25).stores({
            photos: 'id, status, score, createdAt',
            logs: '++id, timestamp, level'
        });
    }
}

export const db = new PhotoRankDB();
