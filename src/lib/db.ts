import Dexie, { type Table } from 'dexie';

// 定义修图参数的结构
export interface EditConfig {
    crop: { x: number; y: number; width: number; height: number }; // 百分比 0.0 - 1.0
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

    // Blob handling
    analysisBlob?: Blob;      // 这是“当前显示的图” (可能是原图，也可能是 AI 修过的图)
    previewBlob?: Blob;       // Tiny Thumbnail (e.g. 200px) for Grid

    // --- 新增字段 ---
    originalBlob?: Blob;      // 这是“绝对原图备份” (用于对比)
    // ----------------

    handle?: FileSystemFileHandle; // For zero-upload access

    // AI Results
    score?: number;
    originalScore?: number;   // <--- 【新增】保存优化前的原始分数
    reason?: string;
    status: 'new' | 'processing' | 'queued' | 'analyzing' | 'scored' | 'error' | 'done';

    createdAt?: number;
    updatedAt?: number;

    // 新增字段：存储 AI 的修图建议
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
        // 升级版本号到 26，以应用 schema 变更
        this.version(26).stores({
            photos: 'id, status, score, createdAt',
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
