import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeDebuggerBody,
  isDashManifestBody,
  isHlsManifestBody,
  isHlsMediaPlaylistBody,
  rewriteHlsManifest,
} from '../hunter-manifest';

test('Hunter validates response content instead of trusting a manifest MIME type', () => {
  assert.equal(isHlsManifestBody('<!doctype html><iframe src="player"></iframe>'), false);
  assert.equal(isHlsManifestBody('\uFEFF  #EXTM3U\n#EXT-X-ENDLIST'), true);
  assert.equal(isDashManifestBody('<?xml version="1.0"?><MPD type="static"></MPD>'), true);
  assert.equal(isDashManifestBody('<html><body><MPD is only text here></body></html>'), false);
});

test('Hunter waits for an HLS media playlist with actual segment URIs', () => {
  const master = [
    '#EXTM3U',
    '#EXT-X-STREAM-INF:BANDWIDTH=1800000,RESOLUTION=1280x720',
    '720.m3u8',
  ].join('\n');
  const media = [
    '#EXTM3U',
    '#EXT-X-TARGETDURATION:4',
    '#EXTINF:4.000,',
    'segments/0001.ts',
    '#EXT-X-ENDLIST',
  ].join('\n');
  assert.equal(isHlsMediaPlaylistBody(master), false);
  assert.equal(isHlsMediaPlaylistBody(media), true);
  assert.equal(isHlsMediaPlaylistBody('#EXTM3U\n#EXTINF:4.000,\n#EXT-X-ENDLIST'), false);
});

test('Hunter decodes response bodies returned by the Chromium debugger', () => {
  const manifest = '#EXTM3U\n#EXT-X-ENDLIST\n';
  assert.equal(decodeDebuggerBody(Buffer.from(manifest).toString('base64'), true), manifest);
  assert.equal(decodeDebuggerBody(manifest, false), manifest);
});

test('Local HLS snapshots resolve playlists, segments, maps, and keys against the captured URL', () => {
  const source = [
    '#EXTM3U',
    '#EXT-X-KEY:METHOD=AES-128,URI="keys/movie.key"',
    '#EXT-X-MAP:URI=init.mp4',
    '#EXT-X-STREAM-INF:BANDWIDTH=1000000',
    '../quality/720.m3u8',
    '#EXTINF:4,',
    'segment-1.ts',
  ].join('\n');
  const rewritten = rewriteHlsManifest(source, 'https://cdn.example/token/master');
  assert.match(rewritten, /URI="https:\/\/cdn\.example\/token\/keys\/movie\.key"/);
  assert.match(rewritten, /URI=https:\/\/cdn\.example\/token\/init\.mp4/);
  assert.match(rewritten, /https:\/\/cdn\.example\/quality\/720\.m3u8/);
  assert.match(rewritten, /https:\/\/cdn\.example\/token\/segment-1\.ts/);
});

test('HLS master manifests keep only the best variant within the selected quality', () => {
  const source = [
    '#EXTM3U',
    '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720',
    '720.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=2200000,RESOLUTION=1920x1080',
    '1080.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=3840x2160',
    '2160.m3u8',
  ].join('\n');
  const selected = rewriteHlsManifest(source, 'https://cdn.example/master.m3u8', '1080');
  assert.doesNotMatch(selected, /720\.m3u8/);
  assert.match(selected, /https:\/\/cdn\.example\/1080\.m3u8/);
  assert.doesNotMatch(selected, /2160\.m3u8/);
});
