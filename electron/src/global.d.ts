import { CapturedMedia, DownloadEvent, DownloadRequest, ToolStatus } from './types';

declare global {
  interface Window {
    videoDownloader: {
      chooseFolder(): Promise<string | null>;
      readClipboard(): Promise<string>;
      writeClipboard(value: string): Promise<void>;
      openHunter(url: string): Promise<void>;
      startDownload(request: DownloadRequest): Promise<void>;
      cancelDownload(id: string): Promise<boolean>;
      toolStatus(): Promise<ToolStatus>;
      openLogs(): Promise<string>;
      runtimeInfo(): Promise<Record<string, string | null>>;
      onCaptured(callback: (capture: CapturedMedia) => void): () => void;
      onHunterClosed(callback: () => void): () => void;
      onDownloadEvent(callback: (event: DownloadEvent) => void): () => void;
      onDiagnostic(callback: (line: { level: string; message: string }) => void): () => void;
    };
  }
}

export {};
