package com.mediasteru.controller;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.nio.file.Files;

public class ExtensionManager {
	private static final String EXTENSION_VERSION = "2.2";

	public static String getExtensionPath() {
		String baseExtDir = System.getProperty("user.home") + File.separator + ".MediaSteru" + File.separator
				+ "Extension" + File.separator + "chromium";
		File dir = new File(baseExtDir);
		File versionFile = new File(dir, ".version");
		boolean needsRegen = !dir.exists() || !versionFile.exists() || !readFile(versionFile).equals(EXTENSION_VERSION);

		if (needsRegen) {
			dir.mkdirs();
			System.out.println("[ExtensionManager] Generating Chromium extension v" + EXTENSION_VERSION + "...");
			try {
				writeFile(new File(dir, "manifest.json"), buildChromiumManifest());
				writeFile(new File(dir, "background.js"), buildBackground());
				writeFile(new File(dir, "content.js"), buildContentScript());
				writeFile(versionFile, EXTENSION_VERSION);
			} catch (Exception e) {
				System.err.println("[ExtensionManager] Failed to write extension: " + e.getMessage());
			}
		}
		return baseExtDir;
	}

	private static String readFile(File f) {
		try {
			return Files.readString(f.toPath()).trim();
		} catch (IOException e) {
			return "";
		}
	}

	private static void writeFile(File f, String content) throws IOException {
		try (FileWriter fw = new FileWriter(f)) {
			fw.write(content);
		}
	}

	private static String buildChromiumManifest() {
		return """
				{
				  "manifest_version": 3,
				  "name": "MediaSteru Hunter",
				  "version": "%s",
				  "permissions": ["webRequest", "tabs", "storage"],
				  "host_permissions": ["<all_urls>"],
				  "background": { "service_worker": "background.js" }
				}
				""".formatted(EXTENSION_VERSION);
	}

	private static String buildBackground() {
		return """
				const CAPTURE_URL = 'http://localhost:8765/capture';
				const requestHeadersByUrl = new Map();
				const dispatched = new Set();
				const browserApi = chrome;
				const candidateKey = tabId => `candidate:${tabId}`;
				const playingKey = tabId => `playing:${tabId}`;

				function rememberRequestHeaders(details) {
				    const headers = {};
				    (details.requestHeaders || []).forEach(header => {
				        if (header.name && header.value != null) headers[header.name] = header.value;
				    });
				    requestHeadersByUrl.set(details.url, headers);
				    setTimeout(() => requestHeadersByUrl.delete(details.url), 30000);
				}

				async function sessionValue(key, fallback) {
				    const stored = await browserApi.storage.session.get(key);
				    return stored[key] == null ? fallback : stored[key];
				}

				function notifyTab(tabId, message) {
				    if (tabId == null || tabId < 0) return;
				    browserApi.tabs.sendMessage(tabId, message, () => void browserApi.runtime.lastError);
				}

				async function dispatchCandidate(candidate, tabId) {
				    const key = `${tabId}:${candidate.url}`;
				    if (dispatched.has(key)) return;
				    dispatched.add(key);
				    try {
				        const response = await fetch(CAPTURE_URL, {
				            method: 'POST',
				            headers: { 'Content-Type': 'application/json' },
				            body: JSON.stringify({
				                url: candidate.url,
				                referer: candidate.referer,
				                headers: candidate.headers
				            })
				        });
				        if (!response.ok) throw new Error('MediaSteru rejected the stream.');
				        console.log('[Hunter] Added detected stream to MediaSteru queue:', candidate.url);
				    } catch (error) {
				        dispatched.delete(key);
				        console.log('[Hunter] Local server is offline or rejected the stream');
				    }
				}

				async function rememberCandidate(url, tabId, referer, headerOverride) {
				    if (tabId == null || tabId < 0) return;
				    const key = candidateKey(tabId);
				    const candidates = await sessionValue(key, []);
				    if (candidates.some(candidate => candidate.url === url)) return;
				    const candidate = {
				        url,
				        referer: referer || '',
				        headers: headerOverride || requestHeadersByUrl.get(url) || {},
				        detectedAt: Date.now()
				    };
				    candidates.push(candidate);
				    await browserApi.storage.session.set({ [key]: candidates.slice(-24) });
				    console.log('[Hunter] Media candidate:', url);
				    // The Java queue is the review surface. Do not require an overlay
				    // button inside an untrusted playback page before surfacing a stream.
				    void dispatchCandidate(candidate, tabId);
				    if (await sessionValue(playingKey(tabId), false)) {
				        notifyTab(tabId, { type: 'MEDIASTERU_CANDIDATE', count: candidates.length });
				    }
				}

				async function sendLatestCandidate(tabId) {
				    const key = candidateKey(tabId);
				    const candidates = await sessionValue(key, []);
				    const candidate = candidates[candidates.length - 1];
				    if (!candidate) return { ok: false, error: 'No media stream is available.' };
				    try {
				        const response = await fetch(CAPTURE_URL, {
				        method: 'POST',
				        headers: { 'Content-Type': 'application/json' },
				        body: JSON.stringify({
				            url: candidate.url,
				            referer: candidate.referer,
				            headers: candidate.headers
				        })
				        });
				        if (!response.ok) return { ok: false, error: 'MediaSteru rejected the stream.' };
				        await browserApi.storage.session.remove([key, playingKey(tabId)]);
				        notifyTab(tabId, { type: 'MEDIASTERU_HIDE' });
				        console.log('[Hunter] Sent selected stream:', candidate.url);
				        return { ok: true };
				    } catch (error) {
				        console.log('[Hunter] Local server is offline');
				        return { ok: false, error: 'MediaSteru is not running.' };
				    }
				}

				// ── Listener 1: URL pattern matching (fires before the request leaves) ──────
				function looksLikeStream(url) {
				    const lower = url.toLowerCase();

				    // Direct file-extension check
				    if (lower.includes('.m3u8') || lower.includes('.m3u') || lower.includes('.mpd')) {
				        return !lower.includes('audio-only') && !lower.includes('/preview');
				    }

				    // Query-parameter patterns used by sites that hide stream URLs
				    const qParams = [
				        'format=m3u8', 'type=m3u8', 'format=hls', 'type=hls',
				        'output=m3u8', 'output=hls', 'stream_type=hls',
				        'container=m3u8', 'protocol=hls',
				        'format=mpd', 'type=mpd', 'type=dash'
				    ];
				    if (qParams.some(p => lower.includes(p))) return true;

				    // Path-segment patterns
				    const paths = [
				        '/hls/', '/dash/', '/manifest', '/chunklist',
				        'master.m3u8', 'media.m3u8', 'stream.m3u8',
				        'video.m3u8', 'index.m3u8', 'live.m3u8',
				        'vod.m3u8', 'playlist.m3u8'
				    ];
				    return paths.some(p => lower.includes(p));
				}

				browserApi.webRequest.onBeforeRequest.addListener(
				    function(details) {
				        if (looksLikeStream(details.url)) {
				            const pageUrl = details.documentUrl || details.initiator || details.originUrl || '';
				            setTimeout(() => void rememberCandidate(details.url, details.tabId, pageUrl, null), 100);
				        }
				    },
				    { urls: ['<all_urls>'], types: ['xmlhttprequest', 'media', 'other', 'sub_frame'] }
				);

				browserApi.webRequest.onBeforeSendHeaders.addListener(
				    function(details) {
				        rememberRequestHeaders(details);
				    },
				    { urls: ['<all_urls>'], types: ['xmlhttprequest', 'media', 'other', 'sub_frame'] },
				    ['requestHeaders']
				);

				// ── Listener 2: Content-Type sniffing (catches streams with no .m3u8 in URL) ─
				browserApi.webRequest.onHeadersReceived.addListener(
				    function(details) {
				        if (!details.responseHeaders) return;
				        const ctHeader = details.responseHeaders.find(
				            h => h.name.toLowerCase() === 'content-type'
				        );
				        if (!ctHeader) return;
				        const ct = ctHeader.value.toLowerCase();
				        const streamMimeTypes = [
				            'application/x-mpegurl',
				            'application/vnd.apple.mpegurl',
				            'application/dash+xml'
				        ];
				        if (streamMimeTypes.some(t => ct.includes(t))) {
				            const pageUrl = details.documentUrl || details.initiator || details.originUrl || '';
				            setTimeout(() => void rememberCandidate(details.url, details.tabId, pageUrl, null), 100);
				        }
				    },
				    { urls: ['<all_urls>'], types: ['xmlhttprequest', 'media', 'other', 'sub_frame'] },
				    ['responseHeaders']
				);

				browserApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
				    const tabId = sender.tab && sender.tab.id;
				    if (tabId == null || tabId < 0) return false;
				    if (message && message.type === 'MEDIASTERU_PLAYBACK_STARTED') {
				        (async () => {
				            await browserApi.storage.session.set({ [playingKey(tabId)]: true });
				            const candidates = await sessionValue(candidateKey(tabId), []);
				            if (candidates.length) {
				                notifyTab(tabId, { type: 'MEDIASTERU_CANDIDATE', count: candidates.length });
				            }
				            sendResponse({ ok: true });
				        })();
				        return true;
				    }
				    if (message && message.type === 'MEDIASTERU_DOWNLOAD') {
				        void sendLatestCandidate(tabId).then(sendResponse);
				        return true;
				    }
				    return false;
				});

				browserApi.tabs.onUpdated.addListener((tabId, changeInfo) => {
				    if (changeInfo.status !== 'loading') return;
				    void browserApi.storage.session.remove([candidateKey(tabId), playingKey(tabId)]);
				});

				browserApi.tabs.onRemoved.addListener(tabId => {
				    void browserApi.storage.session.remove([candidateKey(tabId), playingKey(tabId)]);
				});
				""";
	}

	private static String buildContentScript() {
		return """
				(() => {
				    const browserApi = chrome;
				    const isTopFrame = window === window.top;
				    let host = null;
				    let button = null;

				    function ensureButton() {
				        if (!isTopFrame || button) return button;
				        host = document.createElement('div');
				        host.setAttribute('data-mediasteru-hunter', '');
				        const shadow = host.attachShadow({ mode: 'closed' });
				        const style = document.createElement('style');
				        style.textContent = `
				            :host { all: initial; }
				            button {
				                position: fixed; top: 72px; right: 18px; z-index: 2147483647;
				                height: 42px; padding: 0 16px; display: inline-flex; align-items: center;
				                gap: 9px; border: 1px solid #9ae0bd; border-radius: 10px;
				                color: #07150f; background: #69d49f; box-shadow: 0 8px 28px #0008;
				                font: 700 14px/1 system-ui, -apple-system, sans-serif; cursor: pointer;
				            }
				            button:hover { background: #7be0ae; }
				            button:focus-visible { outline: 3px solid #9bb7ff; outline-offset: 2px; }
				            button:disabled { opacity: .7; cursor: wait; }
				            svg { width: 19px; height: 19px; fill: none; stroke: currentColor;
				                  stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
				        `;
				        button = document.createElement('button');
				        button.type = 'button';
				        button.setAttribute('aria-label', 'Download detected video with MediaSteru');
				        button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v10m0 0 4-4m-4 4-4-4"/><path d="M5 19h14"/></svg><span>Download with MediaSteru</span>';
				        button.addEventListener('click', () => {
				            button.disabled = true;
				            browserApi.runtime.sendMessage({ type: 'MEDIASTERU_DOWNLOAD' }, response => {
				                const failed = browserApi.runtime.lastError || !response || !response.ok;
				                button.disabled = false;
				                if (failed) button.title = response && response.error ? response.error : 'Could not send this stream to MediaSteru.';
				            });
				        });
				        shadow.append(style, button);
				        document.documentElement.appendChild(host);
				        return button;
				    }

				    function showButton() {
				        const candidateButton = ensureButton();
				        if (candidateButton) candidateButton.hidden = false;
				    }

				    function hideButton() {
				        if (button) button.hidden = true;
				    }

				    document.addEventListener('play', event => {
				        if (!(event.target instanceof HTMLMediaElement)) return;
				        browserApi.runtime.sendMessage({ type: 'MEDIASTERU_PLAYBACK_STARTED' }, () => void browserApi.runtime.lastError);
				    }, true);

				    browserApi.runtime.onMessage.addListener(message => {
				        if (!message) return;
				        if (message.type === 'MEDIASTERU_CANDIDATE') showButton();
				        if (message.type === 'MEDIASTERU_HIDE') hideButton();
				    });
				})();
				""";
	}
}
