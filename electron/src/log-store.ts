import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MAX_LOG_SIZE = 2 * 1024 * 1024;
const MAX_BACKUPS = 3;

export class LogStore {
  private readonly directory: string;
  private readonly file: string;

  constructor(userDataPath: string) {
    this.directory = join(userDataPath, 'logs');
    this.file = join(this.directory, 'app.log');
    mkdirSync(this.directory, { recursive: true });
  }

  getDirectory(): string {
    return this.directory;
  }

  write(level: 'INFO' | 'WARN' | 'ERROR', message: string): void {
    try {
      this.rotateIfNeeded();
      const normalized = message.replace(/[\r\n]+$/g, '');
      appendFileSync(this.file, `${new Date().toISOString()}  ${level.padEnd(5)}  ${normalized}\n`, 'utf8');
    } catch {
      // Diagnostics must never interrupt an active download.
    }
  }

  private rotateIfNeeded(): void {
    if (!existsSync(this.file) || statSync(this.file).size < MAX_LOG_SIZE) {
      return;
    }
    for (let index = MAX_BACKUPS; index >= 2; index -= 1) {
      const previous = join(this.directory, `app.log.${index - 1}`);
      const next = join(this.directory, `app.log.${index}`);
      if (existsSync(previous)) {
        rmSync(next, { force: true });
        renameSync(previous, next);
      }
    }
		rmSync(join(this.directory, 'app.log.1'), { force: true });
    renameSync(this.file, join(this.directory, 'app.log.1'));
  }
}
