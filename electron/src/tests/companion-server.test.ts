import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { CompanionServer, ControlApi } from '../core/companion-server';
import { DownloadTask, EnqueueDownloadRequest, LibraryItem } from '../types';

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForServer(url: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The listen callback may not have fired yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Companion server did not start in time.');
}

test('v1 control API queues and exposes Electron-owned downloads', async () => {
  const port = await reservePort();
  const downloads: DownloadTask[] = [];
  const library: LibraryItem[] = [];
  let playedId: number | null = null;
  const control: ControlApi = {
    listDownloads: () => downloads,
    enqueueDownload: (request: EnqueueDownloadRequest) => {
      const task: DownloadTask = {
        ...request,
        status: 'queued',
        percent: 0,
        speed: 'N/A',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      downloads.push(task);
      return task;
    },
    cancelDownload: () => false,
    retryDownload: () => false,
    listLibrary: () => library,
    playLibraryItem: async (id: number) => { playedId = id; },
    defaultDownloadPath: () => '/tmp/downloads',
  };
  const server = new CompanionServer(() => undefined, () => undefined, control, port);
  server.start();
  try {
    await waitForServer(`http://127.0.0.1:${port}/v1/status`);
    const queued = await fetch(`http://127.0.0.1:${port}/v1/downloads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/video', format: 'mkv', quality: '720' }),
    });
    assert.equal(queued.status, 202);
    const queuedBody = await queued.json() as { download: DownloadTask };
    assert.equal(queuedBody.download.savePath, '/tmp/downloads');
    assert.equal(queuedBody.download.format, 'mkv');

    const listed = await fetch(`http://127.0.0.1:${port}/v1/downloads`);
    const listedBody = await listed.json() as { downloads: DownloadTask[] };
    assert.equal(listedBody.downloads.length, 1);
    assert.equal(listedBody.downloads[0].url, 'https://example.com/video');

    library.push({
      id: 7,
      sourceUrl: 'https://example.com/video',
      title: 'Example',
      localPath: '/tmp/downloads/example.mkv',
      format: 'mkv',
      resolution: '720p',
      downloadedAt: new Date().toISOString(),
      lastPlayedAt: null,
      playbackPosition: 0,
    });
    const played = await fetch(`http://127.0.0.1:${port}/v1/library/7/play`, { method: 'POST' });
    assert.equal(played.status, 202);
    assert.equal(playedId, 7);
  } finally {
    server.close();
  }
});
