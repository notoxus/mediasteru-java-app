import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Downloader } from '../downloader';
import { DownloadEvent } from '../types';

test('Downloader uses Hunter response body without requesting the long manifest URL again', {
  skip: process.platform !== 'linux',
}, async () => {
  const root = mkdtempSync(join(tmpdir(), 'mediasteru-downloader-test-'));
  const tools = join(root, 'tools');
  const downloads = join(root, 'downloads');
  const trace = join(root, 'yt-dlp-trace.json');
  mkdirSync(tools);
  mkdirSync(downloads);

  const ffmpegName = process.arch === 'arm64' ? 'ffmpeg-linux-arm64' : 'ffmpeg-linux-x64';
  const ytDlpName = process.arch === 'arm64' ? 'yt-dlp-linux-arm64' : 'yt-dlp-linux-x64';
  const fakeFfmpeg = join(tools, ffmpegName);
  const fakeYtDlp = join(tools, ytDlpName);
  writeFileSync(fakeFfmpeg, '#!/usr/bin/env node\nprocess.exit(91);\n', 'utf8');
  writeFileSync(fakeYtDlp, `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const input = args.at(-1);
(async () => {
  const manifest = await (await fetch(input)).text();
  const template = args[args.indexOf('-o') + 1];
  const output = template.replace('%(title)s', 'captured').replace('%(ext)s', 'mkv');
  fs.writeFileSync(${JSON.stringify(trace)}, JSON.stringify({args, input, manifest}));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, 'downloaded');
  console.log('__VD_FILE__' + output);
})().catch((error) => { console.error(error); process.exit(1); });
`, 'utf8');
  chmodSync(fakeFfmpeg, 0o755);
  chmodSync(fakeYtDlp, 0o755);

  try {
    const completed = new Promise<DownloadEvent>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Downloader test timed out.')), 3_000);
      const downloader = new Downloader(root, root, (event) => {
        if (event.type === 'error') {
          clearTimeout(timeout);
          reject(new Error(event.message));
        }
        if (event.type === 'complete') {
          clearTimeout(timeout);
          resolve(event);
        }
      }, () => undefined);
      downloader.start({
        id: 'hunter-manifest-test',
        url: 'https://embed.example/a-very-long-token-that-must-not-be-requested',
        savePath: downloads,
        format: 'mkv',
        quality: '1080',
        referer: 'https://movies.example/watch/1',
        requestHeaders: { Cookie: 'session=test', ':authority': 'embed.example', ':method': 'GET' },
        manifestBody: '#EXTM3U\n#EXTINF:4,\nsegments/movie-1.ts\n#EXT-X-ENDLIST\n',
      });
    });
    const event = await completed;
    assert.ok(event.outputPath);
    const invocation = JSON.parse(readFileSync(trace, 'utf8')) as {
      args: string[];
      input: string;
      manifest: string;
    };
    assert.match(invocation.input, /^http:\/\/127\.0\.0\.1:\d+\/captured\.m3u8$/);
    assert.notEqual(invocation.input, 'https://embed.example/a-very-long-token-that-must-not-be-requested');
    assert.equal(invocation.args.some((argument) => argument.includes(':authority')), false);
    assert.match(invocation.manifest, /https:\/\/embed\.example\/segments\/movie-1\.ts/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
