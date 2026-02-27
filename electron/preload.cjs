const { contextBridge, ipcRenderer } = require('electron');

// Expose a minimal API to the renderer
contextBridge.exposeInMainWorld('electronAPI', {
    isElectron: true,
    platform: process.platform,
    selectExportFolder: () => ipcRenderer.invoke('select-export-folder'),
    selectPhotos: () => ipcRenderer.invoke('select-photos'),
    selectPhotoFolder: () => ipcRenderer.invoke('select-photo-folder'),
    readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
    copyFile: (srcPath, destDir, fileName) => ipcRenderer.invoke('copy-file', srcPath, destDir, fileName),
    writeFileData: (destDir, fileName, data) => ipcRenderer.invoke('write-file-data', destDir, fileName, data),
    enhanceBasic: (filePath) => ipcRenderer.invoke('enhance-basic', filePath),
});
