import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  session,
  shell,
  WebContentsView,
  type Session,
  type WebContents,
} from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import { CompanionServer } from './core/companion-server';
import { DownloadQueue } from './core/download-queue';
import { LibraryRepository } from './core/library-repository';
import { PlayerService } from './core/player-service';
import { Downloader } from './downloader';
import { HunterCandidateStore } from './hunter-candidates';
import { isValidMediaCandidateUrl, looksLikeStreamUrl, shouldInspectResponseBody } from './hunter-capture';
import {
  decodeDebuggerBody,
  isDashManifestBody,
  isHlsManifestBody,
  isHlsMediaPlaylistBody,
} from './hunter-manifest';
import { resolveHunterInput } from './hunter-navigation';
import { LogStore } from './log-store';
import {
  CapturedMedia,
  DownloadTask,
  DownloadTaskOptions,
  EnqueueDownloadRequest,
  HunterNavigationState,
  ImportedMedia,
  LibraryItem,
  PlaybackCommand,
  PlaybackQueueItem,
  PlaybackState,
} from './types';

let mainWindow: BrowserWindow | null = null;
let huntingWindow: BrowserWindow | null = null;
let huntingView: WebContentsView | null = null;
let activeHuntingSession: Session | null = null;
let huntingModeEnabled = true;
const hunterCandidates = new HunterCandidateStore();
let downloader: Downloader;
let downloadQueue: DownloadQueue;
let library: LibraryRepository;
let player: PlayerService;
let companion: CompanionServer;
let logs: LogStore;
let lastPlaybackItemId: number | null = null;

const projectRoot = resolve(__dirname, '..', '..');
const hunterToolbarHeight = 54;
const publishedHunterCaptureUrls = new Set<string>();
const smokeTestOutput = process.argv.find((argument) => argument.startsWith('--smoke-test='))?.slice('--smoke-test='.length);
const hunterSmokeOutput = process.argv.find((argument) => argument.startsWith('--hunter-smoke='))?.slice('--hunter-smoke='.length);

function publishCapture(capture: CapturedMedia): void {
  logs.write('INFO', `Captured media endpoint: ${capture.url}`);
  mainWindow?.webContents.send('hunt:captured', capture);
  if (hunterSmokeOutput) {
    writeFileSync(hunterSmokeOutput, JSON.stringify(capture, null, 2));
    setTimeout(() => app.exit(0), 100);
  }
}

async function addHuntingSessionCookies(capture: CapturedMedia): Promise<CapturedMedia> {
  const headers = { ...capture.requestHeaders };
  const currentSession = activeHuntingSession;
  if (!currentSession) return { ...capture, requestHeaders: headers };
  try {
    const cookies = await currentSession.cookies.get({ url: capture.url });
    if (cookies.length > 0) {
      const cookieHeader = cookies
        .map((cookie) => `${cookie.name.replace(/[\r\n;]/g, '')}=${cookie.value.replace(/[\r\n;]/g, '')}`)
        .join('; ');
      const existingCookieName = Object.keys(headers)
        .find((name) => name.toLowerCase() === 'cookie');
      if (existingCookieName && existingCookieName !== 'Cookie') delete headers[existingCookieName];
      headers.Cookie = cookieHeader;
    }
  } catch (error) {
    logs.write('WARN', `Could not attach Hunter session cookies: ${String(error)}`);
  }
  return { ...capture, requestHeaders: headers };
}

/**
 * A Hunter capture is deliberately an automatic review-queue event.  The user
 * has already played the media in the isolated Chromium session; format and
 * quality are chosen later on the corresponding queue row.  Never use the
 * iframe/embed URL as a candidate: captureMedia only reaches here after the
 * response body has proved it is an HLS media playlist or a DASH manifest.
 */
async function publishLatestHunterCandidate(): Promise<void> {
  if (!huntingModeEnabled) return;
  const candidate = hunterCandidates.takeLatest();
  if (!candidate) return;
  const key = candidate.url;
  if (publishedHunterCaptureUrls.has(key)) return;
  publishedHunterCaptureUrls.add(key);
  try {
    const capture = await addHuntingSessionCookies(candidate);
    const contextHeaders = new Set(Object.keys(capture.requestHeaders).map((name) => name.toLowerCase()));
    logs.write(
      'INFO',
      `Hunter added verified playing stream to review queue (cookie=${contextHeaders.has('cookie') ? 'yes' : 'no'}, origin=${contextHeaders.has('origin') ? 'yes' : 'no'}, referer=${capture.referer ? 'yes' : 'no'}).`,
    );
    publishCapture({ ...capture, format: 'mp4', quality: '1080' });
    publishHunterNavigationState();
  } catch (error) {
    publishedHunterCaptureUrls.delete(key);
    logs.write('WARN', `Hunter could not add detected stream to the review queue: ${String(error)}`);
  }
}

function publishQueue(tasks: DownloadTask[]): void {
  mainWindow?.webContents.send('queue:changed', tasks);
  companion?.publish('downloads', { downloads: tasks });
}

function publishLibrary(): void {
  const items = library.list();
  mainWindow?.webContents.send('library:changed', items);
  companion?.publish('library', { items });
}

function publishPlayer(state: PlaybackState): void {
  if (state.status === 'idle') lastPlaybackItemId = null;
  if (state.status === 'playing' && state.itemId !== null && state.itemId !== lastPlaybackItemId) {
    const item = library.list(2_000).find((candidate) => candidate.id === state.itemId);
    if (item) {
      library.markPlayed(item.localPath);
      publishLibrary();
    }
    lastPlaybackItemId = state.itemId;
  }
  mainWindow?.webContents.send('player:changed', state);
  companion?.publish('player', { player: state });
}

function playbackItem(item: LibraryItem): PlaybackQueueItem {
  return {
    id: item.id,
    title: item.title,
    localPath: item.localPath,
    format: item.format,
  };
}

async function playLibraryItem(id: number): Promise<void> {
  const items = library.list(2_000);
  const item = items.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`Library item ${id} was not found.`);
  const audio = item.format === 'mp3';
  const playlist = items
    .filter((candidate) => (candidate.format === 'mp3') === audio)
    .map(playbackItem);
  await player.play(item.localPath, playbackItem(item), playlist);
}

function runHunterSmokeFixture(): void {
  const server = createServer((request, response) => {
    if (request.url === '/not-a-playlist') {
      // A player shell can lie about its MIME type. Hunter must inspect the
      // response body and never expose this endpoint as a download.
      response.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      response.end('<!doctype html><title>Embed shell, not media</title>');
      return;
    }
    if (request.url?.startsWith('/playlist')) {
      response.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      response.end('#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:4\n#EXTINF:4.000,\nsegment-0001.ts\n#EXT-X-ENDLIST\n');
      return;
    }
    if (request.url === '/iframe-player') {
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Set-Cookie': 'hunter_session=smoke-secret; Path=/; SameSite=Lax',
      });
      response.end('<!doctype html><script>Promise.all([fetch("/not-a-playlist"), fetch("/playlist?type=hls", {headers:{"X-Hunter-Smoke":"yes"}})])</script>');
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    const fixturePort = (server.address() as AddressInfo | null)?.port;
    response.end(request.url === '/target'
      ? `<!doctype html><title>Smoke Test Movie</title><iframe src="http://localhost:${fixturePort}/iframe-player"></iframe>`
      : '<!doctype html><title>Hunter smoke start</title>');
  });
  server.listen(0, () => {
    const address = server.address() as AddressInfo;
    const fixtureOrigin = `http://127.0.0.1:${address.port}`;
    openHuntingWindow(`${fixtureOrigin}/`);
    huntingWindow?.webContents.once('did-finish-load', () => {
      void huntingWindow?.webContents.executeJavaScript(`
        (async () => {
          const toggle = document.getElementById('hunter-mode');
          const waitForMode = async (enabled) => {
            for (let attempt = 0; attempt < 40; attempt += 1) {
              if ((await window.hunterNavigation.getState()).hunting === enabled) return;
              await new Promise((resolve) => setTimeout(resolve, 25));
            }
            throw new Error('Hunter mode did not change during smoke test.');
          };
          await window.hunterNavigation.navigate('http://127.0.0.1:65530');
          toggle.click();
          await waitForMode(false);
          toggle.click();
          await waitForMode(true);
          document.getElementById('hunter-address').value = ${JSON.stringify(`${fixtureOrigin}/target`)};
          document.getElementById('hunter-address-form').requestSubmit();
          for (let attempt = 0; attempt < 120; attempt += 1) {
            const state = await window.hunterNavigation.getState();
            if (state.downloadReady) {
              if (state.candidateCount !== 1) throw new Error('Hunter accepted a non-playlist response.');
              // A verified stream is sent to the review queue automatically;
              // the main process writes hunterSmokeOutput and exits.
              return;
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          throw new Error('Hunter did not expose a downloadable media candidate.');
        })();
      `);
    });
    huntingView?.webContents.on('did-finish-load', () => {
      if (huntingView?.webContents.getURL() === `${fixtureOrigin}/target`) {
        // Reproduce an embedded cross-site player: playback belongs to the
        // parent while the manifest is requested from an OOPIF.
        hunterCandidates.markPlaying(huntingView.webContents.id);
        void publishLatestHunterCandidate();
      }
    });
  });
  app.once('before-quit', () => server.close());
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    title: 'MediaSteru',
    backgroundColor: '#0d1117',
    autoHideMenuBar: true,
    show: false,
    icon: join(__dirname, 'renderer', 'logo.png'),
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  void mainWindow.loadFile(join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    if (!smokeTestOutput) mainWindow?.show();
  });
  if (smokeTestOutput) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        void mainWindow?.webContents.executeJavaScript(`
          document.querySelector('[data-view="library"]').click();
          const libraryVisible = !document.getElementById('library-view').hidden;
          document.querySelector('[data-view="downloads"]').click();
          document.getElementById('download-button').click();
          new Promise(resolve => setTimeout(
            () => resolve({
              libraryVisible,
              statusText: document.getElementById('status-text').textContent
            }), 50
          ));
        `).then((result: unknown) => {
          const smoke = result as { libraryVisible?: boolean; statusText?: string };
          if (!smoke.libraryVisible || smoke.statusText !== 'Paste a URL to download directly.') {
            logs.write('ERROR', `Renderer smoke failed: ${JSON.stringify(smoke)}`);
            app.exit(3);
            return Promise.reject(new Error('Renderer smoke failed'));
          }
          return mainWindow!.webContents.capturePage();
        }).then((image) => {
          writeFileSync(smokeTestOutput, image.toPNG());
          app.exit(0);
        }).catch(() => app.exit(3));
      }, 500);
    });
  }
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function parseImportedMedia(filePath: string): ImportedMedia[] {
  const payload = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const movie = root.movie && typeof root.movie === 'object' ? root.movie as Record<string, unknown> : {};
  const movieName = typeof movie.name === 'string' ? movie.name : '';
  const candidates: unknown[] = Array.isArray(payload)
    ? payload
    : Array.isArray(root.items)
      ? root.items
      : Array.isArray(root.episodes)
        ? root.episodes.flatMap((episode) => {
          if (!episode || typeof episode !== 'object') return [];
          const items = (episode as Record<string, unknown>).items;
          return Array.isArray(items) ? items : [];
        })
        : [];

  const result: ImportedMedia[] = [];
  for (const [index, value] of candidates.entries()) {
    if (!value || typeof value !== 'object') continue;
    const item = value as Record<string, unknown>;
    const rawUrl = [item.url, item.m3u8, item.webpage_url].find((candidate) => typeof candidate === 'string');
    if (typeof rawUrl !== 'string') continue;
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      continue;
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) continue;
    const itemName = typeof item.name === 'string' ? item.name : `Item ${index + 1}`;
    result.push({ name: movieName ? `${movieName} — ${itemName}` : itemName, url: parsed.toString() });
  }
  if (result.length === 0) throw new Error('The JSON file does not contain any supported media URLs.');
  return result;
}

function hunterNavigationState(error?: string): HunterNavigationState {
  const { candidateCount, downloadReady } = hunterCandidates.state(huntingModeEnabled);
  if (!huntingView || huntingView.webContents.isDestroyed()) {
    return {
      url: '',
      canGoBack: false,
      canGoForward: false,
      loading: false,
      hunting: huntingModeEnabled,
      candidateCount,
      downloadReady,
      ...(error ? { error } : {}),
    };
  }
  const contents = huntingView.webContents;
  return {
    url: contents.getURL(),
    canGoBack: contents.navigationHistory.canGoBack(),
    canGoForward: contents.navigationHistory.canGoForward(),
    loading: contents.isLoadingMainFrame(),
    hunting: huntingModeEnabled,
    candidateCount,
    downloadReady,
    ...(error ? { error } : {}),
  };
}

function publishHunterNavigationState(error?: string): void {
  if (!huntingWindow || huntingWindow.isDestroyed()) return;
  huntingWindow.webContents.send('hunter:state-changed', hunterNavigationState(error));
}

function layoutHuntingView(): void {
  if (!huntingWindow || huntingWindow.isDestroyed() || !huntingView) return;
  const [width, height] = huntingWindow.getContentSize();
  huntingView.setBounds({
    x: 0,
    y: hunterToolbarHeight,
    width,
    height: Math.max(0, height - hunterToolbarHeight),
  });
}

function hunterDestinationLabel(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname || rawUrl;
  } catch {
    return rawUrl;
  }
}

async function navigateHunterPage(contents: WebContents, rawUrl: string, showNotice = true): Promise<void> {
  const targetUrl = resolveHunterInput(rawUrl);
  try {
    await contents.loadURL(targetUrl);
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : 'unknown';
    if (code === 'ERR_ABORTED') return;
    const destination = hunterDestinationLabel(targetUrl);
    const message = `Could not open ${destination}. The website refused or interrupted the request.`;
    logs.write('WARN', `Hunter navigation failed (${code}) for ${destination}.`);
    publishHunterNavigationState(message);
    if (showNotice && !hunterSmokeOutput && huntingWindow && !huntingWindow.isDestroyed()) {
      await dialog.showMessageBox(huntingWindow, {
        type: 'warning',
        title: 'Could not open page',
        message,
        detail: 'Try the complete website address or reload the page. Some websites reject embedded Chromium sessions.',
        buttons: ['OK'],
        defaultId: 0,
        noLink: true,
      });
    }
  }
}

function openHuntingWindow(targetUrl: string): void {
  if (huntingWindow && !huntingWindow.isDestroyed() && huntingView && !huntingView.webContents.isDestroyed()) {
    huntingWindow.focus();
    void navigateHunterPage(huntingView.webContents, targetUrl);
    return;
  }

  const partition = `hunt-${Date.now()}`;
  huntingModeEnabled = true;
  publishedHunterCaptureUrls.clear();
  const huntingSession = session.fromPartition(partition, { cache: false });
  activeHuntingSession = huntingSession;
  const popupWindows = new Set<BrowserWindow>();
  const chromeMajor = process.versions.chrome.split('.')[0];
  const userAgentPlatform = process.platform === 'win32'
    ? 'Windows NT 10.0; Win64; x64'
    : process.platform === 'darwin'
      ? 'Macintosh; Intel Mac OS X 10_15_7'
      : 'X11; Linux x86_64';
  const clientHintPlatform = process.platform === 'win32'
    ? 'Windows'
    : process.platform === 'darwin'
      ? 'macOS'
      : 'Linux';
  const hunterUserAgent = `Mozilla/5.0 (${userAgentPlatform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
  const hunterClientHints = `"Chromium";v="${chromeMajor}", "Google Chrome";v="${chromeMajor}", "Not_A Brand";v="99"`;

  huntingSession.setUserAgent(hunterUserAgent, 'en-US,en');
  hunterCandidates.clear();

  huntingSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    logs.write('WARN', `Blocked Hunter permission request: ${permission}`);
    callback(false);
  });

  const setRequestHeader = (
    headers: Record<string, string | string[]>,
    name: string,
    value: string,
  ): void => {
    const existingName = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
    headers[existingName ?? name] = value;
  };

  const safeRequestTarget = (rawUrl: string): string => {
    try {
      const parsed = new URL(rawUrl);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return 'unknown destination';
    }
  };

  const captureMedia = (
    url: string,
    referer: string | undefined,
    headers: Record<string, string>,
    sourceWebContentsId: number | undefined,
    manifestBody?: string,
    title?: string,
  ): void => {
    if (!isValidMediaCandidateUrl(url)) return;
    // Keep a defensive owner fallback for cross-origin/OOPIF player traffic.
    // The temporary Hunter session belongs exclusively to this window.
    const ownerContentsId = sourceWebContentsId ?? huntingView?.webContents.id;
    if (ownerContentsId === undefined) return;
    if (!hunterCandidates.add({ url, title, referer, requestHeaders: headers, manifestBody }, ownerContentsId)) return;
    logs.write('INFO', `Hunter detected a media candidate at ${safeRequestTarget(url)}.`);
    publishHunterNavigationState();
    void publishLatestHunterCandidate();
  };

  interface DebuggerRequestContext {
    url: string;
    referer?: string;
    headers: Record<string, string>;
    mimeType?: string;
    resourceType?: string;
    debuggerSessionId?: string;
  }

  const debuggerObject = (value: unknown): Record<string, unknown> => (
    value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
  );
  const debuggerHeaders = (value: unknown): Record<string, string> => Object.fromEntries(
    Object.entries(debuggerObject(value))
      .filter((entry): entry is [string, string | number | boolean] => (
        ['string', 'number', 'boolean'].includes(typeof entry[1])
      ))
      .map(([name, headerValue]) => [name, String(headerValue)]),
  );
  const findHeader = (headers: Record<string, string>, name: string): string | undefined => (
    Object.entries(headers).find(([candidate]) => candidate.toLowerCase() === name.toLowerCase())?.[1]
  );
  const watchNetworkWithDebugger = (contents: WebContents): void => {
    const requests = new Map<string, DebuggerRequestContext>();
    const pendingExtraHeaders = new Map<string, Record<string, string>>();
    const requestKey = (requestId: string, debuggerSessionId?: string): string => (
      `${debuggerSessionId ?? 'root'}:${requestId}`
    );
    const enableNetwork = (debuggerSessionId?: string): void => {
      void contents.debugger.sendCommand('Network.enable', {}, debuggerSessionId).catch((error: unknown) => {
        logs.write('WARN', `Hunter network inspection could not start: ${String(error)}`);
      });
    };
    try {
      if (!contents.debugger.isAttached()) contents.debugger.attach('1.3');
      enableNetwork();
      void contents.debugger.sendCommand('Target.setAutoAttach', {
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true,
      }).catch((error: unknown) => {
        logs.write('WARN', `Hunter iframe inspection could not start: ${String(error)}`);
      });
    } catch (error) {
      logs.write('WARN', `Hunter network fallback is unavailable: ${String(error)}`);
      return;
    }

    contents.debugger.on('message', (_event, method, rawParams, debuggerSessionId) => {
      const params = debuggerObject(rawParams);
      if (method === 'Target.attachedToTarget') {
        const childSessionId = typeof params.sessionId === 'string' ? params.sessionId : undefined;
        if (childSessionId) enableNetwork(childSessionId);
        return;
      }
      if (method === 'Target.detachedFromTarget') {
        const childSessionId = typeof params.sessionId === 'string' ? params.sessionId : '';
        if (childSessionId) {
          for (const key of requests.keys()) if (key.startsWith(`${childSessionId}:`)) requests.delete(key);
          for (const key of pendingExtraHeaders.keys()) if (key.startsWith(`${childSessionId}:`)) pendingExtraHeaders.delete(key);
        }
        return;
      }
      if (method === 'Network.requestWillBeSent') {
        const requestId = typeof params.requestId === 'string' ? params.requestId : '';
        const request = debuggerObject(params.request);
        const url = typeof request.url === 'string' ? request.url : '';
        if (!requestId || !url) return;
        const key = requestKey(requestId, debuggerSessionId);
        const headers = debuggerHeaders(request.headers);
        Object.assign(headers, pendingExtraHeaders.get(key) ?? {});
        pendingExtraHeaders.delete(key);
        const documentUrl = typeof params.documentURL === 'string' ? params.documentURL : undefined;
        const referer = findHeader(headers, 'referer') ?? documentUrl;
        requests.set(key, { url, referer, headers, debuggerSessionId });
        return;
      }

      if (method === 'Network.requestWillBeSentExtraInfo') {
        const requestId = typeof params.requestId === 'string' ? params.requestId : '';
        if (!requestId) return;
        const key = requestKey(requestId, debuggerSessionId);
        const headers = debuggerHeaders(params.headers);
        const request = requests.get(key);
        if (request) {
          Object.assign(request.headers, headers);
          request.referer = findHeader(request.headers, 'referer') ?? request.referer;
        } else {
          pendingExtraHeaders.set(key, headers);
        }
        return;
      }

      if (method === 'Network.responseReceived') {
        const requestId = typeof params.requestId === 'string' ? params.requestId : '';
        const key = requestKey(requestId, debuggerSessionId);
        const response = debuggerObject(params.response);
        const request = requests.get(key);
        const url = typeof response.url === 'string' ? response.url : request?.url ?? '';
        const mimeType = typeof response.mimeType === 'string' ? response.mimeType : '';
        const resourceType = typeof params.type === 'string' ? params.type : undefined;
        if (!url) return;
        if (request) {
          request.url = url;
          request.mimeType = mimeType;
          request.resourceType = resourceType;
        } else {
          requests.set(key, { url, headers: {}, mimeType, resourceType, debuggerSessionId });
        }
        return;
      }

      if (method === 'Network.loadingFinished') {
        const requestId = typeof params.requestId === 'string' ? params.requestId : '';
        const key = requestKey(requestId, debuggerSessionId);
        const request = requests.get(key);
        requests.delete(key);
        pendingExtraHeaders.delete(key);
        if (!requestId || !request || !huntingModeEnabled) return;
        const encodedLength = typeof params.encodedDataLength === 'number' ? params.encodedDataLength : 0;
        if (!shouldInspectResponseBody(request.url, request.resourceType, request.mimeType, encodedLength)) return;
        const explicitlySignalled = looksLikeStreamUrl(request.url)
          || (request.mimeType ?? '').toLowerCase().includes('mpegurl')
          || (request.mimeType ?? '').toLowerCase().includes('application/dash+xml');
        void contents.debugger.sendCommand('Network.getResponseBody', { requestId }, request.debuggerSessionId)
          .then((rawBody: unknown) => {
            if (!huntingModeEnabled || contents.isDestroyed()) return;
            const result = debuggerObject(rawBody);
            const body = typeof result.body === 'string'
              ? decodeDebuggerBody(result.body, result.base64Encoded === true)
              : '';
            const hlsManifest = isHlsManifestBody(body);
            const hlsMediaPlaylist = isHlsMediaPlaylistBody(body);
            const dashManifest = isDashManifestBody(body);
            if (!hlsMediaPlaylist && !dashManifest) {
              if (hlsManifest) {
                logs.write('INFO', `Hunter ignored an HLS control playlist at ${safeRequestTarget(request.url)} and is waiting for its media playlist.`);
              } else if (explicitlySignalled) {
                logs.write('INFO', `Hunter ignored a non-manifest response at ${safeRequestTarget(request.url)}.`);
              }
              return;
            }
            // Media HLS is snapshotted so a one-shot/token endpoint never has
            // to be requested a second time. DASH remains a validated URL capture;
            // rewriting every SegmentTemplate safely needs a DASH-aware parser.
            captureMedia(
              request.url,
              request.referer,
              request.headers,
              contents.id,
              hlsMediaPlaylist ? body : undefined,
              contents.getTitle() || hunterDestinationLabel(contents.getURL()),
            );
          })
          .catch((error: unknown) => {
            logs.write('WARN', `Hunter could not inspect a manifest response at ${safeRequestTarget(request.url)}: ${String(error)}`);
          });
        return;
      }

      if (method === 'Network.loadingFailed') {
        const requestId = typeof params.requestId === 'string' ? params.requestId : '';
        if (requestId) {
          const key = requestKey(requestId, debuggerSessionId);
          requests.delete(key);
          pendingExtraHeaders.delete(key);
        }
      }
    });
    contents.once('destroyed', () => {
      requests.clear();
      pendingExtraHeaders.clear();
    });
  };

  huntingSession.webRequest.onBeforeSendHeaders({ urls: ['*://*/*'] }, (details, callback) => {
    setRequestHeader(details.requestHeaders, 'User-Agent', hunterUserAgent);
    setRequestHeader(details.requestHeaders, 'sec-ch-ua', hunterClientHints);
    setRequestHeader(details.requestHeaders, 'sec-ch-ua-mobile', '?0');
    setRequestHeader(details.requestHeaders, 'sec-ch-ua-platform', `"${clientHintPlatform}"`);
    callback({ requestHeaders: details.requestHeaders });
  });
  huntingSession.webRequest.onCompleted({ urls: ['*://*/*'] }, (details) => {
    if (details.resourceType === 'subFrame' && details.statusCode >= 400) {
      logs.write('WARN', `Hunter frame was rejected with HTTP ${details.statusCode}: ${safeRequestTarget(details.url)}`);
    }
  });
  huntingSession.webRequest.onErrorOccurred({ urls: ['*://*/*'] }, (details) => {
    if (details.resourceType === 'subFrame') {
      logs.write('WARN', `Hunter frame failed (${details.error}): ${safeRequestTarget(details.url)}`);
    }
  });

  huntingWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 500,
    title: 'Video Hunter',
    backgroundColor: '#10151d',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, 'hunter-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  huntingView = new WebContentsView({
    webPreferences: {
      session: huntingSession,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const pageView = huntingView;
  huntingWindow.contentView.addChildView(pageView);
  layoutHuntingView();
  huntingWindow.on('resize', layoutHuntingView);

  const publishState = (): void => publishHunterNavigationState();
  const watchMediaPlayback = (contents: WebContents): void => {
    contents.on('media-started-playing', () => {
      hunterCandidates.markPlaying(contents.id);
      publishHunterNavigationState();
      void publishLatestHunterCandidate();
    });
  };
  watchMediaPlayback(pageView.webContents);
  watchNetworkWithDebugger(pageView.webContents);
  pageView.webContents.on('did-start-loading', publishState);
  pageView.webContents.on('did-stop-loading', publishState);
  pageView.webContents.on('did-navigate', publishState);
  pageView.webContents.on('did-navigate-in-page', publishState);
  pageView.webContents.on('did-start-navigation', (_event, _url, _isInPlace, isMainFrame) => {
    if (!isMainFrame) return;
    hunterCandidates.clear();
    publishHunterNavigationState();
  });
  pageView.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedUrl, isMainFrame) => {
    if (isMainFrame && errorCode !== -3) publishHunterNavigationState(errorDescription);
  });

  const displayOrigin = (rawUrl: string): string => {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol === 'about:' || parsed.protocol === 'blob:') return 'a new browser window';
      return parsed.hostname || 'this page';
    } catch {
      return 'this page';
    }
  };

  const configurePopupPolicy = (contents: WebContents): void => {
    contents.setWindowOpenHandler(({ url }) => {
      let protocol: string;
      try {
        protocol = new URL(url).protocol;
      } catch {
        logs.write('WARN', 'Blocked Hunter popup with an invalid destination.');
        return { action: 'deny' };
      }
      if (!['http:', 'https:', 'about:', 'blob:'].includes(protocol)) {
        logs.write('WARN', `Blocked Hunter popup protocol: ${protocol}`);
        return { action: 'deny' };
      }

      const source = displayOrigin(contents.getURL());
      const destination = displayOrigin(url);
      const opensInHunterTab = ['http:', 'https:'].includes(protocol);
      const promptOptions: Electron.MessageBoxSyncOptions = {
        type: 'warning',
        title: opensInHunterTab ? 'Open in Hunter?' : 'Open Hunter popup?',
        message: `${source} wants to open ${destination}.`,
        detail: opensInHunterTab
          ? 'Only continue if you started this action. MediaSteru will open it in the current Hunter tab and keep watching the playing page for verified media streams.'
          : 'Only open it if you started this action. MediaSteru will keep the window sandboxed and continue watching it for media streams.',
        buttons: ['Block', opensInHunterTab ? 'Open here' : 'Open'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      };
      const promptResult = hunterSmokeOutput
        ? 1
        : huntingWindow
          ? dialog.showMessageBoxSync(huntingWindow, promptOptions)
          : dialog.showMessageBoxSync(promptOptions);
      const allowPopup = promptResult === 1;

      if (!allowPopup) {
        logs.write('INFO', `Blocked Hunter popup from ${source} to ${destination}.`);
        return { action: 'deny' };
      }

      if (opensInHunterTab && !hunterSmokeOutput) {
        logs.write('INFO', `Opening Hunter destination in the current tab: ${destination}.`);
        setTimeout(() => {
          if (!contents.isDestroyed()) void navigateHunterPage(contents, url, false);
        }, 0);
        return { action: 'deny' };
      }

      logs.write('INFO', `Allowed Hunter popup from ${source} to ${destination}.`);
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1120,
          height: 760,
          minWidth: 640,
          minHeight: 420,
          title: 'MediaSteru Hunter',
          backgroundColor: '#10151d',
          autoHideMenuBar: true,
          parent: huntingWindow ?? undefined,
          webPreferences: {
            session: huntingSession,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        },
      };
    });
    contents.on('did-create-window', (popup) => {
      const popupContentsId = popup.webContents.id;
      popupWindows.add(popup);
      popup.setMenuBarVisibility(false);
      watchMediaPlayback(popup.webContents);
      watchNetworkWithDebugger(popup.webContents);
      configurePopupPolicy(popup.webContents);
      popup.on('closed', () => {
        popupWindows.delete(popup);
        hunterCandidates.removeSource(popupContentsId);
        publishHunterNavigationState();
      });
    });
  };
  configurePopupPolicy(pageView.webContents);

  void huntingWindow.loadFile(join(__dirname, 'renderer', 'hunter.html'));
  huntingWindow.once('ready-to-show', () => {
    if (!hunterSmokeOutput) huntingWindow?.show();
  });
  huntingWindow.on('closed', () => {
    hunterCandidates.clear();
    publishedHunterCaptureUrls.clear();
    for (const popup of popupWindows) {
      if (!popup.isDestroyed()) popup.close();
    }
    popupWindows.clear();
    if (!pageView.webContents.isDestroyed()) pageView.webContents.close();
    void huntingSession.clearStorageData();
    void huntingSession.clearCache();
    huntingView = null;
    huntingWindow = null;
    if (activeHuntingSession === huntingSession) activeHuntingSession = null;
    mainWindow?.webContents.send('hunt:closed');
  });
  void navigateHunterPage(pageView.webContents, targetUrl, false);
}

function installIpcHandlers(): void {
  ipcMain.handle('folder:choose', async () => {
    const options: Electron.OpenDialogOptions = {
      title: 'Choose download folder',
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle('import:list', async () => {
    const options: Electron.OpenDialogOptions = {
      title: 'Import a media list',
      properties: ['openFile'],
      filters: [{ name: 'JSON files', extensions: ['json'] }],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return [];
    return parseImportedMedia(result.filePaths[0]);
  });
  ipcMain.handle('clipboard:read', () => clipboard.readText());
  ipcMain.handle('clipboard:write', (_event, value: string) => clipboard.writeText(value));
  ipcMain.handle('hunt:open', (_event, rawUrl: string) => {
    const value = rawUrl?.trim() || 'https://www.google.com';
    openHuntingWindow(resolveHunterInput(value));
  });
  const requireHunterToolbar = (senderId: number): WebContentsView => {
    if (!huntingWindow || huntingWindow.isDestroyed() || huntingWindow.webContents.id !== senderId) {
      throw new Error('Hunter navigation is available only from the Hunter toolbar.');
    }
    if (!huntingView || huntingView.webContents.isDestroyed()) throw new Error('Hunter page is not available.');
    return huntingView;
  };
  ipcMain.handle('hunter:state', (event) => {
    requireHunterToolbar(event.sender.id);
    return hunterNavigationState();
  });
  ipcMain.handle('hunter:navigate', async (event, rawUrl: string) => {
    const view = requireHunterToolbar(event.sender.id);
    await navigateHunterPage(view.webContents, rawUrl);
  });
  ipcMain.handle('hunter:back', (event) => {
    const contents = requireHunterToolbar(event.sender.id).webContents;
    if (contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
  });
  ipcMain.handle('hunter:forward', (event) => {
    const contents = requireHunterToolbar(event.sender.id).webContents;
    if (contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward();
  });
  ipcMain.handle('hunter:reload', (event) => {
    requireHunterToolbar(event.sender.id).webContents.reload();
  });
  ipcMain.handle('hunter:set-mode', (event, enabled: boolean) => {
    requireHunterToolbar(event.sender.id);
    huntingModeEnabled = Boolean(enabled);
    if (!huntingModeEnabled) hunterCandidates.clearPlayback();
    logs.write('INFO', `Hunter mode ${huntingModeEnabled ? 'enabled' : 'disabled'}.`);
    publishHunterNavigationState();
    return hunterNavigationState();
  });
  ipcMain.handle('download:start', (_event, request: EnqueueDownloadRequest) => downloadQueue.enqueue(request, false));
  ipcMain.handle('download:start-selected', (_event, ids: string[]) => downloadQueue.start(ids));
  ipcMain.handle('download:update-options', (_event, id: string, options: DownloadTaskOptions) => {
    if (!options || !['mp4', 'mkv', 'mp3'].includes(options.format)
      || !['360', '720', '1080', '1440', '2160', 'best'].includes(options.quality)) {
      throw new Error('Unsupported download options.');
    }
    return downloadQueue.updateOptions(id, options);
  });
  ipcMain.handle('download:list', () => downloadQueue.list());
  ipcMain.handle('download:cancel', (_event, id: string) => downloadQueue.cancel(id));
  ipcMain.handle('download:pause', (_event, id: string) => downloadQueue.pause(id));
  ipcMain.handle('download:resume', (_event, id: string) => downloadQueue.resume(id));
  ipcMain.handle('download:remove', (_event, id: string) => downloadQueue.remove(id));
  ipcMain.handle('download:retry', (_event, id: string) => downloadQueue.retry(id));
  ipcMain.handle('library:list', () => library.list());
  ipcMain.handle('media:play', async (_event, localPath: string) => {
    const item = library.list(2_000).find((candidate) => candidate.localPath === localPath);
    if (!item) throw new Error('This file is not present in the MediaSteru library.');
    await playLibraryItem(item.id);
  });
  ipcMain.handle('player:state', () => player.state());
  ipcMain.handle('player:command', async (_event, rawCommand: string) => {
    if (!['toggle', 'next', 'previous', 'stop'].includes(rawCommand)) {
      throw new Error('Unsupported playback command.');
    }
    return player.command(rawCommand as PlaybackCommand);
  });
  ipcMain.handle('media:show', (_event, localPath: string) => shell.showItemInFolder(localPath));
  ipcMain.handle('tools:status', () => {
    const status = { ...downloader.toolStatus(), mpv: player.path() };
    if (!status.ytDlp || !status.ffmpeg) {
      logs.write('ERROR', `Missing components: yt-dlp=${status.ytDlp ?? 'not found'}, ffmpeg=${status.ffmpeg ?? 'not found'}`);
    }
    if (!status.deno) logs.write('WARN', 'Deno was not found; some YouTube formats may be unavailable.');
    return status;
  });
  ipcMain.handle('dialog:notice', async (event, rawMessage: string, rawKind: string) => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.id !== event.sender.id) {
      throw new Error('Dialogs are available only from the MediaSteru window.');
    }
    const kind = rawKind === 'error' ? 'error' : 'warning';
    const message = String(rawMessage || (kind === 'error' ? 'An unexpected error occurred.' : 'Action required.')).slice(0, 2_000);
    if (smokeTestOutput) return;
    await dialog.showMessageBox(mainWindow, {
      type: kind,
      title: kind === 'error' ? 'MediaSteru Error' : 'MediaSteru',
      message,
      buttons: ['OK'],
      defaultId: 0,
      noLink: true,
    });
  });
  ipcMain.handle('runtime:info', () => ({
    platform: process.platform,
    arch: process.arch,
    sessionType: process.env.XDG_SESSION_TYPE ?? null,
    waylandDisplay: process.env.WAYLAND_DISPLAY ?? null,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  }));
}

app.whenReady().then(() => {
  logs = new LogStore(app.getPath('userData'));
  logs.write('INFO', `Starting Electron ${process.versions.electron}; session=${process.env.XDG_SESSION_TYPE ?? 'unknown'}`);
  downloader = new Downloader(
    projectRoot,
    process.resourcesPath,
    (event) => downloadQueue.handleEngineEvent(event),
    (level, message) => {
      logs.write(level, message);
      mainWindow?.webContents.send('diagnostic:line', { level, message });
    },
  );
  library = new LibraryRepository(app.getPath('userData'));
  player = new PlayerService(projectRoot, process.resourcesPath, publishPlayer);
  downloadQueue = new DownloadQueue(
    downloader,
    publishQueue,
    (task) => {
      library.recordDownload(task);
      publishLibrary();
    },
  );
  companion = new CompanionServer(
    publishCapture,
    (level, message) => logs.write(level, message),
    {
      listDownloads: () => downloadQueue.list(),
      enqueueDownload: (request) => downloadQueue.enqueue(request),
      cancelDownload: (id) => downloadQueue.cancel(id),
      pauseDownload: (id) => downloadQueue.pause(id),
      resumeDownload: (id) => downloadQueue.resume(id),
      retryDownload: (id) => downloadQueue.retry(id),
      listLibrary: () => library.list(2_000),
      playLibraryItem,
      playerState: () => player.state(),
      controlPlayer: (command) => player.command(command),
      defaultDownloadPath: () => app.getPath('downloads'),
    },
  );
  companion.start();
  installIpcHandlers();
  createMainWindow();
  if (hunterSmokeOutput) runHunterSmokeFixture();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  companion?.close();
  player?.close();
  library?.close();
});
