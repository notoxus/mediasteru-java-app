export type DownloadFormat = 'mp4' | 'mkv' | 'mp3';
export type DownloadQuality = '720' | '1080' | '1440' | '2160' | 'best';

export interface DownloadRequest {
  id: string;
  url: string;
  savePath: string;
  format: DownloadFormat;
  quality: DownloadQuality;
  referer?: string;
  requestHeaders?: Record<string, string>;
}

export interface DownloadEvent {
  id: string;
  type: 'started' | 'progress' | 'processing' | 'log' | 'complete' | 'error' | 'canceled';
  percent?: number;
  speed?: string;
  message?: string;
  savedPath?: string;
  outputPath?: string;
}

export type DownloadTaskStatus =
  | 'queued'
  | 'preparing'
  | 'downloading'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'canceled';

export interface EnqueueDownloadRequest extends DownloadRequest {
  name: string;
}

export interface DownloadTask extends EnqueueDownloadRequest {
  status: DownloadTaskStatus;
  percent: number;
  speed: string;
  error?: string;
  outputPath?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CapturedMedia {
  url: string;
  referer?: string;
  requestHeaders: Record<string, string>;
}

export interface ToolStatus {
  ytDlp: string | null;
  ffmpeg: string | null;
  deno: string | null;
  mpv: string | null;
}

export interface LibraryItem {
  id: number;
  sourceUrl: string;
  title: string;
  localPath: string;
  format: DownloadFormat;
  resolution: string | null;
  downloadedAt: string;
  lastPlayedAt: string | null;
  playbackPosition: number;
}

export interface ImportedMedia {
  name: string;
  url: string;
}
