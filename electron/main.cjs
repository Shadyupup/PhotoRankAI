const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

// --- Security: Path validation ---
const ALLOWED_IMAGE_EXTENSIONS = new Set([
    '.jpg', '.jpeg', '.png', '.webp', '.avif', '.tiff', '.tif', '.bmp',
    '.cr2', '.cr3', '.nef', '.arw', '.dng', '.raf', '.orf', '.rw2',
]);

function isAllowedImagePath(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return ALLOWED_IMAGE_EXTENSIONS.has(ext);
}

// IPC: Select export folder via native dialog
ipcMain.handle('select-export-folder', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory'],
        title: 'Select Export Destination',
        buttonLabel: 'Export Here',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
});

// IPC: Select photo files via native dialog
ipcMain.handle('select-photos', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        title: 'Select Photos',
        buttonLabel: 'Import',
        filters: [
            { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'dng', 'cr2', 'cr3', 'nef', 'arw', 'raf'] },
        ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths;
});

// IPC: Select a folder via native dialog (returns all image files recursively)
ipcMain.handle('select-photo-folder', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Select Photo Folder',
        buttonLabel: 'Import Folder',
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    // Recursively find all image files in the selected folder
    const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.dng', '.cr2', '.cr3', '.nef', '.arw', '.raf']);
    const imagePaths = [];

    function walkDir(dir) {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.name.startsWith('.')) continue; // Skip hidden files
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    walkDir(fullPath);
                } else if (entry.isFile()) {
                    const ext = path.extname(entry.name).toLowerCase();
                    if (imageExtensions.has(ext)) {
                        imagePaths.push(fullPath);
                    }
                }
            }
        } catch (e) {
            console.error(`[Electron] Error reading directory ${dir}:`, e.message);
        }
    }

    walkDir(result.filePaths[0]);
    return imagePaths.length > 0 ? imagePaths : null;
});

// IPC: Read a file from disk and return its contents as a Buffer
ipcMain.handle('read-file', async (event, filePath) => {
    try {
        if (!isAllowedImagePath(filePath)) {
            return { success: false, error: 'File type not allowed' };
        }
        const resolved = path.resolve(filePath);
        const data = await fs.promises.readFile(resolved);
        const name = path.basename(resolved);
        const stats = await fs.promises.stat(resolved);
        return {
            success: true,
            name,
            path: resolved,
            size: stats.size,
            lastModified: stats.mtimeMs,
            data: data,
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// IPC: Copy a file to the destination directory
ipcMain.handle('copy-file', async (event, srcPath, destDir, fileName) => {
    try {
        if (!isAllowedImagePath(srcPath)) {
            return { success: false, error: 'File type not allowed' };
        }
        const destPath = path.join(destDir, fileName);
        await fs.promises.copyFile(path.resolve(srcPath), destPath);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// IPC: Write raw data to a file (for exporting DB blobs)
ipcMain.handle('write-file-data', async (event, destDir, fileName, data) => {
    try {
        const destPath = path.join(destDir, fileName);
        // IPC may serialize Uint8Array to various formats; handle all cases
        let buf;
        if (Buffer.isBuffer(data)) {
            buf = data;
        } else if (data instanceof Uint8Array) {
            buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
        } else if (Array.isArray(data)) {
            buf = Buffer.from(data);
        } else {
            // IPC structured clone may produce a plain object with numeric keys
            buf = Buffer.from(Object.values(data));
        }
        console.log(`[writeFileData] Writing ${fileName}: ${buf.length} bytes`);
        await fs.promises.writeFile(destPath, buf);
        return { success: true };
    } catch (err) {
        console.error(`[writeFileData] Failed: ${err.message}`);
        return { success: false, error: err.message };
    }
});

// IPC: Save enhanced image to disk next to original file
ipcMain.handle('save-enhanced-file', async (event, originalPath, data) => {
    try {
        // Generate enhanced file path: /path/to/photo.JPG → /path/to/photo_enhanced.JPG
        const ext = path.extname(originalPath);
        const baseName = path.basename(originalPath, ext);
        const dir = path.dirname(originalPath);
        const enhancedPath = path.join(dir, `${baseName}_enhanced${ext}`);

        // Handle IPC data serialization (same as writeFileData)
        let buf;
        if (Buffer.isBuffer(data)) {
            buf = data;
        } else if (data instanceof Uint8Array) {
            buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
        } else if (Array.isArray(data)) {
            buf = Buffer.from(data);
        } else {
            buf = Buffer.from(Object.values(data));
        }

        console.log(`[saveEnhancedFile] Saving ${enhancedPath}: ${buf.length} bytes`);
        await fs.promises.writeFile(enhancedPath, buf);
        return { success: true, path: enhancedPath };
    } catch (err) {
        console.error(`[saveEnhancedFile] Failed: ${err.message}`);
        return { success: false, error: err.message };
    }
});

// Python backend sidecar process
let pythonProcess = null;
let mainWindow = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        title: 'PhotoRank AI',
        titleBarStyle: 'hiddenInset',
        backgroundColor: '#0A0A0A',
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    // In dev, load Vite dev server; in production, load built files
    if (process.env.VITE_DEV_SERVER_URL) {
        mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
        mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
    }

    // Auto-recover from renderer crashes (V8 OOM, GPU crashes, etc.)
    mainWindow.webContents.on('render-process-gone', (event, details) => {
        console.error(`[Electron] Renderer crashed: ${details.reason} (code: ${details.exitCode})`);
        console.log('[Electron] Reloading in 2 seconds...');
        setTimeout(() => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.reload();
            }
        }, 2000);
    });

    // Also handle unresponsive renderer
    mainWindow.on('unresponsive', () => {
        console.warn('[Electron] Window unresponsive, reloading...');
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.reload();
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function startPythonBackend() {
    // In dev mode, the user runs `python3 backend/server.py` manually
    if (process.env.VITE_DEV_SERVER_URL) {
        console.log('[Electron] Dev mode — skipping Python sidecar. Run `python3 backend/server.py` manually.');
        return;
    }

    const serverPath = path.join(__dirname, '..', 'backend', 'server.py');
    pythonProcess = spawn('python3', [serverPath], {
        cwd: path.join(__dirname, '..', 'backend'),
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    pythonProcess.stdout.on('data', (data) => {
        console.log(`[Python] ${data.toString().trim()}`);
    });

    pythonProcess.stderr.on('data', (data) => {
        console.error(`[Python] ${data.toString().trim()}`);
    });

    pythonProcess.on('close', (code) => {
        console.log(`[Python] Backend exited with code ${code}`);
    });
}

app.whenReady().then(() => {
    startPythonBackend();
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (pythonProcess) {
        pythonProcess.kill();
        pythonProcess = null;
    }
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    if (pythonProcess) {
        pythonProcess.kill();
        pythonProcess = null;
    }
});
