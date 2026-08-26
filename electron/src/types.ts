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
  type: 'started' | 'progress' | 'log' | 'complete' | 'error' | 'canceled';
  percent?: number;
  speed?: string;
  message?: string;
  savedPath?: string;
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
}
