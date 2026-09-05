import { DatabaseSync } from 'node:sqlite';
import { basename, extname, join } from 'node:path';
import { DownloadTask, LibraryItem } from '../types';

interface LibraryRow {
  id: number;
  source_url: string;
  title: string;
  local_path: string;
  format: string;
  resolution: string | null;
  downloaded_at: string;
  last_played_at: string | null;
  playback_position: number;
}

export class LibraryRepository {
  private readonly database: DatabaseSync;

  constructor(userDataPath: string) {
    this.database = new DatabaseSync(join(userDataPath, 'library.db'));
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS media (
        id INTEGER PRIMARY KEY,
        source_url TEXT NOT NULL,
        title TEXT NOT NULL,
        local_path TEXT NOT NULL UNIQUE,
        format TEXT NOT NULL,
        resolution TEXT,
        downloaded_at TEXT NOT NULL,
        last_played_at TEXT,
        playback_position REAL NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS media_downloaded_at_idx
        ON media(downloaded_at DESC);
    `);
  }

  recordDownload(task: DownloadTask): void {
    if (!task.outputPath) return;
    const fileName = basename(task.outputPath, extname(task.outputPath));
    const title = fileName || task.name || task.url;
    const resolution = task.format === 'mp3' || task.quality === 'best' ? null : `${task.quality}p`;
    this.database.prepare(`
      INSERT INTO media (source_url, title, local_path, format, resolution, downloaded_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(local_path) DO UPDATE SET
        source_url = excluded.source_url,
        title = excluded.title,
        format = excluded.format,
        resolution = excluded.resolution,
        downloaded_at = excluded.downloaded_at
    `).run(task.url, title, task.outputPath, task.format, resolution, task.updatedAt);
  }

  list(limit = 500): LibraryItem[] {
    const safeLimit = Math.max(1, Math.min(limit, 2_000));
    const rows = this.database.prepare(`
      SELECT id, source_url, title, local_path, format, resolution,
             downloaded_at, last_played_at, playback_position
      FROM media
      ORDER BY downloaded_at DESC
      LIMIT ?
    `).all(safeLimit) as unknown as LibraryRow[];
    return rows.map((row) => ({
      id: row.id,
      sourceUrl: row.source_url,
      title: row.title,
      localPath: row.local_path,
      format: row.format as LibraryItem['format'],
      resolution: row.resolution,
      downloadedAt: row.downloaded_at,
      lastPlayedAt: row.last_played_at,
      playbackPosition: row.playback_position,
    }));
  }

  markPlayed(localPath: string): void {
    this.database.prepare(`
      UPDATE media SET last_played_at = ? WHERE local_path = ?
    `).run(new Date().toISOString(), localPath);
  }

  close(): void {
    this.database.close();
  }
}
