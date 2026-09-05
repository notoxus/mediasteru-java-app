import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LibraryRepository } from '../core/library-repository';
import { DownloadTask } from '../types';

test('completed downloads are upserted into the local library', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mediasteru-library-'));
  const library = new LibraryRepository(directory);
  const now = new Date().toISOString();
  const task: DownloadTask = {
    id: 'download-1',
    name: 'Original title',
    url: 'https://example.com/watch/1',
    savePath: directory,
    format: 'mp4',
    quality: '1080',
    status: 'completed',
    percent: 100,
    speed: 'N/A',
    outputPath: join(directory, 'Final title.mp4'),
    createdAt: now,
    updatedAt: now,
  };

  try {
    library.recordDownload(task);
    library.recordDownload({ ...task, name: 'Duplicate' });
    const items = library.list();
    assert.equal(items.length, 1);
    assert.equal(items[0].title, 'Final title');
    assert.equal(items[0].resolution, '1080p');
  } finally {
    library.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
