/// <reference types="vite/client" />

interface Window {
    showDirectoryPicker(options?: { mode?: 'read' | 'readwrite' }): Promise<FileSystemDirectoryHandle>;
}

interface FileSystemHandle {
    kind: 'file' | 'directory';
    name: string;
}

interface FileSystemDirectoryHandle extends FileSystemHandle {
    kind: 'directory';
    values(): AsyncIterableIterator<FileSystemHandle>;
    getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
}

interface FileSystemFileHandle extends FileSystemHandle {
    kind: 'file';
    getFile(): Promise<File>;
    createWritable(): Promise<FileSystemWritableFileStream>;
}

interface FileSystemWritableFileStream extends WritableStream {
    write(data: Blob | BufferSource | string): Promise<void>;
    close(): Promise<void>;
}

// Drag and Drop (Webkit) API types
interface FileSystemEntry {
    isFile: boolean;
    isDirectory: boolean;
    name: string;
    fullPath: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    filesystem: any;
}

interface FileSystemFileEntry extends FileSystemEntry {
    isFile: true;
    isDirectory: false;
    file(successCallback: (file: File) => void, errorCallback?: (error: DOMException) => void): void;
}

interface FileSystemDirectoryEntry extends FileSystemEntry {
    isFile: false;
    isDirectory: true;
    createReader(): FileSystemDirectoryReader;
}

interface FileSystemDirectoryReader {
    readEntries(successCallback: (entries: FileSystemEntry[]) => void, errorCallback?: (error: DOMException) => void): void;
}

interface DataTransferItem {
    webkitGetAsEntry(): FileSystemEntry | null;
}
