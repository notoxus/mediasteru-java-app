import { contextBridge, ipcRenderer } from 'electron';
import {
  CapturedMedia,
  DownloadTask,
  DownloadTaskOptions,
  EnqueueDownloadRequest,
  ImportedMedia,
  LibraryItem,
  PlaybackCommand,
  PlaybackState,
  ToolStatus,
} from './types';

contextBridge.exposeInMainWorld('mediaSteru', {
  chooseFolder: (): Promise<string | null> => ipcRenderer.invoke('folder:choose'),
  importList: (): Promise<ImportedMedia[]> => ipcRenderer.invoke('import:list'),
  readClipboard: (): Promise<string> => ipcRenderer.invoke('clipboard:read'),
  writeClipboard: (value: string): Promise<void> => ipcRenderer.invoke('clipboard:write', value),
  openHunter: (url: string): Promise<void> => ipcRenderer.invoke('hunt:open', url),
  startDownload: (request: EnqueueDownloadRequest): Promise<DownloadTask> => ipcRenderer.invoke('download:start', request),
  startSelectedDownloads: (ids: string[]): Promise<number> => ipcRenderer.invoke('download:start-selected', ids),
  updateDownloadOptions: (id: string, options: DownloadTaskOptions): Promise<DownloadTask | null> => ipcRenderer.invoke('download:update-options', id, options),
  listDownloads: (): Promise<DownloadTask[]> => ipcRenderer.invoke('download:list'),
  cancelDownload: (id: string): Promise<boolean> => ipcRenderer.invoke('download:cancel', id),
  pauseDownload: (id: string): Promise<boolean> => ipcRenderer.invoke('download:pause', id),
  resumeDownload: (id: string): Promise<boolean> => ipcRenderer.invoke('download:resume', id),
  removeDownload: (id: string): Promise<boolean> => ipcRenderer.invoke('download:remove', id),
  retryDownload: (id: string): Promise<boolean> => ipcRenderer.invoke('download:retry', id),
  listLibrary: (): Promise<LibraryItem[]> => ipcRenderer.invoke('library:list'),
  playMedia: (localPath: string): Promise<void> => ipcRenderer.invoke('media:play', localPath),
  playerState: (): Promise<PlaybackState> => ipcRenderer.invoke('player:state'),
  controlPlayer: (command: PlaybackCommand): Promise<PlaybackState> => ipcRenderer.invoke('player:command', command),
  showMedia: (localPath: string): Promise<void> => ipcRenderer.invoke('media:show', localPath),
  toolStatus: (): Promise<ToolStatus> => ipcRenderer.invoke('tools:status'),
  showNotice: (message: string, kind: 'warning' | 'error'): Promise<void> => ipcRenderer.invoke('dialog:notice', message, kind),
  runtimeInfo: (): Promise<Record<string, string | null>> => ipcRenderer.invoke('runtime:info'),
  onCaptured: (callback: (capture: CapturedMedia) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, capture: CapturedMedia): void => callback(capture);
    ipcRenderer.on('hunt:captured', handler);
    return () => ipcRenderer.removeListener('hunt:captured', handler);
  },
  onHunterClosed: (callback: () => void): (() => void) => {
    const handler = (): void => callback();
    ipcRenderer.on('hunt:closed', handler);
    return () => ipcRenderer.removeListener('hunt:closed', handler);
  },
  onQueueChanged: (callback: (tasks: DownloadTask[]) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, tasks: DownloadTask[]): void => callback(tasks);
    ipcRenderer.on('queue:changed', handler);
    return () => ipcRenderer.removeListener('queue:changed', handler);
  },
  onLibraryChanged: (callback: (items: LibraryItem[]) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, items: LibraryItem[]): void => callback(items);
    ipcRenderer.on('library:changed', handler);
    return () => ipcRenderer.removeListener('library:changed', handler);
  },
  onPlayerChanged: (callback: (state: PlaybackState) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: PlaybackState): void => callback(state);
    ipcRenderer.on('player:changed', handler);
    return () => ipcRenderer.removeListener('player:changed', handler);
  },
  onDiagnostic: (callback: (line: { level: string; message: string }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, line: { level: string; message: string }): void => callback(line);
    ipcRenderer.on('diagnostic:line', handler);
    return () => ipcRenderer.removeListener('diagnostic:line', handler);
  },
});
