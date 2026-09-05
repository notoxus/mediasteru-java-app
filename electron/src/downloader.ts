import { ChildProcessWithoutNullStreams, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
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
    mkdirSync(request.savePath, { recursive: true });
    void this.runDownload(request);
  }

  cancel(id: string): boolean {
    const child = this.active.get(id);
    if (!child) {
      return false;
    }
    this.canceled.add(id);
    child.kill('SIGTERM');
    return true;
  }

  private async runDownload(request: DownloadRequest): Promise<void> {
    try {
      const tools = this.resolveTools(true)!;
      this.emit({ id: request.id, type: 'started', message: 'Preparing download…' });
      const result = await this.runYtDlp(request, tools);
      let outputPath = result.outputPath;
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
      if (this.canceled.has(request.id)) {
        this.emit({ id: request.id, type: 'canceled', message: 'Download canceled.' });
        this.log('INFO', `Download canceled: ${request.url}`);
      } else {
        this.emit({ id: request.id, type: 'error', message });
        this.log('ERROR', `Download failed for ${request.url}: ${message}`);
      }
    } finally {
      this.active.delete(request.id);
      this.canceled.delete(request.id);
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
      const child = spawn(tools.ytDlp, args, { windowsHide: true });
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
    this.emit({ id: request.id, type: 'log', message: 'Trying the captured stream directly with FFmpeg…' });
    const extension = request.format === 'mp3' ? '.mp3' : '.mkv';
    const output = join(request.savePath, `captured-${Date.now()}${extension}`);
    const headers = this.ffmpegHeaders(request);
    const args = ['-y', '-headers', headers, '-i', request.url];
    if (request.format === 'mp3') {
      args.push('-vn', '-c:a', 'libmp3lame');
    } else {
      args.push('-map', '0:v:0?', '-map', '0:a:0?', '-c', 'copy');
    }
    args.push(output);
    const exitCode = await this.runFfmpeg(request.id, tools.ffmpeg, args);
    if (exitCode !== 0 || !existsSync(output)) {
      if (existsSync(output)) rmSync(output, { force: true });
      return null;
    }
    if (request.format === 'mp4') {
      return this.convertToMp4(request, tools, output);
    }
    return output;
  }

  private async convertToMp4(request: DownloadRequest, tools: ToolPaths, source: string): Promise<string> {
    const target = join(dirname(source), `${basename(source, extname(source))}.mp4`);
    this.emit({ id: request.id, type: 'processing', message: 'Converting to MP4…' });
    this.emit({ id: request.id, type: 'log', message: 'Converting MKV to MP4 without re-encoding…' });
    let exitCode = await this.runFfmpeg(request.id, tools.ffmpeg, [
      '-y', '-i', source, '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-movflags', '+faststart', target,
    ]);
    if (exitCode !== 0) {
      rmSync(target, { force: true });
      this.emit({ id: request.id, type: 'log', message: 'Re-encoding incompatible codecs to H.264/AAC…' });
      exitCode = await this.runFfmpeg(request.id, tools.ffmpeg, [
        '-y', '-i', source, '-map', '0:v:0', '-map', '0:a:0?',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
        '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', target,
      ]);
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
      const child = spawn(executable, args, { windowsHide: true });
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
