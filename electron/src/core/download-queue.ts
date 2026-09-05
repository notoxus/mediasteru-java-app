import {
  DownloadEvent,
  DownloadTask,
  EnqueueDownloadRequest,
} from '../types';

export interface DownloadEngine {
  start(request: EnqueueDownloadRequest): void;
  cancel(id: string): boolean;
}

type QueueChanged = (tasks: DownloadTask[]) => void;
type DownloadCompleted = (task: DownloadTask) => void;

const TERMINAL_STATES = new Set<DownloadTask['status']>([
  'completed',
  'failed',
  'canceled',
]);

/**
 * Owns download state and scheduling. The renderer is deliberately only a view
 * so a reload or a second window cannot lose or corrupt the active queue.
 */
export class DownloadQueue {
  private readonly tasks = new Map<string, DownloadTask>();
  private readonly active = new Set<string>();

  constructor(
    private readonly engine: DownloadEngine,
    private readonly onChanged: QueueChanged,
    private readonly onCompleted: DownloadCompleted,
    private readonly concurrency = 2,
  ) {}

  list(): DownloadTask[] {
    return Array.from(this.tasks.values(), (task) => this.copy(task));
  }

  enqueue(request: EnqueueDownloadRequest): DownloadTask {
    if (this.tasks.has(request.id)) {
      throw new Error('A download with this id already exists.');
    }
    const now = new Date().toISOString();
    const task: DownloadTask = {
      ...request,
      requestHeaders: { ...(request.requestHeaders ?? {}) },
      status: 'queued',
      percent: 0,
      speed: 'N/A',
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(task.id, task);
    this.publish();
    this.pump();
    return this.copy(task);
  }

  cancel(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task || TERMINAL_STATES.has(task.status)) return false;
    if (task.status === 'queued') {
      task.status = 'canceled';
      task.updatedAt = new Date().toISOString();
      this.publish();
      return true;
    }
    return this.engine.cancel(id);
  }

  remove(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task || !TERMINAL_STATES.has(task.status)) return false;
    const removed = this.tasks.delete(id);
    if (removed) this.publish();
    return removed;
  }

  retry(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task || !TERMINAL_STATES.has(task.status)) return false;
    delete task.error;
    delete task.outputPath;
    task.status = 'queued';
    task.percent = 0;
    task.speed = 'N/A';
    task.updatedAt = new Date().toISOString();
    this.publish();
    this.pump();
    return true;
  }

  handleEngineEvent(event: DownloadEvent): void {
    const task = this.tasks.get(event.id);
    if (!task) return;

    switch (event.type) {
      case 'started':
        task.status = 'preparing';
        break;
      case 'progress':
        task.status = 'downloading';
        task.percent = event.percent ?? task.percent;
        task.speed = event.speed ?? task.speed;
        break;
      case 'processing':
        task.status = 'processing';
        break;
      case 'complete':
        task.status = 'completed';
        task.percent = 100;
        task.outputPath = event.outputPath;
        break;
      case 'error':
        task.status = 'failed';
        task.error = event.message;
        break;
      case 'canceled':
        task.status = 'canceled';
        break;
      case 'log':
        break;
    }

    task.updatedAt = new Date().toISOString();
    if (TERMINAL_STATES.has(task.status)) {
      this.active.delete(task.id);
      if (task.status === 'completed' && task.outputPath) this.onCompleted(this.copy(task));
    }
    this.publish();
    this.pump();
  }

  private pump(): void {
    while (this.active.size < Math.max(1, this.concurrency)) {
      const next = Array.from(this.tasks.values()).find((task) => task.status === 'queued');
      if (!next) return;
      next.status = 'preparing';
      next.updatedAt = new Date().toISOString();
      this.active.add(next.id);
      this.publish();
      try {
        this.engine.start(next);
      } catch (error) {
        this.handleEngineEvent({
          id: next.id,
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private publish(): void {
    this.onChanged(this.list());
  }

  private copy(task: DownloadTask): DownloadTask {
    return { ...task, requestHeaders: { ...(task.requestHeaders ?? {}) } };
  }
}
