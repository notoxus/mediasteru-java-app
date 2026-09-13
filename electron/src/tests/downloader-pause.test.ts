import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Downloader } from '../downloader';
import { DownloadEvent, DownloadRequest } from '../types';

test('Downloader pauses an active process and preserves its progress checkpoint', {
  skip: process.platform === 'win32' ? 'The fake executable fixture uses a POSIX shell.' : false,
}, async () => {
  const root = mkdtempSync(join(tmpdir(), 'mediasteru-pause-'));
  const tools = join(root, 'tools');
  const output = join(root, 'output');
  mkdirSync(tools, { recursive: true });

  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const ytDlpName = process.platform === 'darwin' ? 'yt-dlp-macos' : `yt-dlp-linux-${arch}`;
  const ffmpegName = process.platform === 'darwin' ? `ffmpeg-macos-${arch}` : `ffmpeg-linux-${arch}`;
  const fixture = '#!/bin/sh\ntrap "exit 143" TERM INT\nprintf "__VD_PROGRESS__|37.5%%|3 MiB/s|10\\n"\nwhile :; do sleep 1; done\n';
  for (const name of [ytDlpName, ffmpegName]) {
    const path = join(tools, name);
    writeFileSync(path, fixture);
    chmodSync(path, 0o755);
  }

  const events: DownloadEvent[] = [];
  let downloader: Downloader;
  let pauseRequested = false;
  const paused = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Pause event timed out.')), 5_000);
    downloader = new Downloader(root, root, (event) => {
      events.push(event);
      if (event.type === 'progress' && !pauseRequested) {
        pauseRequested = true;
        assert.equal(downloader.pause(event.id), true);
      }
      if (event.type === 'paused') {
        clearTimeout(timeout);
        resolve();
      }
    }, () => {});
  });

  const request: DownloadRequest = {
    id: 'pause-fixture',
    url: 'https://example.com/video',
    savePath: output,
    format: 'mkv',
    quality: '1080',
  };

  try {
    downloader!.start(request);
    await paused;
    assert.equal(events.some((event) => event.type === 'canceled'), false);
    assert.equal(events.find((event) => event.type === 'progress')?.percent, 37.5);
  } finally {
    downloader!.cancel(request.id);
    rmSync(root, { recursive: true, force: true });
  }
});
