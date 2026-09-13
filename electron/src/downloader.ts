import { ChildProcessWithoutNullStreams, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { rewriteHlsManifest } from './hunter-manifest';
import { DownloadEvent, DownloadRequest, ToolStatus } from './types';

type EventSink = (event: DownloadEvent) => void;
type LogSink = (level: 'INFO' | 'WARN' | 'ERROR', message: string) => void;

interface ToolPaths {
  ytDlp: string;
  ffmpeg: string;
  deno: string | null;
}

export class Downloader {
  private readonly active = new Map<string, ChildProcessWithoutNullStreams>();
  private readonly canceled = new Set<string>();
  private readonly paused = new Set<string>();

  constructor(
    private readonly projectRoot: string,
    private readonly resourcesPath: string,
    private readonly emit: EventSink,
    private readonly log: LogSink,
  ) {}

  toolStatus(): ToolStatus {
    return { ...this.discoverTools(), mpv: null };
  }

  start(request: DownloadRequest): void {
    if (this.active.has(request.id)) {
      throw new Error('This download is already active.');
    }
    const parsed = new URL(request.url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Only HTTP and HTTPS URLs are supported.');
    }
    if (request.manifestBody && Buffer.byteLength(request.manifestBody, 'utf8') > 5 * 1024 * 1024) {
      throw new Error('The captured manifest is too large to process safely.');
    }
    mkdirSync(request.savePath, { recursive: true });
    void this.runDownload(request);
  }

  cancel(id: string): boolean {
    const child = this.active.get(id);
    if (!child) {
      return false;
    }
    this.paused.delete(id);
    this.canceled.add(id);
    this.terminateProcessTree(child);
    return true;
  }

  pause(id: string): boolean {
    const child = this.active.get(id);
    if (!child) return false;
    this.canceled.delete(id);
    this.paused.add(id);
    // Stopping at the current checkpoint is portable across Windows, macOS,
    // and Linux. yt-dlp resumes its .part file when the task is started again.
    this.terminateProcessTree(child);
    return true;
  }

  private async runDownload(request: DownloadRequest): Promise<void> {
    try {
      const tools = this.resolveTools(true)!;
      this.emit({ id: request.id, type: 'started', message: 'Preparing download…' });
      if (request.manifestBody) {
        // The one-shot manifest URL can be longer than what a non-browser
        // HTTP/1.1 server accepts. Give yt-dlp a local, immutable copy of the
        // manifest instead: it keeps yt-dlp's HLS parser and downloader while
        // never asking the token URL for a second time.
        let capturedOutput = await this.tryCapturedYtDlp(request, tools);
        if (capturedOutput && request.format === 'mp4') {
          capturedOutput = await this.convertToMp4(request, tools, capturedOutput);
        }
        capturedOutput ??= await this.tryDirectFfmpeg(request, tools);
        if (!capturedOutput) {
          throw new Error('The captured video stream could not be downloaded.');
        }
        if (this.canceled.has(request.id)) {
          this.emit({ id: request.id, type: 'canceled', message: 'Download canceled.' });
          return;
        }
        this.emit({ id: request.id, type: 'complete', savedPath: request.savePath, outputPath: capturedOutput });
        this.log('INFO', `Download completed from Hunter session: ${request.url}`);
        return;
      }
      const result = await this.runYtDlp(request, tools);
      let outputPath = result.outputPath;
      if (this.paused.has(request.id)) {
        this.emit({ id: request.id, type: 'paused', message: 'Download paused.' });
        return;
      }
      if (this.canceled.has(request.id)) {
        this.emit({ id: request.id, type: 'canceled', message: 'Download canceled.' });
        return;
      }
      if (result.exitCode !== 0) {
        const fallbackOutput = Boolean(request.referer)
          && await this.tryDirectFfmpeg(request, tools);
        if (!fallbackOutput) {
          throw new Error(result.lastError || `yt-dlp exited with code ${result.exitCode}`);
        }
        outputPath = fallbackOutput;
      } else if (request.format === 'mp4') {
        if (!outputPath) {
          throw new Error('Could not locate the downloaded MKV file.');
        }
        outputPath = await this.convertToMp4(request, tools, outputPath);
      }
      if (this.canceled.has(request.id)) {
        this.emit({ id: request.id, type: 'canceled', message: 'Download canceled.' });
        return;
      }
      if (!outputPath) throw new Error('Could not determine the downloaded file path.');
      this.emit({ id: request.id, type: 'complete', savedPath: request.savePath, outputPath });
      this.log('INFO', `Download completed: ${request.url}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.paused.has(request.id)) {
        this.emit({ id: request.id, type: 'paused', message: 'Download paused.' });
        this.log('INFO', `Download paused: ${request.url}`);
      } else if (this.canceled.has(request.id)) {
        this.emit({ id: request.id, type: 'canceled', message: 'Download canceled.' });
        this.log('INFO', `Download canceled: ${request.url}`);
      } else {
        this.emit({ id: request.id, type: 'error', message });
        this.log('ERROR', `Download failed for ${request.url}: ${message}`);
      }
    } finally {
      this.active.delete(request.id);
      this.canceled.delete(request.id);
      this.paused.delete(request.id);
    }
  }

  private runYtDlp(request: DownloadRequest, tools: ToolPaths): Promise<{
    exitCode: number;
    outputPath?: string;
    lastError?: string;
  }> {
    const args = [
      '--newline',
      '--progress',
      '--progress-delta', '0.25',
      '--progress-template', 'download:__VD_PROGRESS__|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s',
      '--extractor-args', 'generic:impersonate',
      '--ffmpeg-location', tools.ffmpeg,
      '--concurrent-fragments', '16',
      '--http-chunk-size', '10M',
      '--throttled-rate', '100K',
      '--fragment-retries', '10',
      '--retry-sleep', '3',
      '--add-header', `Referer: ${request.referer || request.url}`,
    ];
    if (request.referer || Object.keys(request.requestHeaders ?? {}).length > 0) {
      // Captured streams were authorized inside Chromium. Use yt-dlp's
      // curl_cffi transport so the follow-up request has a browser TLS
      // fingerprint instead of the default Python HTTP fingerprint.
      args.push('--impersonate', 'chrome');
    }
    if (tools.deno) args.push('--js-runtimes', `deno:${tools.deno}`);
    this.appendHeaders(args, request.requestHeaders);

    if (request.format === 'mp3') {
      args.push('-f', 'bestaudio/best', '-x', '--audio-format', 'mp3');
    } else if (request.format === 'mp4') {
      args.push(
        '-f', this.videoFormatSelector(request.quality),
        '--merge-output-format', 'mkv',
        '--remux-video', 'mkv',
      );
    } else {
      args.push('-f', this.videoFormatSelector(request.quality), '--remux-video', 'mkv');
    }
    args.push('--print', 'after_move:__VD_FILE__%(filepath)s');
    args.push('-o', join(request.savePath, '%(title)s.%(ext)s'), request.url);

    return new Promise((resolvePromise) => {
      const child = spawn(tools.ytDlp, args, {
        windowsHide: true,
        detached: process.platform !== 'win32',
      });
      this.active.set(request.id, child);
      let outputPath: string | undefined;
      let lastError = '';
      let stdoutBuffer = '';
      let stderrBuffer = '';

      const handleLine = (line: string, isError: boolean): void => {
        const clean = line.trim();
        if (!clean) return;
        const progressMarker = '__VD_PROGRESS__|';
        const markerIndex = clean.indexOf(progressMarker);
        if (markerIndex >= 0) {
          const [percentText = '0', speed = 'N/A'] = clean
            .slice(markerIndex + progressMarker.length)
            .split('|');
          const percent = Number(percentText.replace(/\x1b\[[0-9;]*m/g, '').replace('%', '').trim());
          this.emit({
            id: request.id,
            type: 'progress',
            percent: Number.isFinite(percent) ? percent : 0,
            speed: speed.trim() || 'N/A',
          });
          return;
        }

        this.log(isError ? 'WARN' : 'INFO', `[yt-dlp] ${clean}`);
        const standardProgress = clean.match(/\[download]\s+([\d.]+)%.*?\bat\s+(\S+)/i);
        if (standardProgress) {
          this.emit({
            id: request.id,
            type: 'progress',
            percent: Number(standardProgress[1]),
            speed: standardProgress[2] || 'N/A',
          });
        } else if (clean.startsWith('__VD_FILE__')) {
          const printedPath = clean.slice('__VD_FILE__'.length).trim();
          if (printedPath) outputPath = resolve(printedPath);
        } else if (/error|failed|forbidden/i.test(clean)) {
          lastError = clean;
          this.emit({ id: request.id, type: 'log', message: clean });
        }
      };

      const consume = (chunk: Buffer, stderr: boolean): void => {
        if (stderr) {
          stderrBuffer += chunk.toString('utf8');
          const lines = stderrBuffer.split(/\r?\n/);
          stderrBuffer = lines.pop() ?? '';
          lines.forEach((line) => handleLine(line, true));
        } else {
          stdoutBuffer += chunk.toString('utf8');
          const lines = stdoutBuffer.split(/\r?\n/);
          stdoutBuffer = lines.pop() ?? '';
          lines.forEach((line) => handleLine(line, false));
        }
      };

      child.stdout.on('data', (chunk: Buffer) => consume(chunk, false));
      child.stderr.on('data', (chunk: Buffer) => consume(chunk, true));
      child.on('error', (error) => resolvePromise({ exitCode: -1, lastError: error.message }));
      child.on('close', (code) => {
        handleLine(stdoutBuffer, false);
        handleLine(stderrBuffer, true);
        resolvePromise({ exitCode: code ?? -1, outputPath, lastError });
      });
    });
  }

  private async tryDirectFfmpeg(request: DownloadRequest, tools: ToolPaths): Promise<string | null> {
    this.emit({
      id: request.id,
      type: 'log',
      message: request.manifestBody
        ? 'Downloading the video stream captured inside Hunter…'
        : 'Trying the captured stream directly with FFmpeg…',
    });
    const extension = request.format === 'mp3' ? '.mp3' : '.mkv';
    const output = join(request.savePath, `captured-${Date.now()}${extension}`);
    const headers = this.ffmpegHeaders(request);
    let manifestServer: Server | null = null;
    let input = request.url;
    if (request.manifestBody) {
      const served = await this.serveManifest(rewriteHlsManifest(
        request.manifestBody,
        request.url,
        request.quality,
      ));
      manifestServer = served.server;
      input = served.url;
    }
    const args = ['-y'];
    args.push('-headers', headers, '-i', input);
    if (request.format === 'mp3') {
      args.push('-vn', '-c:a', 'libmp3lame');
    } else {
      args.push('-map', '0:v:0?', '-map', '0:a:0?', '-c', 'copy');
    }
    args.push(output);
    let exitCode: number;
    try {
      exitCode = await this.runFfmpeg(request.id, tools.ffmpeg, args);
    } finally {
      manifestServer?.close();
    }
    if (exitCode !== 0 || !existsSync(output)) {
      if (existsSync(output)) rmSync(output, { force: true });
      return null;
    }
    if (request.format === 'mp4') {
      return this.convertToMp4(request, tools, output);
    }
    return output;
  }

  private async tryCapturedYtDlp(request: DownloadRequest, tools: ToolPaths): Promise<string | null> {
    if (!request.manifestBody) return null;
    this.emit({
      id: request.id,
      type: 'log',
      message: 'Reading the captured video stream with yt-dlp…',
    });
    let manifestServer: Server | null = null;
    try {
      const served = await this.serveManifest(rewriteHlsManifest(
        request.manifestBody,
        request.url,
        request.quality,
      ));
      manifestServer = served.server;
      const result = await this.runYtDlp({
        ...request,
        url: served.url,
        // The local server already contains the snapshot. Without clearing
        // this, a future refactor could accidentally recurse into this path.
        manifestBody: undefined,
      }, tools);
      if (result.exitCode !== 0 || !result.outputPath || !existsSync(result.outputPath)) {
        this.log('WARN', `yt-dlp could not process Hunter's captured stream${result.lastError ? `: ${result.lastError}` : '.'}`);
        return null;
      }
      return result.outputPath;
    } finally {
      manifestServer?.close();
    }
  }

  private serveManifest(manifest: string): Promise<{ server: Server; url: string }> {
    return new Promise((resolvePromise, reject) => {
      const server = createServer((request, response) => {
        if (request.url !== '/captured.m3u8') {
          response.writeHead(404).end();
          return;
        }
        response.writeHead(200, {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-store',
        });
        response.end(manifest);
      });
      const rejectStartup = (error: Error): void => reject(error);
      server.once('error', rejectStartup);
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', rejectStartup);
        server.on('error', (error) => this.log('WARN', `Hunter manifest bridge error: ${error.message}`));
        const address = server.address() as AddressInfo;
        resolvePromise({ server, url: `http://127.0.0.1:${address.port}/captured.m3u8` });
      });
    });
  }

  private async convertToMp4(request: DownloadRequest, tools: ToolPaths, source: string): Promise<string> {
    const target = join(dirname(source), `${basename(source, extname(source))}.mp4`);
    this.emit({ id: request.id, type: 'processing', message: 'Converting to MP4…' });
    this.emit({ id: request.id, type: 'log', message: 'Converting MKV to MP4 without re-encoding…' });
    let exitCode = await this.runFfmpeg(request.id, tools.ffmpeg, [
      '-y', '-i', source, '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-movflags', '+faststart', target,
    ]);
    if (this.paused.has(request.id) || this.canceled.has(request.id)) {
      throw new Error('Conversion interrupted.');
    }
    if (exitCode !== 0) {
      rmSync(target, { force: true });
      this.emit({ id: request.id, type: 'log', message: 'Re-encoding incompatible codecs to H.264/AAC…' });
      exitCode = await this.runFfmpeg(request.id, tools.ffmpeg, [
        '-y', '-i', source, '-map', '0:v:0', '-map', '0:a:0?',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
        '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', target,
      ]);
      if (this.paused.has(request.id) || this.canceled.has(request.id)) {
        throw new Error('Conversion interrupted.');
      }
    }
    if (exitCode !== 0 || !existsSync(target)) {
      rmSync(target, { force: true });
      throw new Error('FFmpeg could not create the MP4 file.');
    }
    rmSync(source, { force: true });
    return target;
  }

  private runFfmpeg(id: string, executable: string, args: string[]): Promise<number> {
    return new Promise((resolvePromise) => {
      const child = spawn(executable, args, {
        windowsHide: true,
        detached: process.platform !== 'win32',
      });
      this.active.set(id, child);
      let buffer = '';
      child.stderr.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (/error|failed|forbidden/i.test(line)) {
            this.log('WARN', `[ffmpeg] ${line.trim()}`);
          }
        }
      });
      child.on('error', (error) => {
        this.log('ERROR', `[ffmpeg] ${error.message}`);
        resolvePromise(-1);
      });
      child.on('close', (code) => resolvePromise(code ?? -1));
    });
  }

  private terminateProcessTree(child: ChildProcessWithoutNullStreams): void {
    const pid = child.pid;
    if (!pid || child.exitCode !== null) return;
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true });
      return;
    }

    const signalGroup = (signal: NodeJS.Signals): void => {
      try {
        process.kill(-pid, signal);
      } catch {
        try {
          child.kill(signal);
        } catch {
          // The process may have exited between the state check and the signal.
        }
      }
    };

    signalGroup('SIGTERM');
    const forceTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) signalGroup('SIGKILL');
    }, 1_500);
    forceTimer.unref();
    child.once('close', () => clearTimeout(forceTimer));
  }

  private appendHeaders(args: string[], headers?: Record<string, string>): void {
    for (const [name, value] of Object.entries(headers ?? {})) {
      if (this.shouldForwardHeader(name, value)) {
        args.push('--add-header', `${name}: ${value}`);
      }
    }
  }

  private videoFormatSelector(quality?: DownloadRequest['quality']): string {
    const selected = quality ?? '1080';
    if (selected === 'best') {
      return 'bestvideo+bestaudio/best';
    }
    // `<=?` also accepts generic HLS streams whose manifest exposes no height.
    // Any stream with a known height still has to respect the selected ceiling.
    return `bestvideo[height<=?${selected}]+bestaudio/best[height<=?${selected}]`;
  }

  private ffmpegHeaders(request: DownloadRequest): string {
    const lines = [`Referer: ${request.referer || request.url}`];
    for (const [name, value] of Object.entries(request.requestHeaders ?? {})) {
      if (this.shouldForwardHeader(name, value)) lines.push(`${name}: ${value}`);
    }
    return `${lines.join('\r\n')}\r\n`;
  }

  private shouldForwardHeader(name: string, value: string): boolean {
    return Boolean(name && value)
      && /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)
      && !/[\r\n]/.test(value)
      && !['host', 'content-length', 'connection', 'referer'].includes(name.toLowerCase());
  }

  private resolveTools(required: boolean): ToolPaths | null {
    const discovered = this.discoverTools();
    const ytDlp = discovered.ytDlp;
    const ffmpeg = discovered.ffmpeg;
    if (ytDlp && ffmpeg) return { ytDlp, ffmpeg, deno: discovered.deno };
    if (required) {
      const missing = [!ytDlp && 'yt-dlp', !ffmpeg && 'FFmpeg'].filter(Boolean).join(' and ');
      throw new Error(`${missing} not found. Put the binaries in the project tools folder.`);
    }
    return null;
  }

  private discoverTools(): Omit<ToolStatus, 'mpv'> {
    const names = this.toolNames();
    const roots = [join(this.projectRoot, 'tools'), this.resourcesPath, join(this.resourcesPath, 'tools')];
    const ytDlp = this.findTool(roots, names.ytDlp) ?? this.findOnPath(names.ytDlpFallback);
    const ffmpeg = this.findTool(roots, names.ffmpeg) ?? this.findOnPath(names.ffmpegFallback);
    const deno = this.findTool(roots, names.deno) ?? this.findOnPath(names.denoFallback);
    return { ytDlp, ffmpeg, deno };
  }

  private toolNames(): {
    ytDlp: string[];
    ffmpeg: string[];
    deno: string[];
    ytDlpFallback: string;
    ffmpegFallback: string;
    denoFallback: string;
  } {
    if (process.platform === 'win32') {
      return {
        ytDlp: ['yt-dlp.exe'],
        ffmpeg: ['ffmpeg-win-x64.exe', 'ffmpeg.exe'],
        deno: ['deno-win-x64.exe', 'deno.exe'],
        ytDlpFallback: 'yt-dlp.exe',
        ffmpegFallback: 'ffmpeg.exe',
        denoFallback: 'deno.exe',
      };
    }
    if (process.platform === 'darwin') {
      const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
      return {
        ytDlp: ['yt-dlp-macos'],
        ffmpeg: [`ffmpeg-macos-${arch}`, 'ffmpeg-macos'],
        deno: [`deno-macos-${arch}`, 'deno-macos'],
        ytDlpFallback: 'yt-dlp',
        ffmpegFallback: 'ffmpeg',
        denoFallback: 'deno',
      };
    }
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    return {
      ytDlp: [`yt-dlp-linux-${arch}`, 'yt-dlp'],
      ffmpeg: [`ffmpeg-linux-${arch}`],
      deno: [`deno-linux-${arch}`, 'deno'],
      ytDlpFallback: 'yt-dlp',
      ffmpegFallback: 'ffmpeg',
      denoFallback: 'deno',
    };
  }

  private findTool(roots: string[], names: string[]): string | null {
    for (const root of roots) {
      for (const name of names) {
        const candidate = join(root, name);
        if (existsSync(candidate)) return candidate;
      }
    }
    return null;
  }

  private findOnPath(name: string): string | null {
    const command = process.platform === 'win32' ? 'where' : 'which';
    const result = spawnSync(command, [name], { encoding: 'utf8', windowsHide: true });
    const first = result.status === 0 ? result.stdout.split(/\r?\n/)[0]?.trim() : '';
    return first || null;
  }
}
