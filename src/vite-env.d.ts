/// <reference types="vite/client" />

interface Window {
    showDirectoryPicker(): Promise<FileSystemDirectoryHandle>;
}

interface FileSystemHandle {
    kind: 'file' | 'directory';
    name: string;
}

interface FileSystemFileHandle extends FileSystemHandle {
    kind: 'file';
    getFile(): Promise<File>;
}

interface FileSystemDirectoryHandle extends FileSystemHandle {
    kind: 'directory';
    values(): AsyncIterableIterator<FileSystemHandle>;
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
