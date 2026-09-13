export type DownloadFormat = 'mp4' | 'mkv' | 'mp3';
export type DownloadQuality = '360' | '720' | '1080' | '1440' | '2160' | 'best';

export interface DownloadRequest {
  id: string;
  url: string;
  savePath: string;
  format: DownloadFormat;
  quality: DownloadQuality;
  referer?: string;
  requestHeaders?: Record<string, string>;
  /** HLS response captured inside Hunter's authenticated Chromium session. */
  manifestBody?: string;
}

export interface DownloadEvent {
  id: string;
  type: 'started' | 'progress' | 'processing' | 'log' | 'complete' | 'error' | 'canceled' | 'paused';
  percent?: number;
  speed?: string;
  message?: string;
  savedPath?: string;
  outputPath?: string;
}

export type DownloadTaskStatus =
  | 'waiting'
  | 'queued'
  | 'preparing'
  | 'downloading'
  | 'processing'
  | 'pausing'
  | 'paused'
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
  title?: string;
  referer?: string;
  requestHeaders: Record<string, string>;
  manifestBody?: string;
  format?: DownloadFormat;
  quality?: DownloadQuality;
}

/** Options that can be adjusted while a captured item is still in review. */
export interface DownloadTaskOptions {
  format: DownloadFormat;
  quality: DownloadQuality;
}

export interface HunterNavigationState {
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  hunting: boolean;
  candidateCount: number;
  downloadReady: boolean;
  error?: string;
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

export type PlaybackStatus = 'idle' | 'playing' | 'paused';
export type PlaybackCommand = 'toggle' | 'next' | 'previous' | 'stop';

export interface PlaybackQueueItem {
  id: number;
  title: string;
  localPath: string;
  format: DownloadFormat;
}

export interface PlaybackState {
  status: PlaybackStatus;
  itemId: number | null;
  title: string | null;
  localPath: string | null;
  mediaKind: 'audio' | 'video' | null;
  position: number;
  duration: number;
  volume: number;
  queueIndex: number;
  queueLength: number;
}

export interface ImportedMedia {
  name: string;
  url: string;
}
