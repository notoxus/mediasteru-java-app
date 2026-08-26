import { contextBridge, ipcRenderer } from 'electron';
import { CapturedMedia, DownloadEvent, DownloadRequest, ToolStatus } from './types';

contextBridge.exposeInMainWorld('videoDownloader', {
  chooseFolder: (): Promise<string | null> => ipcRenderer.invoke('folder:choose'),
  readClipboard: (): Promise<string> => ipcRenderer.invoke('clipboard:read'),
  writeClipboard: (value: string): Promise<void> => ipcRenderer.invoke('clipboard:write', value),
  openHunter: (url: string): Promise<void> => ipcRenderer.invoke('hunt:open', url),
  startDownload: (request: DownloadRequest): Promise<void> => ipcRenderer.invoke('download:start', request),
  cancelDownload: (id: string): Promise<boolean> => ipcRenderer.invoke('download:cancel', id),
  toolStatus: (): Promise<ToolStatus> => ipcRenderer.invoke('tools:status'),
  openLogs: (): Promise<string> => ipcRenderer.invoke('logs:open'),
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
  onDownloadEvent: (callback: (event: DownloadEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, downloadEvent: DownloadEvent): void => callback(downloadEvent);
    ipcRenderer.on('download:event', handler);
    return () => ipcRenderer.removeListener('download:event', handler);
  },
  onDiagnostic: (callback: (line: { level: string; message: string }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, line: { level: string; message: string }): void => callback(line);
    ipcRenderer.on('diagnostic:line', handler);
    return () => ipcRenderer.removeListener('diagnostic:line', handler);
  },
});
