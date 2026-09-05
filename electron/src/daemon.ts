import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { CompanionServer } from './core/companion-server';
import { DownloadQueue } from './core/download-queue';
import { LibraryRepository } from './core/library-repository';
import { PlayerService } from './core/player-service';
import { Downloader } from './downloader';
import { LogStore } from './log-store';
import { CapturedMedia, DownloadFormat, DownloadQuality, DownloadTask } from './types';

const projectRoot = resolve(process.env.MEDIASTERU_PROJECT_ROOT || resolve(__dirname, '..', '..'));
const dataDirectory = resolve(process.env.MEDIASTERU_DATA_DIR || resolve(projectRoot, '.mediasteru-data'));
const downloadDirectory = resolve(process.env.MEDIASTERU_DOWNLOAD_DIR || resolve(projectRoot, 'downloads'));
const port = Number.parseInt(process.env.MEDIASTERU_PORT || '8765', 10);
const defaultFormat = mediaFormat(process.env.MEDIASTERU_DEFAULT_FORMAT);
const defaultQuality = mediaQuality(process.env.MEDIASTERU_DEFAULT_QUALITY);

mkdirSync(dataDirectory, { recursive: true });
mkdirSync(downloadDirectory, { recursive: true });

const logs = new LogStore(dataDirectory);
const log = (level: 'INFO' | 'WARN' | 'ERROR', message: string): void => {
  logs.write(level, message);
  process.stdout.write(`${new Date().toISOString()} ${level.padEnd(5)} ${message}\n`);
};
let companion: CompanionServer;
let queue: DownloadQueue;
const library = new LibraryRepository(dataDirectory);
const player = new PlayerService(projectRoot, projectRoot);
const downloader = new Downloader(
  projectRoot,
  projectRoot,
  (event) => queue.handleEngineEvent(event),
  log,
);
queue = new DownloadQueue(
  downloader,
  (downloads) => companion?.publish('downloads', { downloads }),
  (task) => {
    library.recordDownload(task);
    companion?.publish('library', { items: library.list() });
  },
);

function enqueueCapture(capture: CapturedMedia): DownloadTask {
  return queue.enqueue({
    id: randomUUID(),
    url: capture.url,
    savePath: downloadDirectory,
    format: defaultFormat,
    quality: defaultQuality,
    referer: capture.referer,
    requestHeaders: capture.requestHeaders,
    name: labelForUrl(capture.url),
  });
}

companion = new CompanionServer(
  (capture) => {
    const task = enqueueCapture(capture);
    log('INFO', `Queued companion capture ${task.id}: ${task.url}`);
  },
  log,
  {
    listDownloads: () => queue.list(),
    enqueueDownload: (request) => queue.enqueue(request),
    cancelDownload: (id) => queue.cancel(id),
    retryDownload: (id) => queue.retry(id),
    listLibrary: () => library.list(2_000),
    playLibraryItem: async (id) => {
      const item = library.list(2_000).find((candidate) => candidate.id === id);
      if (!item) throw new Error(`Library item ${id} was not found.`);
      await player.play(item.localPath);
      library.markPlayed(item.localPath);
      companion.publish('library', { items: library.list() });
    },
    defaultDownloadPath: () => downloadDirectory,
  },
  Number.isFinite(port) ? port : 8765,
);

companion.start();
log('INFO', `Headless core ready; downloads=${downloadDirectory}; data=${dataDirectory}`);

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log('INFO', `Stopping headless core (${signal})`);
  companion.close();
  library.close();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (error) => {
  log('ERROR', error.stack || error.message);
  companion?.close();
  library.close();
  process.exit(1);
});
process.on('unhandledRejection', (error) => {
  log('ERROR', error instanceof Error ? error.stack || error.message : String(error));
});

function labelForUrl(value: string): string {
  const url = new URL(value);
  const tail = url.pathname.split('/').filter(Boolean).pop();
  return tail ? `${url.hostname} · ${decodeURIComponent(tail).slice(0, 58)}` : url.hostname;
}

function mediaFormat(value?: string): DownloadFormat {
  return value === 'mkv' || value === 'mp3' ? value : 'mp4';
}

function mediaQuality(value?: string): DownloadQuality {
  return value === '720' || value === '1440' || value === '2160' || value === 'best'
    ? value
    : '1080';
}
