const hlsHeader = '#EXTM3U';

export function isHlsManifestBody(body: string): boolean {
  return body.replace(/^\uFEFF/, '').trimStart().startsWith(hlsHeader);
}

/**
 * A master/control playlist is not a downloadable video by itself: it only
 * names rendition playlists. Wait until Chromium requests the media playlist
 * that contains actual `#EXTINF` segment entries. This prevents a signed
 * player-token endpoint from being queued as if it were the video stream.
 */
export function isHlsMediaPlaylistBody(body: string): boolean {
  if (!isHlsManifestBody(body)) return false;
  let expectsSegmentUri = false;
  for (const sourceLine of body.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line) continue;
    if (line.toUpperCase().startsWith('#EXTINF:')) {
      expectsSegmentUri = true;
      continue;
    }
    if (line.startsWith('#')) continue;
    if (expectsSegmentUri) return true;
  }
  return false;
}

export function isDashManifestBody(body: string): boolean {
  const start = body.replace(/^\uFEFF/, '').trimStart().slice(0, 2_048);
  return /^(?:<\?xml[^>]*>\s*)?<MPD(?:\s|>)/i.test(start);
}

export function decodeDebuggerBody(body: string, base64Encoded: boolean): string {
  return base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body;
}

export function rewriteHlsManifest(
  body: string,
  baseUrl: string,
  quality: '360' | '720' | '1080' | '1440' | '2160' | 'best' = 'best',
): string {
  if (!isHlsManifestBody(body)) throw new Error('The captured response is not an HLS manifest.');

  const resolveUri = (value: string): string => {
    try {
      return new URL(value, baseUrl).toString();
    } catch {
      return value;
    }
  };

  const lines = body
    .replace(/^\uFEFF/, '')
    .trimStart()
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        return line.replace(/URI=("([^"]+)"|'([^']+)'|([^,\s]+))/gi, (match, quoted, doubleQuoted, singleQuoted, bare) => {
          const rawUri = doubleQuoted ?? singleQuoted ?? bare ?? '';
          const resolved = resolveUri(rawUri);
          if (quoted.startsWith('"')) return `URI="${resolved}"`;
          if (quoted.startsWith("'")) return `URI='${resolved}'`;
          return `URI=${resolved}`;
        });
      }
      return resolveUri(trimmed);
    })
  if (quality === 'best') return lines.join('\n');

  const variants: Array<{ info: number; uri: number; height: number; bandwidth: number }> = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!lines[index].trim().toUpperCase().startsWith('#EXT-X-STREAM-INF:')) continue;
    let uriIndex = index + 1;
    while (uriIndex < lines.length && !lines[uriIndex].trim()) uriIndex += 1;
    if (uriIndex >= lines.length || lines[uriIndex].trim().startsWith('#')) continue;
    const resolution = lines[index].match(/RESOLUTION=\d+x(\d+)/i);
    const bandwidth = lines[index].match(/(?:AVERAGE-)?BANDWIDTH=(\d+)/i);
    variants.push({
      info: index,
      uri: uriIndex,
      height: Number(resolution?.[1] ?? 0),
      bandwidth: Number(bandwidth?.[1] ?? 0),
    });
  }
  const known = variants.filter((variant) => variant.height > 0);
  if (known.length === 0) return lines.join('\n');
  const ceiling = Number(quality);
  const eligible = known.filter((variant) => variant.height <= ceiling);
  const pool = eligible.length > 0 ? eligible : known;
  const selected = [...pool].sort((left, right) => (
    right.height - left.height || right.bandwidth - left.bandwidth
  ))[0];
  const removed = new Set<number>();
  for (const variant of variants) {
    if (variant === selected) continue;
    removed.add(variant.info);
    removed.add(variant.uri);
  }
  return lines.filter((_line, index) => !removed.has(index)).join('\n');
}
