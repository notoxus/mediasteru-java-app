import { app, BrowserWindow, clipboard, dialog, ipcMain, session, shell } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import { CompanionServer } from './core/companion-server';
import { DownloadQueue } from './core/download-queue';
import { LibraryRepository } from './core/library-repository';
import { PlayerService } from './core/player-service';
import { Downloader } from './downloader';
import { LogStore } from './log-store';
import { CapturedMedia, DownloadTask, EnqueueDownloadRequest, ImportedMedia } from './types';

let mainWindow: BrowserWindow | null = null;
let huntingWindow: BrowserWindow | null = null;
let downloader: Downloader;
let downloadQueue: DownloadQueue;
let library: LibraryRepository;
let player: PlayerService;
let companion: CompanionServer;
let logs: LogStore;

const projectRoot = resolve(__dirname, '..', '..');
const smokeTestOutput = process.argv.find((argument) => argument.startsWith('--smoke-test='))?.slice('--smoke-test='.length);
const hunterSmokeOutput = process.argv.find((argument) => argument.startsWith('--hunter-smoke='))?.slice('--hunter-smoke='.length);

function publishCapture(capture: CapturedMedia): void {
  logs.write('INFO', `Captured media endpoint: ${capture.url}`);
  mainWindow?.webContents.send('hunt:captured', capture);
  if (hunterSmokeOutput) {
    writeFileSync(hunterSmokeOutput, JSON.stringify(capture, null, 2));
    setTimeout(() => app.exit(0), 100);
  }
}

function publishQueue(tasks: DownloadTask[]): void {
  mainWindow?.webContents.send('queue:changed', tasks);
  companion?.publish('downloads', { downloads: tasks });
}

function publishLibrary(): void {
  const items = library.list();
  mainWindow?.webContents.send('library:changed', items);
  companion?.publish('library', { items });
}

function runHunterSmokeFixture(): void {
  const server = createServer((request, response) => {
    if (request.url === '/playlist') {
      response.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      response.end('#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-ENDLIST\n');
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><script>fetch("/playlist", {headers:{"X-Hunter-Smoke":"yes"}})</script>');
  });
  server.listen(0, '127.0.0.1', () => {
    const address = server.address() as AddressInfo;
    openHuntingWindow(`http://127.0.0.1:${address.port}/`);
  });
  app.once('before-quit', () => server.close());
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    title: 'MediaSteru',
    backgroundColor: '#0d1117',
    autoHideMenuBar: true,
    show: false,
    icon: join(__dirname, 'renderer', 'logo.png'),
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  void mainWindow.loadFile(join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    if (!smokeTestOutput) mainWindow?.show();
  });
  if (smokeTestOutput) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        void mainWindow?.webContents.executeJavaScript(`
          document.querySelector('[data-view="library"]').click();
          const libraryVisible = !document.getElementById('library-view').hidden;
          document.querySelector('[data-view="downloads"]').click();
          document.getElementById('download-button').click();
          new Promise(resolve => setTimeout(
            () => resolve({
              libraryVisible,
              statusText: document.getElementById('status-text').textContent
            }), 50
          ));
        `).then((result: unknown) => {
          const smoke = result as { libraryVisible?: boolean; statusText?: string };
          if (!smoke.libraryVisible || smoke.statusText !== 'Paste a URL to download directly.') {
            logs.write('ERROR', `Renderer smoke failed: ${JSON.stringify(smoke)}`);
            app.exit(3);
            return Promise.reject(new Error('Renderer smoke failed'));
          }
          return mainWindow!.webContents.capturePage();
        }).then((image) => {
          writeFileSync(smokeTestOutput, image.toPNG());
          app.exit(0);
        }).catch(() => app.exit(3));
      }, 500);
    });
  }
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function normalizeRequestHeaders(headers: Record<string, string | string[]>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    normalized[name] = Array.isArray(value) ? value.join(', ') : value;
  }
  return normalized;
}

function isMediaResponse(url: string, responseHeaders?: Record<string, string[]>): boolean {
  const normalizedUrl = url.toLowerCase();
  if (/\.(m3u8|mpd)(?:$|[?#])/.test(normalizedUrl)) {
    return true;
  }
  const contentType = Object.entries(responseHeaders ?? {})
    .find(([name]) => name.toLowerCase() === 'content-type')?.[1]?.join(';').toLowerCase() ?? '';
  return contentType.includes('mpegurl')
    || contentType.includes('application/dash+xml')
    || contentType.includes('application/vnd.apple.mpegurl');
}

function parseImportedMedia(filePath: string): ImportedMedia[] {
  const payload = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const movie = root.movie && typeof root.movie === 'object' ? root.movie as Record<string, unknown> : {};
  const movieName = typeof movie.name === 'string' ? movie.name : '';
  const candidates: unknown[] = Array.isArray(payload)
    ? payload
    : Array.isArray(root.items)
      ? root.items
      : Array.isArray(root.episodes)
        ? root.episodes.flatMap((episode) => {
          if (!episode || typeof episode !== 'object') return [];
          const items = (episode as Record<string, unknown>).items;
          return Array.isArray(items) ? items : [];
        })
        : [];

  const result: ImportedMedia[] = [];
  for (const [index, value] of candidates.entries()) {
    if (!value || typeof value !== 'object') continue;
    const item = value as Record<string, unknown>;
    const rawUrl = [item.url, item.m3u8, item.webpage_url].find((candidate) => typeof candidate === 'string');
    if (typeof rawUrl !== 'string') continue;
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      continue;
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) continue;
    const itemName = typeof item.name === 'string' ? item.name : `Item ${index + 1}`;
    result.push({ name: movieName ? `${movieName} — ${itemName}` : itemName, url: parsed.toString() });
  }
  if (result.length === 0) throw new Error('The JSON file does not contain any supported media URLs.');
  return result;
}

function openHuntingWindow(targetUrl: string): void {
  if (huntingWindow && !huntingWindow.isDestroyed()) {
    huntingWindow.focus();
    void huntingWindow.loadURL(targetUrl);
    return;
  }

  const partition = `hunt-${Date.now()}`;
  const huntingSession = session.fromPartition(partition, { cache: false });
  const requestHeaders = new Map<number, Record<string, string>>();
  const capturedUrls = new Set<string>();

  huntingSession.webRequest.onBeforeSendHeaders({ urls: ['*://*/*'] }, (details, callback) => {
    requestHeaders.set(details.id, normalizeRequestHeaders(details.requestHeaders));
    callback({ requestHeaders: details.requestHeaders });
  });
  huntingSession.webRequest.onCompleted({ urls: ['*://*/*'] }, (details) => requestHeaders.delete(details.id));
  huntingSession.webRequest.onErrorOccurred({ urls: ['*://*/*'] }, (details) => requestHeaders.delete(details.id));
  huntingSession.webRequest.onHeadersReceived({ urls: ['*://*/*'] }, (details, callback) => {
    callback({});
    if (!isMediaResponse(details.url, details.responseHeaders) || capturedUrls.has(details.url)) {
      return;
    }
    capturedUrls.add(details.url);
    const headers = requestHeaders.get(details.id) ?? {};
    const referer = details.referrer || headers.Referer || headers.referer;
    const capture: CapturedMedia = { url: details.url, referer, requestHeaders: headers };
    publishCapture(capture);
    setTimeout(() => {
      if (huntingWindow && !huntingWindow.isDestroyed()) huntingWindow.close();
    }, 450);
  });

  huntingWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 500,
    title: 'Video Hunter',
    backgroundColor: '#10151d',
    autoHideMenuBar: true,
    webPreferences: {
      session: huntingSession,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  huntingWindow.on('closed', () => {
    requestHeaders.clear();
    capturedUrls.clear();
    void huntingSession.clearStorageData();
    void huntingSession.clearCache();
    huntingWindow = null;
    mainWindow?.webContents.send('hunt:closed');
  });
  void huntingWindow.loadURL(targetUrl);
}

function installIpcHandlers(): void {
  ipcMain.handle('folder:choose', async () => {
    const options: Electron.OpenDialogOptions = {
      title: 'Choose download folder',
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle('import:list', async () => {
    const options: Electron.OpenDialogOptions = {
      title: 'Import a media list',
      properties: ['openFile'],
      filters: [{ name: 'JSON files', extensions: ['json'] }],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return [];
    return parseImportedMedia(result.filePaths[0]);
  });
  ipcMain.handle('clipboard:read', () => clipboard.readText());
  ipcMain.handle('clipboard:write', (_event, value: string) => clipboard.writeText(value));
  ipcMain.handle('hunt:open', (_event, rawUrl: string) => {
    const value = rawUrl?.trim() || 'https://www.google.com';
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Unsupported URL protocol.');
    openHuntingWindow(parsed.toString());
  });
  ipcMain.handle('download:start', (_event, request: EnqueueDownloadRequest) => downloadQueue.enqueue(request));
  ipcMain.handle('download:list', () => downloadQueue.list());
  ipcMain.handle('download:cancel', (_event, id: string) => downloadQueue.cancel(id));
  ipcMain.handle('download:remove', (_event, id: string) => downloadQueue.remove(id));
  ipcMain.handle('download:retry', (_event, id: string) => downloadQueue.retry(id));
  ipcMain.handle('library:list', () => library.list());
  ipcMain.handle('media:play', async (_event, localPath: string) => {
    await player.play(localPath);
    library.markPlayed(localPath);
    publishLibrary();
  });
  ipcMain.handle('media:show', (_event, localPath: string) => shell.showItemInFolder(localPath));
  ipcMain.handle('tools:status', () => {
    const status = { ...downloader.toolStatus(), mpv: player.path() };
    if (!status.ytDlp || !status.ffmpeg) {
      logs.write('ERROR', `Missing components: yt-dlp=${status.ytDlp ?? 'not found'}, ffmpeg=${status.ffmpeg ?? 'not found'}`);
    }
    if (!status.deno) logs.write('WARN', 'Deno was not found; some YouTube formats may be unavailable.');
    return status;
  });
  ipcMain.handle('logs:open', () => shell.openPath(logs.getDirectory()));
  ipcMain.handle('runtime:info', () => ({
    platform: process.platform,
    arch: process.arch,
    sessionType: process.env.XDG_SESSION_TYPE ?? null,
    waylandDisplay: process.env.WAYLAND_DISPLAY ?? null,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  }));
}

app.whenReady().then(() => {
  logs = new LogStore(app.getPath('userData'));
  logs.write('INFO', `Starting Electron ${process.versions.electron}; session=${process.env.XDG_SESSION_TYPE ?? 'unknown'}`);
  downloader = new Downloader(
    projectRoot,
    process.resourcesPath,
    (event) => downloadQueue.handleEngineEvent(event),
    (level, message) => {
      logs.write(level, message);
      mainWindow?.webContents.send('diagnostic:line', { level, message });
    },
  );
  library = new LibraryRepository(app.getPath('userData'));
  player = new PlayerService(projectRoot, process.resourcesPath);
  downloadQueue = new DownloadQueue(
    downloader,
    publishQueue,
    (task) => {
      library.recordDownload(task);
      publishLibrary();
    },
  );
  companion = new CompanionServer(
    publishCapture,
    (level, message) => logs.write(level, message),
    {
      listDownloads: () => downloadQueue.list(),
      enqueueDownload: (request) => downloadQueue.enqueue(request),
      cancelDownload: (id) => downloadQueue.cancel(id),
      retryDownload: (id) => downloadQueue.retry(id),
      listLibrary: () => library.list(2_000),
      playLibraryItem: async (id) => {
        const item = library.list(2_000).find((candidate) => candidate.id === id);
        if (!item) throw new Error(`Library item ${id} was not found.`);
        await player.play(item.localPath);
        library.markPlayed(item.localPath);
        publishLibrary();
      },
      defaultDownloadPath: () => app.getPath('downloads'),
    },
  );
  companion.start();
  installIpcHandlers();
  createMainWindow();
  if (hunterSmokeOutput) runHunterSmokeFixture();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  companion?.close();
  library?.close();
});
