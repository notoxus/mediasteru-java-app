import assert from 'node:assert/strict';
import test from 'node:test';
import { HunterCandidateStore } from '../hunter-candidates';

const capture = (url: string) => ({ url, requestHeaders: {} });

test('Hunter exposes a validated stream candidate only after media starts playing', () => {
  const store = new HunterCandidateStore();
  store.add(capture('https://cdn.example/video.m3u8'), 10);
  assert.deepEqual(store.state(true), { candidateCount: 1, downloadReady: false });
  assert.equal(store.takeLatest(), null);
  store.markPlaying(10);
  assert.deepEqual(store.state(true), { candidateCount: 1, downloadReady: true });
  assert.deepEqual(store.state(false), { candidateCount: 1, downloadReady: false });
});

test('Hunter scopes duplicate URLs to the WebContents that played them', () => {
  const store = new HunterCandidateStore();
  assert.equal(store.add(capture('https://cdn.example/shared.m3u8'), 10), true);
  assert.equal(store.add(capture('https://cdn.example/shared.m3u8'), 10), false);
  assert.equal(store.add(capture('https://cdn.example/shared.m3u8'), 20), true);
  store.markPlaying(20);
  assert.deepEqual(store.state(true), { candidateCount: 1, downloadReady: true });
});

test('Hunter Download takes the latest candidate from the playing contents', () => {
  const store = new HunterCandidateStore();
  store.add(capture('https://ads.example/ad.m3u8'), 11);
  store.add(capture('https://cdn.example/master.m3u8'), 22);
  store.add(capture('https://cdn.example/movie.m3u8'), 22);
  store.markPlaying(22);
  assert.equal(store.takeLatest()?.url, 'https://cdn.example/movie.m3u8');
  assert.deepEqual(store.state(true), { candidateCount: 2, downloadReady: true });
});

test('A playing media window remains selected when a popup detects a later stream', () => {
  const store = new HunterCandidateStore();
  store.add(capture('https://cdn.example/movie.m3u8'), 22);
  store.markPlaying(22);
  store.add(capture('https://ads.example/popup.m3u8'), 11);
  assert.deepEqual(store.state(true), { candidateCount: 1, downloadReady: true });
  assert.equal(store.takeLatest()?.url, 'https://cdn.example/movie.m3u8');
});

test('Hunter falls back to the detected iframe when playback belongs to its parent page', () => {
  const store = new HunterCandidateStore();
  store.add(capture('https://cdn.example/movie.m3u8'), 42);
  store.markPlaying(7);
  assert.deepEqual(store.state(true), { candidateCount: 1, downloadReady: true });
  assert.equal(store.takeLatest()?.url, 'https://cdn.example/movie.m3u8');
});
