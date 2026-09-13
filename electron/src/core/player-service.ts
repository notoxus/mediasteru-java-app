import { ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { createConnection, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import {
  DownloadFormat,
  PlaybackCommand,
  PlaybackQueueItem,
  PlaybackState,
} from '../types';

type StateSink = (state: PlaybackState) => void;

interface PendingCommand {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface MpvMessage {
  event?: string;
  name?: string;
  data?: unknown;
  error?: string;
  request_id?: number;
}

export class PlayerService {
  private readonly executable: string | null;
  private child: ChildProcess | null = null;
  private socket: Socket | null = null;
  private socketPath: string | null = null;
  private socketBuffer = '';
  private generation = 0;
  private requestId = 0;
  private readonly pending = new Map<number, PendingCommand>();
  private playlist: PlaybackQueueItem[] = [];
  private playlistIndex = -1;
  private stateValue = idleState();

  constructor(
    projectRoot: string,
    resourcesPath: string,
    private readonly onState: StateSink = () => undefined,
  ) {
    const names = process.platform === 'win32' ? ['mpv.exe'] : ['mpv'];
    const roots = [join(projectRoot, 'tools'), resourcesPath, join(resourcesPath, 'tools')];
    this.executable = this.findInRoots(roots, names) ?? this.findOnPath(names[0]);
  }

  path(): string | null {
    return this.executable;
  }

  state(): PlaybackState {
    return { ...this.stateValue };
  }

  async play(
    localPath: string,
    selected?: PlaybackQueueItem,
    playlist?: PlaybackQueueItem[],
  ): Promise<void> {
    if (!existsSync(localPath)) throw new Error('The downloaded file no longer exists.');
    if (!this.executable) throw new Error('mpv was not found. Install mpv to enable playback.');

    const item = selected ?? {
      id: -1,
      title: basename(localPath, extname(localPath)) || basename(localPath),
      localPath,
      format: formatFromPath(localPath),
    };
    this.playlist = playlist?.length ? [...playlist] : [item];
    const index = this.playlist.findIndex((candidate) => candidate.localPath === localPath);
    if (index < 0) this.playlist.push(item);
    await this.launch(index < 0 ? this.playlist.length - 1 : index);
  }

  async command(command: PlaybackCommand): Promise<PlaybackState> {
    if (command === 'toggle') await this.togglePause();
    if (command === 'next') await this.next();
    if (command === 'previous') await this.previous();
    if (command === 'stop') this.stop();
    return this.state();
  }

  close(): void {
    this.stop();
  }

  private async launch(index: number): Promise<void> {
    const item = this.playlist[index];
    if (!item || !this.executable) throw new Error('There is no playable item at this position.');
    if (!existsSync(item.localPath)) throw new Error(`The media file no longer exists: ${item.localPath}`);

    this.disposeProcess();
    const generation = ++this.generation;
    this.playlistIndex = index;
    const ipcPath = this.nextSocketPath();
    this.socketPath = ipcPath;
    const audio = isAudio(item);
    const child = spawn(this.executable, [
      '--no-terminal',
      '--keep-open=no',
      `--input-ipc-server=${ipcPath}`,
      `--force-window=${audio ? 'no' : 'yes'}`,
      audio ? '--audio-display=no' : '--audio-display=embedded-first',
      item.localPath,
    ], {
      stdio: 'ignore',
      windowsHide: true,
    });
    this.child = child;
    this.setState({
      status: 'playing',
      itemId: item.id,
      title: item.title,
      localPath: item.localPath,
      mediaKind: audio ? 'audio' : 'video',
      position: 0,
      duration: 0,
      volume: 100,
      queueIndex: index,
      queueLength: this.playlist.length,
    });

    const spawned = new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    child.once('exit', () => this.onProcessExit(generation));
    await spawned;
    try {
      this.socket = await this.connect(ipcPath, generation);
      this.socket.setEncoding('utf8');
      this.socket.on('data', (chunk: string) => this.handleSocketData(chunk));
      this.socket.on('error', () => undefined);
      await Promise.all([
        this.send(['observe_property', 1, 'pause']),
        this.send(['observe_property', 2, 'time-pos']),
        this.send(['observe_property', 3, 'duration']),
        this.send(['observe_property', 4, 'volume']),
      ]);
    } catch (error) {
      this.disposeProcess();
      this.setIdle();
      throw error;
    }
  }

  private async togglePause(): Promise<void> {
    this.requireActive();
    await this.send(['cycle', 'pause']);
    const paused = Boolean(await this.send(['get_property', 'pause']));
    this.setState({ ...this.stateValue, status: paused ? 'paused' : 'playing' });
  }

  private async next(): Promise<void> {
    this.requireActive();
    if (this.playlistIndex + 1 >= this.playlist.length) {
      throw new Error('This is the last item in the playback queue.');
    }
    await this.launch(this.playlistIndex + 1);
  }

  private async previous(): Promise<void> {
    this.requireActive();
    if (this.stateValue.position > 5) {
      await this.send(['set_property', 'time-pos', 0]);
      this.setState({ ...this.stateValue, position: 0 });
      return;
    }
    if (this.playlistIndex <= 0) {
      throw new Error('This is the first item in the playback queue.');
    }
    await this.launch(this.playlistIndex - 1);
  }

  private stop(): void {
    this.playlist = [];
    this.playlistIndex = -1;
    this.disposeProcess();
    this.setIdle();
  }

  private onProcessExit(generation: number): void {
    if (generation !== this.generation) return;
    this.child = null;
    this.disposeSocket();
    if (this.playlistIndex + 1 < this.playlist.length) {
      void this.launch(this.playlistIndex + 1).catch(() => this.setIdle());
      return;
    }
    this.setIdle();
  }

  private requireActive(): void {
    if (!this.child || !this.socket || this.stateValue.status === 'idle') {
      throw new Error('Nothing is currently playing.');
    }
  }

  private connect(ipcPath: string, generation: number): Promise<Socket> {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const tryConnect = (): void => {
        if (generation !== this.generation || !this.child) {
          reject(new Error('mpv stopped before its control channel was ready.'));
          return;
        }
        attempts += 1;
        const socket = createConnection(ipcPath);
        const onError = (error: NodeJS.ErrnoException): void => {
          socket.destroy();
          if (attempts >= 50) {
            reject(new Error(`Could not connect to mpv control channel: ${error.message}`));
            return;
          }
          setTimeout(tryConnect, 40);
        };
        socket.once('error', onError);
        socket.once('connect', () => {
          socket.off('error', onError);
          resolve(socket);
        });
      };
      tryConnect();
    });
  }

  private send(command: unknown[]): Promise<unknown> {
    if (!this.socket) return Promise.reject(new Error('mpv control channel is unavailable.'));
    const requestId = ++this.requestId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('mpv did not answer the playback command.'));
      }, 2_000);
      this.pending.set(requestId, { resolve, reject, timer });
      this.socket!.write(`${JSON.stringify({ command, request_id: requestId })}\n`, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(error);
      });
    });
  }

  private handleSocketData(chunk: string): void {
    this.socketBuffer += chunk;
    let newline = this.socketBuffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.socketBuffer.slice(0, newline).trim();
      this.socketBuffer = this.socketBuffer.slice(newline + 1);
      if (line) {
        try {
          this.handleMessage(JSON.parse(line) as MpvMessage);
        } catch {
          // Ignore malformed diagnostic output and keep the control channel alive.
        }
      }
      newline = this.socketBuffer.indexOf('\n');
    }
  }

  private handleMessage(message: MpvMessage): void {
    if (message.request_id !== undefined) {
      const pending = this.pending.get(message.request_id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(message.request_id);
        if (message.error && message.error !== 'success') {
          pending.reject(new Error(`mpv: ${message.error}`));
        } else {
          pending.resolve(message.data);
        }
      }
    }
    if (message.event !== 'property-change') return;
    if (message.name === 'pause') {
      this.setState({ ...this.stateValue, status: message.data ? 'paused' : 'playing' });
    }
    if (message.name === 'time-pos' && typeof message.data === 'number') {
      this.setState({ ...this.stateValue, position: message.data });
    }
    if (message.name === 'duration' && typeof message.data === 'number') {
      this.setState({ ...this.stateValue, duration: message.data });
    }
    if (message.name === 'volume' && typeof message.data === 'number') {
      this.setState({ ...this.stateValue, volume: message.data });
    }
  }

  private disposeProcess(): void {
    this.generation += 1;
    const child = this.child;
    this.child = null;
    this.disposeSocket();
    if (child && !child.killed) child.kill();
  }

  private disposeSocket(): void {
    this.socket?.destroy();
    this.socket = null;
    this.socketBuffer = '';
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('mpv control channel closed.'));
    }
    this.pending.clear();
    if (this.socketPath && process.platform !== 'win32' && existsSync(this.socketPath)) {
      try {
        unlinkSync(this.socketPath);
      } catch {
        // mpv or the operating system may remove the socket first.
      }
    }
    this.socketPath = null;
  }

  private setState(state: PlaybackState): void {
    this.stateValue = state;
    this.onState(this.state());
  }

  private setIdle(): void {
    this.setState(idleState());
  }

  private nextSocketPath(): string {
    const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return process.platform === 'win32'
      ? `\\\\.\\pipe\\mediasteru-mpv-${suffix}`
      : join(tmpdir(), `mediasteru-mpv-${suffix}.sock`);
  }

  private findInRoots(roots: string[], names: string[]): string | null {
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
    return result.status === 0 ? result.stdout.split(/\r?\n/)[0]?.trim() || null : null;
  }
}

function idleState(): PlaybackState {
  return {
    status: 'idle',
    itemId: null,
    title: null,
    localPath: null,
    mediaKind: null,
    position: 0,
    duration: 0,
    volume: 100,
    queueIndex: -1,
    queueLength: 0,
  };
}

function isAudio(item: PlaybackQueueItem): boolean {
  return item.format === 'mp3' || new Set([
    '.aac', '.flac', '.m4a', '.mp3', '.oga', '.ogg', '.opus', '.wav',
  ]).has(extname(item.localPath).toLowerCase());
}

function formatFromPath(localPath: string): DownloadFormat {
  const extension = extname(localPath).toLowerCase();
  if (extension === '.mp3') return 'mp3';
  return extension === '.mkv' ? 'mkv' : 'mp4';
}
