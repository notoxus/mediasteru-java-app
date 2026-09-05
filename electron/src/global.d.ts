import {
  CapturedMedia,
  DownloadTask,
  EnqueueDownloadRequest,
  ImportedMedia,
  LibraryItem,
  ToolStatus,
} from './types';

declare global {
  interface Window {
    mediaSteru: {
      chooseFolder(): Promise<string | null>;
      importList(): Promise<ImportedMedia[]>;
      readClipboard(): Promise<string>;
      writeClipboard(value: string): Promise<void>;
      openHunter(url: string): Promise<void>;
      startDownload(request: EnqueueDownloadRequest): Promise<DownloadTask>;
      listDownloads(): Promise<DownloadTask[]>;
      cancelDownload(id: string): Promise<boolean>;
      removeDownload(id: string): Promise<boolean>;
      retryDownload(id: string): Promise<boolean>;
      listLibrary(): Promise<LibraryItem[]>;
      playMedia(localPath: string): Promise<void>;
      showMedia(localPath: string): Promise<void>;
      toolStatus(): Promise<ToolStatus>;
      openLogs(): Promise<string>;
      runtimeInfo(): Promise<Record<string, string | null>>;
      onCaptured(callback: (capture: CapturedMedia) => void): () => void;
      onHunterClosed(callback: () => void): () => void;
      onQueueChanged(callback: (tasks: DownloadTask[]) => void): () => void;
      onLibraryChanged(callback: (items: LibraryItem[]) => void): () => void;
      onDiagnostic(callback: (line: { level: string; message: string }) => void): () => void;
    };
  }
}

export {};
