package com.mediasteru.model;

import java.util.Map;
import java.util.List;

public interface DownloadStrategy {
	VideoInfo fetchMetadata(String url) throws Exception;

	public void startDownload(String url, String savePath, String format, String trimSection, boolean preciseCut,
			Observer observer);

	/**
	 * Starts a download with the page URL that initiated the stream request.
	 * Implementations that do not need request context can use the legacy method.
	 */
	default void startDownload(String url, String savePath, String format, String trimSection, boolean preciseCut,
			Observer observer, String referer) {
		startDownload(url, savePath, format, trimSection, preciseCut, observer);
	}

	default void startDownload(String url, String savePath, String format, String trimSection, boolean preciseCut,
			Observer observer, String referer, Map<String, String> requestHeaders) {
		startDownload(url, savePath, format, trimSection, preciseCut, observer, referer);
	}

	List<String> extractPlaylistLinks(String playlistUrl) throws Exception;
}
