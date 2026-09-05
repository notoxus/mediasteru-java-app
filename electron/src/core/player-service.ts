import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export class PlayerService {
  private readonly executable: string | null;

  constructor(projectRoot: string, resourcesPath: string) {
    const names = process.platform === 'win32' ? ['mpv.exe'] : ['mpv'];
    const roots = [join(projectRoot, 'tools'), resourcesPath, join(resourcesPath, 'tools')];
    this.executable = this.findInRoots(roots, names) ?? this.findOnPath(names[0]);
  }

  path(): string | null {
    return this.executable;
  }

  play(localPath: string): Promise<void> {
    if (!existsSync(localPath)) throw new Error('The downloaded file no longer exists.');
    if (!this.executable) throw new Error('mpv was not found. Install mpv to enable playback.');
    return new Promise((resolve, reject) => {
      const child = spawn(this.executable!, ['--force-window=yes', localPath], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
      child.once('error', reject);
    });
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
