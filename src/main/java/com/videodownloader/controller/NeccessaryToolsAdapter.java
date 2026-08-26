package com.videodownloader.controller;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import com.google.gson.Gson;
import com.videodownloader.model.DownloadStrategy;
import com.videodownloader.model.Observer;
import com.videodownloader.model.VideoInfo;

public class NeccessaryToolsAdapter implements DownloadStrategy {
	private final Gson gson = new Gson();

	private String getToolPath(String toolType) {
		return ToolPaths.get(toolType);
	}

	@Override
	public VideoInfo fetchMetadata(String url) throws Exception {
		String ytDlpCommand = getToolPath("ytdlp");

		ProcessBuilder pb = new ProcessBuilder(ytDlpCommand, "--extractor-args", "generic:impersonate", "--dump-json",
				"--no-warnings", url);
		Process process = pb.start();

		BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()));
		String firstLine = reader.readLine();

		BufferedReader errorReader = new BufferedReader(new InputStreamReader(process.getErrorStream()));
		StringBuilder errorMsg = new StringBuilder();
		String line;
		while ((line = errorReader.readLine()) != null) {
			errorMsg.append(line).append("\n");
		}
		if (firstLine != null && !firstLine.trim().isEmpty()) {
			return gson.fromJson(firstLine, VideoInfo.class);
		} else {
			throw new RuntimeException("Analytics link error: \n" + errorMsg.toString());
		}
	}

	@Override
	public void startDownload(String url, String savePath, String format, String trimSection, boolean preciseCut,
			Observer o) {
		startDownload(url, savePath, format, trimSection, preciseCut, o, url, Map.of());
	}

	@Override
	public void startDownload(String url, String savePath, String format, String trimSection, boolean preciseCut,
			Observer o, String referer) {
		startDownload(url, savePath, format, trimSection, preciseCut, o, referer, Map.of());
	}

	@Override
	public void startDownload(String url, String savePath, String format, String trimSection, boolean preciseCut,
			Observer o, String referer, Map<String, String> requestHeaders) {
		try {
			System.out.println("Processing format: " + format.toUpperCase() + "...");

			String outputTemplate = savePath + File.separator + "%(title)s.%(ext)s";

			List<String> commandList = new ArrayList<>();
			commandList.add(getToolPath("ytdlp"));

			commandList.add("--extractor-args");
			commandList.add("generic:impersonate");
			commandList.add("--add-header");
			commandList.add("Referer: " + ((referer == null || referer.isBlank()) ? url : referer));
			for (Map.Entry<String, String> header : requestHeaders.entrySet()) {
				String name = header.getKey();
				String value = header.getValue();
				if (name == null || value == null || name.isBlank() || value.isBlank()
						|| name.equalsIgnoreCase("host") || name.equalsIgnoreCase("content-length")
						|| name.equalsIgnoreCase("connection") || name.equalsIgnoreCase("referer")) {
					continue;
				}
				commandList.add("--add-header");
				commandList.add(name + ": " + value);
			}

			commandList.add("--ffmpeg-location");
			commandList.add(getToolPath("ffmpeg"));
			File deno = new File(getToolPath("deno"));
			if (deno.isFile()) {
				commandList.add("--js-runtimes");
				commandList.add("deno:" + deno.getAbsolutePath());
			}

			commandList.add("-N");
			commandList.add("16");
			commandList.add("--fragment-retries");
			commandList.add("10");
			commandList.add("--retry-sleep");
			commandList.add("3");

			if (trimSection != null && !trimSection.isBlank()) {
				System.out.println("Trimming section: " + trimSection + (preciseCut ? " (precise)" : " (fast)"));
				commandList.add("--download-sections");
				commandList.add(trimSection);
				if (preciseCut) {
					commandList.add("--force-keyframes-at-cuts");
				}
			}

			if (format.equalsIgnoreCase("mp4")) {
				commandList.add("-f");
				// Download the best streams first.  MP4 is handled below after yt-dlp
				// has produced an MKV intermediate, so an MP4-only format filter would
				// unnecessarily discard higher-quality VP9/AV1 streams.
				commandList.add("bestvideo+bestaudio/best");
				commandList.add("--merge-output-format");
				commandList.add("mkv");
				commandList.add("--remux-video");
				commandList.add("mkv");
				// Lets us reliably locate the final intermediate even when the title
				// contains spaces, Unicode, or shell-special characters.
				commandList.add("--print");
				commandList.add("after_move:filepath");
			} else if (format.equalsIgnoreCase("mp3")) {
				commandList.add("-f");
				commandList.add("bestaudio/best");
				commandList.add("-x");
				commandList.add("--audio-format");
				commandList.add("mp3");

			} else {
				commandList.add("-f");
				commandList.add("bestvideo+bestaudio/best");
				commandList.add("--remux-video");
				commandList.add("mkv");
			}

			commandList.add("-o");
			commandList.add(outputTemplate);
			commandList.add(url);

			ProcessBuilder pb = new ProcessBuilder(commandList);
			pb.redirectErrorStream(true);
			Process process = pb.start();

			BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()));
			String line;
			String downloadedPath = null;

			while ((line = reader.readLine()) != null) {
				if (format.equalsIgnoreCase("mp4")) {
					File printedFile = new File(line.trim());
					if (printedFile.isFile()) {
						downloadedPath = printedFile.getAbsolutePath();
					}
				}
				if (line.contains("[download]") && line.contains("%")) {
					try {
						int percentIndex = line.indexOf("%");
						int spaceBeforePercent = line.lastIndexOf(" ", percentIndex);
						String percentStr = line.substring(spaceBeforePercent + 1, percentIndex).trim();
						double percent = Double.parseDouble(percentStr);

						String speed = "N/A";
						if (line.contains("at ")) {
							int atIndex = line.indexOf("at ");
							int posAfterAt = atIndex + 3;
							int spaceAfterSpeed = line.indexOf(" ", posAfterAt);
							if (spaceAfterSpeed != -1) {
								speed = line.substring(posAfterAt, spaceAfterSpeed).trim();
							}
						}
						o.onProgressUpdate(url, percent, speed);
					} catch (Exception ignored) {
					}
				} else if (line.contains("[download]") && line.contains("Destination:") && !preciseCut && trimSection != null) {
					o.onProgressUpdate(url, 0.0, "Fast Trim (No %)");
				} else if (line.toLowerCase().contains("error") || line.toLowerCase().contains("warning")) {
					System.err.println("\n[yt-dlp log] " + line);
				} else if (line.contains("[Merger]")) {
					System.out.print("\r[System] Processing merge... Waiting for minutes.\n");
				}
			}

			int exitCode = process.waitFor();

			if (exitCode == 0) {
				if (format.equalsIgnoreCase("mp4")) {
					if (downloadedPath == null) {
						throw new RuntimeException("Could not locate the MKV intermediate for MP4 conversion");
					}
					convertToMp4(new File(downloadedPath));
				}
				System.out.println("\nDownload completed! Save at: " + savePath);
				o.onComplete(url, savePath);
			} else if (referer != null && !referer.isBlank()
					&& tryDirectFfmpegDownload(url, savePath, format, referer, requestHeaders)) {
				System.out.println("\nDownload completed via ffmpeg fallback! Save at: " + savePath);
				o.onComplete(url, savePath);
			} else {
				throw new RuntimeException("yt-dlp was crashed (Exit code: " + exitCode + ")");
			}
		} catch (Exception e) {
			System.err.println("\nError while downloading: " + e.getMessage());
			o.onError(url, e.getMessage());
		}
	}

	/**
	 * Some players expose an obfuscated HLS endpoint which works in the browser
	 * but makes yt-dlp's generic extractor receive HTTP 414. Try the URL directly
	 * with ffmpeg, preserving the page referer captured by the extension.
	 */
	private boolean tryDirectFfmpegDownload(String url, String savePath, String format, String referer,
			Map<String, String> requestHeaders) {
		String baseName = "captured-" + System.currentTimeMillis();
		File output;
		List<String> command = new ArrayList<>();
		command.add(getToolPath("ffmpeg"));
		command.add("-y");
		command.add("-headers");
		StringBuilder ffmpegHeaders = new StringBuilder("Referer: ").append(referer).append("\r\n");
		for (Map.Entry<String, String> header : requestHeaders.entrySet()) {
			String name = header.getKey();
			String value = header.getValue();
			if (name == null || value == null || name.isBlank() || value.isBlank()
					|| name.equalsIgnoreCase("host") || name.equalsIgnoreCase("content-length")
					|| name.equalsIgnoreCase("connection") || name.equalsIgnoreCase("referer")) {
				continue;
			}
			ffmpegHeaders.append(name).append(": ").append(value).append("\r\n");
		}
		command.add(ffmpegHeaders.toString());
		command.add("-i");
		command.add(url);
		command.add("-map");
		command.add("0:v:0?");
		command.add("-map");
		command.add("0:a:0?");

		if (format.equalsIgnoreCase("mp3")) {
			output = new File(savePath, baseName + ".mp3");
			command.add("-vn");
			command.add("-c:a");
			command.add("libmp3lame");
		} else if (format.equalsIgnoreCase("mp4")) {
			output = new File(savePath, baseName + ".mkv");
			command.add("-c");
			command.add("copy");
		} else {
			output = new File(savePath, baseName + ".mkv");
			command.add("-c");
			command.add("copy");
		}
		command.add(output.getAbsolutePath());

		System.out.println("[System] yt-dlp could not read the captured endpoint; trying direct ffmpeg...");
		try {
			if (runFfmpeg(command) != 0 || !output.isFile() || output.length() == 0) {
				Files.deleteIfExists(output.toPath());
				return false;
			}
			if (format.equalsIgnoreCase("mp4")) {
				convertToMp4(output);
			}
			return true;
		} catch (Exception e) {
			System.err.println("[ffmpeg fallback] " + e.getMessage());
			try {
				Files.deleteIfExists(output.toPath());
			} catch (Exception ignored) {
			}
			return false;
		}
	}

	/**
	 * Converts the downloaded MKV to MP4 without re-encoding whenever the
	 * codecs are compatible. If the MP4 container rejects one of the codecs,
	 * retry with broadly compatible H.264/AAC codecs.
	 */
	private void convertToMp4(File source) throws Exception {
		String sourceName = source.getName();
		int extensionIndex = sourceName.lastIndexOf('.');
		String targetName = (extensionIndex > 0 ? sourceName.substring(0, extensionIndex) : sourceName)
				+ ".mp4";
		File target = new File(source.getParentFile(), targetName);

		System.out.println("[System] Converting MKV to MP4 (stream copy)...");
		List<String> remux = List.of(getToolPath("ffmpeg"), "-y", "-i", source.getAbsolutePath(), "-map", "0:v:0",
				"-map", "0:a:0?", "-c", "copy", "-movflags", "+faststart", target.getAbsolutePath());
		if (runFfmpeg(remux) != 0) {
			if (target.exists()) {
				Files.delete(target.toPath());
			}
			System.out.println("[System] Codec is not MP4-compatible; re-encoding to H.264/AAC...");
			List<String> recode = List.of(getToolPath("ffmpeg"), "-y", "-i", source.getAbsolutePath(), "-map",
					"0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-c:a",
					"aac", "-b:a", "192k", "-movflags", "+faststart", target.getAbsolutePath());
			if (runFfmpeg(recode) != 0) {
				if (target.exists()) {
					Files.delete(target.toPath());
				}
				throw new RuntimeException("ffmpeg could not convert the MKV to MP4");
			}
		}

		if (!target.isFile() || target.length() == 0) {
			throw new RuntimeException("ffmpeg reported success but the MP4 file was not created");
		}
		Files.deleteIfExists(source.toPath());
		System.out.println("[System] MP4 created: " + target.getAbsolutePath());
	}

	private int runFfmpeg(List<String> command) throws Exception {
		ProcessBuilder pb = new ProcessBuilder(command);
		pb.redirectErrorStream(true);
		Process process = pb.start();
		try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()))) {
			String line;
			while ((line = reader.readLine()) != null) {
				if (line.toLowerCase().contains("error") || line.toLowerCase().contains("failed")) {
					System.err.println("[ffmpeg] " + line);
				}
			}
		}
		return process.waitFor();
	}

	@Override
	public List<String> extractPlaylistLinks(String playlistUrl) throws Exception {
		List<String> links = new ArrayList<>();
		ProcessBuilder pb = new ProcessBuilder(getToolPath("ytdlp"), "--flat-playlist", "--print", "webpage_url",
				playlistUrl);
		Process process = pb.start();
		BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()));
		String line;
		while ((line = reader.readLine()) != null) {
			if (line.startsWith("http")) {
				links.add(line);
			}
		}
		return links;
	}
}
