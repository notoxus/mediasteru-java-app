package com.mediasteru.controller;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.nio.file.Files;

public class ExtensionManager {
	private static final String EXTENSION_VERSION = "2.0";

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
				  "name": "Video Hunter (Java Bridge)",
				  "version": "%s",
				  "permissions": ["webRequest", "tabs"],
				  "host_permissions": ["<all_urls>"],
				  "background": { "service_worker": "background.js" }
				}
				""".formatted(EXTENSION_VERSION);
	}

	private static String buildBackground() {
		return """
				const CAPTURE_URL = 'http://localhost:8765/capture';
				const seen = new Set();
				const requestHeadersByUrl = new Map();
				const browserApi = chrome;

				function rememberRequestHeaders(details) {
				    const headers = {};
				    (details.requestHeaders || []).forEach(header => {
				        if (header.name && header.value != null) headers[header.name] = header.value;
				    });
				    requestHeadersByUrl.set(details.url, headers);
				    setTimeout(() => requestHeadersByUrl.delete(details.url), 30000);
				}

				function sendCapture(url, tabId, referer, closeTab) {
				    sendCaptureWithHeaders(url, tabId, referer, closeTab, null);
				}

				function sendCaptureWithHeaders(url, tabId, referer, closeTab, headerOverride) {
				    if (seen.has(url)) return;
				    seen.add(url);
				    console.log('[Hunter] Captured:', url);
				    const headers = headerOverride || requestHeadersByUrl.get(url) || {};
				    fetch(CAPTURE_URL, {
				        method: 'POST',
				        headers: { 'Content-Type': 'application/json' },
				        body: JSON.stringify({ url: url, referer: referer || '', headers: headers })
				    })
				    .then(r => {
				        if (r.ok && closeTab && tabId != null && tabId >= 0) {
				            setTimeout(() => {
				                try {
				                    browserApi.tabs.remove(tabId);
				                } catch (e) {
				                    console.log('[Hunter] Tab close ignored:', e);
				                }
				            }, 800);
				        }
				    })
				    .catch(() => console.log('[Hunter] Local server is offline'));
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
				            setTimeout(() => sendCapture(details.url, details.tabId, pageUrl, true), 100);
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
				            setTimeout(() => sendCapture(details.url, details.tabId, pageUrl, false), 100);
				        }
				    },
				    { urls: ['<all_urls>'], types: ['xmlhttprequest', 'media', 'other', 'sub_frame'] },
				    ['responseHeaders']
				);
				""";
	}
}
