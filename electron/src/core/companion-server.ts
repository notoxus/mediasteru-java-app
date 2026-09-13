import { randomUUID } from 'node:crypto';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import {
  CapturedMedia,
  DownloadFormat,
  DownloadQuality,
  DownloadTask,
  EnqueueDownloadRequest,
  LibraryItem,
  PlaybackCommand,
  PlaybackState,
} from '../types';

type CaptureSink = (capture: CapturedMedia) => void;
type LogSink = (level: 'INFO' | 'WARN' | 'ERROR', message: string) => void;

export interface ControlApi {
  listDownloads(): DownloadTask[];
  enqueueDownload(request: EnqueueDownloadRequest): DownloadTask;
  cancelDownload(id: string): boolean;
  pauseDownload(id: string): boolean;
  resumeDownload(id: string): boolean;
  retryDownload(id: string): boolean;
  listLibrary(): LibraryItem[];
  playLibraryItem(id: number): Promise<void>;
  playerState(): PlaybackState;
  controlPlayer(command: PlaybackCommand): Promise<PlaybackState>;
  defaultDownloadPath(): string;
}

export class CompanionServer {
  private server: Server | null = null;
  private readonly eventClients = new Set<ServerResponse>();
  private readonly controlToken = process.env.MEDIASTERU_CONTROL_TOKEN?.trim() || null;

  constructor(
    private readonly onCapture: CaptureSink,
    private readonly log: LogSink,
    private readonly control?: ControlApi,
    private readonly port = 8765,
  ) {}

  start(): void {
    if (this.server) return;
    const server = createServer((request, response) => void this.handle(request, response));
    server.on('error', (error: NodeJS.ErrnoException) => {
      const message = error.code === 'EADDRINUSE'
        ? `Companion port ${this.port} is already in use.`
        : `Companion server failed: ${error.message}`;
      this.log('WARN', message);
    });
    server.listen(this.port, '0.0.0.0', () => {
      const address = this.lanAddress();
      this.log('INFO', `Phone companion ready at http://${address ?? 'localhost'}:${this.port}`);
    });
    this.server = server;
  }

  close(): void {
    for (const client of this.eventClients) client.end();
    this.eventClients.clear();
    this.server?.close();
    this.server = null;
  }

  publish(event: 'downloads' | 'library' | 'player', value: object): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(value)}\n\n`;
    for (const client of this.eventClients) client.write(payload);
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    this.applyCors(response);
    if (request.method === 'OPTIONS') {
      response.writeHead(204).end();
      return;
    }
    const requestUrl = new URL(request.url ?? '/', 'http://localhost');
    if (requestUrl.pathname.startsWith('/v1/')) {
      await this.handleControl(request, response, requestUrl);
      return;
    }
    if (request.url === '/ping' && request.method === 'GET') {
      this.json(response, 200, { app: 'MediaSteru', status: 'ok' });
      return;
    }
    if ((request.url === '/add' || request.url === '/capture') && request.method === 'POST') {
      try {
        const body = JSON.parse(await this.readBody(request)) as {
          url?: string;
          referer?: string;
          headers?: Record<string, string>;
        };
        const url = new URL(body.url ?? '');
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported URL protocol');
        const capture: CapturedMedia = {
          url: url.toString(),
          referer: body.referer,
          requestHeaders: body.headers ?? {},
        };
        this.onCapture(capture);
        this.json(response, 200, { status: 'ok' });
      } catch (error) {
        this.json(response, 400, {
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }
    this.json(response, request.method === 'GET' ? 404 : 405, { status: 'error' });
  }

  private async handleControl(
    request: IncomingMessage,
    response: ServerResponse,
    requestUrl: URL,
  ): Promise<void> {
    if (!this.control) {
      this.json(response, 503, { status: 'error', message: 'Control API is unavailable.' });
      return;
    }
    if (!this.isLoopback(request.socket.remoteAddress)) {
      this.json(response, 403, { status: 'error', message: 'The control API only accepts local connections.' });
      return;
    }
    if (this.controlToken && request.headers.authorization !== `Bearer ${this.controlToken}`) {
      this.json(response, 401, { status: 'error', message: 'A valid control token is required.' });
      return;
    }

    try {
      if (requestUrl.pathname === '/v1/status' && request.method === 'GET') {
        this.json(response, 200, { app: 'MediaSteru', apiVersion: 1, status: 'ok' });
        return;
      }
      if (requestUrl.pathname === '/v1/downloads' && request.method === 'GET') {
        this.json(response, 200, { downloads: this.control.listDownloads() });
        return;
      }
      if (requestUrl.pathname === '/v1/downloads' && request.method === 'POST') {
        const body = JSON.parse(await this.readBody(request)) as Record<string, unknown>;
        const url = this.httpUrl(body.url);
        const format = this.downloadFormat(body.format);
        const quality = this.downloadQuality(body.quality);
        const requestHeaders = this.stringRecord(body.requestHeaders);
        const task = this.control.enqueueDownload({
          id: typeof body.id === 'string' && body.id.trim() ? body.id.trim() : randomUUID(),
          url: url.toString(),
          savePath: typeof body.savePath === 'string' && body.savePath.trim()
            ? body.savePath.trim()
            : this.control.defaultDownloadPath(),
          format,
          quality,
          name: typeof body.name === 'string' && body.name.trim()
            ? body.name.trim()
            : this.labelForUrl(url),
          referer: typeof body.referer === 'string' ? body.referer : undefined,
          requestHeaders,
        });
        this.json(response, 202, { download: task });
        return;
      }
      const downloadAction = requestUrl.pathname.match(/^\/v1\/downloads\/([^/]+)\/(cancel|pause|resume|retry)$/);
      if (downloadAction && request.method === 'POST') {
        const id = decodeURIComponent(downloadAction[1]);
        const action = downloadAction[2];
        const changed = action === 'cancel'
          ? this.control.cancelDownload(id)
          : action === 'pause'
            ? this.control.pauseDownload(id)
            : action === 'resume'
              ? this.control.resumeDownload(id)
              : this.control.retryDownload(id);
        this.json(response, changed ? 200 : 409, {
          status: changed ? 'ok' : 'error',
          message: changed ? undefined : `Download ${id} cannot perform ${action}.`,
        });
        return;
      }
      if (requestUrl.pathname === '/v1/library' && request.method === 'GET') {
        const query = (requestUrl.searchParams.get('q') ?? '').trim().toLocaleLowerCase();
        const items = this.control.listLibrary().filter((item) => !query
          || item.title.toLocaleLowerCase().includes(query)
          || item.localPath.toLocaleLowerCase().includes(query));
        this.json(response, 200, { items });
        return;
      }
      const playAction = requestUrl.pathname.match(/^\/v1\/library\/(\d+)\/play$/);
      if (playAction && request.method === 'POST') {
        await this.control.playLibraryItem(Number(playAction[1]));
        this.json(response, 202, { status: 'ok' });
        return;
      }
      if (requestUrl.pathname === '/v1/player' && request.method === 'GET') {
        this.json(response, 200, { player: this.control.playerState() });
        return;
      }
      const playerAction = requestUrl.pathname.match(/^\/v1\/player\/(toggle|next|previous|stop)$/);
      if (playerAction && request.method === 'POST') {
        const player = await this.control.controlPlayer(playerAction[1] as PlaybackCommand);
        this.json(response, 200, { player });
        return;
      }
      if (requestUrl.pathname === '/v1/events' && request.method === 'GET') {
        response.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        response.write(': connected\n\n');
        this.eventClients.add(response);
        request.on('close', () => this.eventClients.delete(response));
        return;
      }
      this.json(response, request.method === 'GET' ? 404 : 405, {
        status: 'error',
        message: 'Unknown control API endpoint.',
      });
    } catch (error) {
      this.json(response, 400, {
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private readBody(request: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => {
        body += chunk;
        if (body.length > 1_000_000) {
          reject(new Error('Request body is too large'));
          request.destroy();
        }
      });
      request.on('end', () => resolve(body));
      request.on('error', reject);
    });
  }

  private applyCors(response: ServerResponse): void {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  }

  private json(response: ServerResponse, status: number, value: object): void {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(value));
  }

  private isLoopback(address?: string): boolean {
    return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
  }

  private httpUrl(value: unknown): URL {
    if (typeof value !== 'string') throw new Error('A URL is required.');
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS URLs are supported.');
    return url;
  }

  private downloadFormat(value: unknown): DownloadFormat {
    return value === 'mkv' || value === 'mp3' ? value : 'mp4';
  }

  private downloadQuality(value: unknown): DownloadQuality {
    return value === '720' || value === '1440' || value === '2160' || value === 'best'
      ? value
      : '1080';
  }

  private stringRecord(value: unknown): Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  }

  private labelForUrl(url: URL): string {
    const tail = url.pathname.split('/').filter(Boolean).pop();
    return tail ? `${url.hostname} · ${decodeURIComponent(tail).slice(0, 58)}` : url.hostname;
  }

  private lanAddress(): string | null {
    for (const addresses of Object.values(networkInterfaces())) {
      for (const address of addresses ?? []) {
        if (address.family === 'IPv4' && !address.internal) return address.address;
      }
    }
    return null;
  }
}
