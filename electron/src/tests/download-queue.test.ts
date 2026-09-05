import assert from 'node:assert/strict';
import test from 'node:test';
import { DownloadEngine, DownloadQueue } from '../core/download-queue';
import { DownloadTask, EnqueueDownloadRequest } from '../types';

function request(id: string): EnqueueDownloadRequest {
  return {
    id,
    name: id.toUpperCase(),
    url: `https://example.com/${id}`,
    savePath: '/tmp',
    format: 'mp4',
    quality: '1080',
  };
}

test('queue limits concurrency and starts the next task after completion', () => {
  const started: string[] = [];
  let snapshot: DownloadTask[] = [];
  const engine: DownloadEngine = {
    start: (item) => started.push(item.id),
    cancel: () => true,
  };
  const queue = new DownloadQueue(engine, (items) => { snapshot = items; }, () => {}, 1);

  queue.enqueue(request('one'));
  queue.enqueue(request('two'));
  assert.deepEqual(started, ['one']);

  queue.handleEngineEvent({ id: 'one', type: 'complete', outputPath: '/tmp/one.mp4' });
  assert.deepEqual(started, ['one', 'two']);
  assert.equal(snapshot[0].status, 'completed');
  assert.equal(snapshot[1].status, 'preparing');
});

test('queued items can be canceled and terminal items retried', () => {
  const started: string[] = [];
  const engine: DownloadEngine = {
    start: (item) => started.push(item.id),
    cancel: () => true,
  };
  const queue = new DownloadQueue(engine, () => {}, () => {}, 1);
  queue.enqueue(request('one'));
  queue.enqueue(request('two'));

  assert.equal(queue.cancel('two'), true);
  assert.equal(queue.list()[1].status, 'canceled');
  assert.equal(queue.retry('two'), true);
  queue.handleEngineEvent({ id: 'one', type: 'error', message: 'failed' });
  assert.deepEqual(started, ['one', 'two']);
});
