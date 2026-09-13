import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveHunterInput } from '../hunter-navigation';

test('Hunter keeps explicit web URLs', () => {
  assert.equal(resolveHunterInput('https://example.com/watch?v=1'), 'https://example.com/watch?v=1');
});

test('Hunter treats domains and local development hosts as URLs', () => {
  assert.equal(resolveHunterInput('example.com/video'), 'https://example.com/video');
  assert.equal(resolveHunterInput('localhost:3000/player'), 'https://localhost:3000/player');
  assert.equal(resolveHunterInput('127.0.0.1:8080'), 'https://127.0.0.1:8080/');
});

test('Hunter turns ordinary text into a Google search', () => {
  assert.equal(
    resolveHunterInput('free music stream'),
    'https://www.google.com/search?q=free+music+stream',
  );
});

test('Hunter rejects non-web protocols', () => {
  assert.throws(() => resolveHunterInput('file:///tmp/video.html'), /HTTP and HTTPS/);
  assert.throws(() => resolveHunterInput('javascript:alert(1)'), /HTTP and HTTPS/);
});
