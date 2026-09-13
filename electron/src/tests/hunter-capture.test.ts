import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isMediaResponse,
  isValidMediaCandidateUrl,
  looksLikeStreamUrl,
  shouldInspectResponseBody,
  shouldCaptureMediaResponse,
} from '../hunter-capture';

test('Hunter recognizes direct and disguised HLS/DASH request URLs', () => {
  assert.equal(looksLikeStreamUrl('https://cdn.example/video/master.m3u8?token=abc'), true);
  assert.equal(looksLikeStreamUrl('https://cdn.example/api?id=1&type=hls'), true);
  assert.equal(looksLikeStreamUrl('https://cdn.example/dash/manifest?id=1'), true);
});

test('Hunter ignores ordinary pages and common preview streams', () => {
  assert.equal(looksLikeStreamUrl('https://movies.example/watch/episode-1'), false);
  assert.equal(looksLikeStreamUrl('https://cdn.example/preview/master.m3u8'), false);
  assert.equal(looksLikeStreamUrl('https://cdn.example/audio-only/playlist.m3u8'), false);
});

test('Hunter rejects malformed stream URLs containing a second absolute URL', () => {
  const malformed = 'https://embed.examplehttps://cdn.example/playlist.m3u8';
  assert.equal(isValidMediaCandidateUrl(malformed), false);
  assert.equal(looksLikeStreamUrl(malformed), false);
  assert.equal(isMediaResponse(malformed, {
    'content-type': ['application/vnd.apple.mpegurl'],
  }), false);
});

test('Hunter detects extensionless streams from response Content-Type', () => {
  assert.equal(isMediaResponse('https://cdn.example/token/abc', {
    'content-type': ['application/vnd.apple.mpegurl; charset=utf-8'],
  }), true);
  assert.equal(isMediaResponse('https://cdn.example/token/xyz', {
    'Content-Type': ['application/dash+xml'],
  }), true);
});

test('Hunter inspects small generic media responses before body validation', () => {
  assert.equal(
    shouldInspectResponseBody('https://embed.example/opaque-token', 'Fetch', 'application/octet-stream', 4_096),
    true,
  );
  assert.equal(
    shouldInspectResponseBody('https://cdn.example/banner.png', 'Image', 'image/png', 4_096),
    false,
  );
  assert.equal(
    shouldInspectResponseBody('https://embed.example/opaque-token', 'Fetch', 'application/octet-stream', 600 * 1024),
    false,
  );
});

test('Hunter waits for a stream inside an embed frame instead of queuing the frame', () => {
  const manifestHeaders = {
    'content-type': ['application/vnd.apple.mpegurl; charset=utf-8'],
  };
  const embedUrl = 'https://embed1.streamc.xyz/eyJoIjoiZW1iZWQtc2hlbGwiLCJ0IjoidG9rZW4ifQ?d=1';

  assert.equal(looksLikeStreamUrl(embedUrl), false);
  assert.equal(shouldCaptureMediaResponse(embedUrl, 'subFrame', manifestHeaders), false);
  assert.equal(shouldCaptureMediaResponse(embedUrl, 'media', manifestHeaders), true);
  assert.equal(
    shouldCaptureMediaResponse('https://cdn.example/hls/master.m3u8', 'subFrame', {}),
    true,
  );
});
