import {
  CapturedMedia,
  DownloadTask,
  DownloadTaskOptions,
  EnqueueDownloadRequest,
  HunterNavigationState,
  ImportedMedia,
  LibraryItem,
  PlaybackCommand,
  PlaybackState,
  ToolStatus,
} from './types';

declare global {
  interface Window {
    hunterNavigation: {
      getState(): Promise<HunterNavigationState>;
      navigate(url: string): Promise<void>;
      back(): Promise<void>;
      forward(): Promise<void>;
      reload(): Promise<void>;
      setHuntingMode(enabled: boolean): Promise<HunterNavigationState>;
      onStateChanged(callback: (state: HunterNavigationState) => void): () => void;
    };
    mediaSteru: {
      chooseFolder(): Promise<string | null>;
      importList(): Promise<ImportedMedia[]>;
      readClipboard(): Promise<string>;
      writeClipboard(value: string): Promise<void>;
      openHunter(url: string): Promise<void>;
      startDownload(request: EnqueueDownloadRequest): Promise<DownloadTask>;
      startSelectedDownloads(ids: string[]): Promise<number>;
      updateDownloadOptions(id: string, options: DownloadTaskOptions): Promise<DownloadTask | null>;
      listDownloads(): Promise<DownloadTask[]>;
      cancelDownload(id: string): Promise<boolean>;
      pauseDownload(id: string): Promise<boolean>;
      resumeDownload(id: string): Promise<boolean>;
      removeDownload(id: string): Promise<boolean>;
      retryDownload(id: string): Promise<boolean>;
      listLibrary(): Promise<LibraryItem[]>;
      playMedia(localPath: string): Promise<void>;
      playerState(): Promise<PlaybackState>;
      controlPlayer(command: PlaybackCommand): Promise<PlaybackState>;
      showMedia(localPath: string): Promise<void>;
      toolStatus(): Promise<ToolStatus>;
      showNotice(message: string, kind: 'warning' | 'error'): Promise<void>;
      runtimeInfo(): Promise<Record<string, string | null>>;
      onCaptured(callback: (capture: CapturedMedia) => void): () => void;
      onHunterClosed(callback: () => void): () => void;
      onQueueChanged(callback: (tasks: DownloadTask[]) => void): () => void;
      onLibraryChanged(callback: (items: LibraryItem[]) => void): () => void;
      onPlayerChanged(callback: (state: PlaybackState) => void): () => void;
      onDiagnostic(callback: (line: { level: string; message: string }) => void): () => void;
    };
  }
}

export {};
