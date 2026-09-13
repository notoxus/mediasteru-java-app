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
    pause: () => true,
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
    pause: () => true,
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

test('review items start only after explicit selection', () => {
  const started: string[] = [];
  const engine: DownloadEngine = {
    start: (item) => started.push(item.id),
    cancel: () => true,
    pause: () => true,
  };
  const queue = new DownloadQueue(engine, () => {}, () => {}, 1);

  queue.enqueue(request('ad-candidate'), false);
  queue.enqueue(request('movie-candidate'), false);
  assert.deepEqual(started, []);
  assert.deepEqual(queue.list().map((item) => item.status), ['waiting', 'waiting']);

  assert.equal(queue.start(['movie-candidate']), 1);
  assert.deepEqual(started, ['movie-candidate']);
  assert.equal(queue.list()[0].status, 'waiting');
  assert.equal(queue.list()[1].status, 'preparing');
});

test('a review item can change format and quality before it is started', () => {
  const started: EnqueueDownloadRequest[] = [];
  const engine: DownloadEngine = {
    start: (item) => { started.push(item); },
    cancel: () => true,
    pause: () => true,
  };
  const queue = new DownloadQueue(engine, () => {}, () => {}, 1);

  queue.enqueue(request('captured'), false);
  const updated = queue.updateOptions('captured', { format: 'mkv', quality: '720' });
  assert.equal(updated?.format, 'mkv');
  assert.equal(updated?.quality, '720');
  assert.equal(queue.start(['captured']), 1);
  assert.equal(started[0]?.format, 'mkv');
  assert.equal(started[0]?.quality, '720');
  assert.equal(queue.updateOptions('captured', { format: 'mp4', quality: '1080' }), null);
});

test('queue keeps session credentials internal while passing them to the downloader', () => {
  const started: EnqueueDownloadRequest[] = [];
  const engine: DownloadEngine = {
    start: (item) => { started.push(item); },
    cancel: () => true,
    pause: () => true,
  };
  const queue = new DownloadQueue(engine, () => {}, () => {}, 1);
  queue.enqueue({
    ...request('protected-stream'),
    requestHeaders: {
      Cookie: 'session=secret',
      Authorization: 'Bearer secret',
      'X-Playback-Context': 'kept',
    },
    manifestBody: '#EXTM3U\n#EXT-X-ENDLIST\n',
  });

  assert.equal(started[0]?.requestHeaders?.Cookie, 'session=secret');
  assert.equal(started[0]?.requestHeaders?.Authorization, 'Bearer secret');
  assert.equal(started[0]?.manifestBody, '#EXTM3U\n#EXT-X-ENDLIST\n');
  assert.deepEqual(queue.list()[0].requestHeaders, { 'X-Playback-Context': 'kept' });
  assert.equal(queue.list()[0].manifestBody, undefined);
});

test('remove deletes waiting items and cancels active items before deleting them', () => {
  const canceled: string[] = [];
  const engine: DownloadEngine = {
    start: () => {},
    cancel: (id) => {
      canceled.push(id);
      return true;
    },
    pause: () => true,
  };
  const queue = new DownloadQueue(engine, () => {}, () => {}, 1);

  queue.enqueue(request('waiting'), false);
  assert.equal(queue.remove('waiting'), true);
  assert.equal(queue.list().length, 0);

  queue.enqueue(request('active'));
  assert.equal(queue.remove('active'), true);
  assert.deepEqual(canceled, ['active']);
  assert.equal(queue.list().length, 1);
  queue.handleEngineEvent({ id: 'active', type: 'canceled' });
  assert.equal(queue.list().length, 0);
});

test('download can pause, free its slot, resume, and retain progress', () => {
  const started: string[] = [];
  const paused: string[] = [];
  const engine: DownloadEngine = {
    start: (item) => started.push(item.id),
    cancel: () => true,
    pause: (id) => {
      paused.push(id);
      return true;
    },
  };
  const queue = new DownloadQueue(engine, () => {}, () => {}, 1);

  queue.enqueue(request('one'));
  queue.enqueue(request('two'));
  queue.handleEngineEvent({ id: 'one', type: 'progress', percent: 42, speed: '2 MiB/s' });
  assert.equal(queue.pause('one'), true);
  assert.equal(queue.list()[0].status, 'pausing');
  queue.handleEngineEvent({ id: 'one', type: 'paused' });
  assert.deepEqual(paused, ['one']);
  assert.equal(queue.list()[0].status, 'paused');
  assert.equal(queue.list()[0].percent, 42);
  assert.deepEqual(started, ['one', 'two']);

  queue.handleEngineEvent({ id: 'two', type: 'complete', outputPath: '/tmp/two.mp4' });
  assert.equal(queue.resume('one'), true);
  assert.deepEqual(started, ['one', 'two', 'one']);
});

test('cancel keeps a paused item while remove deletes it from the queue', () => {
  const engine: DownloadEngine = {
    start: () => {},
    cancel: () => true,
    pause: () => true,
  };
  const queue = new DownloadQueue(engine, () => {}, () => {}, 1);

  queue.enqueue(request('cancel-me'));
  assert.equal(queue.pause('cancel-me'), true);
  queue.handleEngineEvent({ id: 'cancel-me', type: 'paused' });
  assert.equal(queue.cancel('cancel-me'), true);
  assert.equal(queue.list()[0].status, 'canceled');
  assert.equal(queue.remove('cancel-me'), true);
  assert.equal(queue.list().length, 0);
});
