const streamQueryPatterns = [
  'format=m3u8', 'type=m3u8', 'format=hls', 'type=hls',
  'output=m3u8', 'output=hls', 'stream_type=hls',
  'container=m3u8', 'protocol=hls',
  'format=mpd', 'type=mpd', 'type=dash',
];

const streamPathPatterns = [
  '/hls/', '/dash/', '/manifest', '/chunklist',
  'master.m3u8', 'media.m3u8', 'stream.m3u8',
  'video.m3u8', 'index.m3u8', 'live.m3u8',
  'vod.m3u8', 'playlist.m3u8',
];

const mimeSniffableResourceTypes = new Set([
  'media',
  'xmlhttprequest',
  'other',
]);

const bodyInspectableResourceTypes = new Set([
  'media',
  'xmlhttprequest',
  'xhr',
  'fetch',
  'other',
]);

export function isValidMediaCandidateUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    const remainder = url.slice(url.indexOf('://') + 3);
    return !/https?:\/\//i.test(remainder);
  } catch {
    return false;
  }
}

export function looksLikeStreamUrl(url: string): boolean {
  if (!isValidMediaCandidateUrl(url)) return false;
  const lower = url.toLowerCase();
  if (lower.includes('audio-only') || lower.includes('/preview')) return false;
  if (/\.(m3u8?|mpd)(?:$|[?#])/.test(lower)) return true;
  if (streamQueryPatterns.some((pattern) => lower.includes(pattern))) return true;
  return streamPathPatterns.some((pattern) => lower.includes(pattern));
}

export function isMediaResponse(url: string, responseHeaders?: Record<string, string[]>): boolean {
  if (!isValidMediaCandidateUrl(url)) return false;
  if (looksLikeStreamUrl(url)) return true;
  return hasStreamContentType(responseHeaders);
}

export function shouldCaptureMediaResponse(
  url: string,
  resourceType: string,
  responseHeaders?: Record<string, string[]>,
): boolean {
  if (!isValidMediaCandidateUrl(url)) return false;
  // An iframe/player shell is not itself the downloadable stream. Let it
  // continue loading so its internal media/XHR request can reveal the real
  // manifest. A direct manifest URL remains valid in any resource type.
  if (looksLikeStreamUrl(url)) return true;
  return mimeSniffableResourceTypes.has(resourceType)
    && hasStreamContentType(responseHeaders);
}

/**
 * Some players serve the final m3u8 from an extensionless URL with a generic
 * MIME type. In hunting mode inspect only small media-like responses, then
 * require the response body itself to prove it is an HLS media playlist.
 */
export function shouldInspectResponseBody(
  url: string,
  resourceType: string | undefined,
  mimeType: string | undefined,
  encodedLength: number,
): boolean {
  if (!isValidMediaCandidateUrl(url) || encodedLength > 512 * 1024) return false;
  const normalizedMime = (mimeType ?? '').toLowerCase();
  if (looksLikeStreamUrl(url)
    || normalizedMime.includes('mpegurl')
    || normalizedMime.includes('application/dash+xml')) return true;
  return bodyInspectableResourceTypes.has((resourceType ?? '').toLowerCase())
    && !/^(?:image\/|font\/|text\/(?:css|javascript)|application\/(?:javascript|wasm))/.test(normalizedMime);
}

function hasStreamContentType(responseHeaders?: Record<string, string[]>): boolean {
  const contentType = Object.entries(responseHeaders ?? {})
    .find(([name]) => name.toLowerCase() === 'content-type')?.[1]?.join(';').toLowerCase() ?? '';
  return contentType.includes('mpegurl')
    || contentType.includes('application/dash+xml')
    || contentType.includes('application/vnd.apple.mpegurl');
}
