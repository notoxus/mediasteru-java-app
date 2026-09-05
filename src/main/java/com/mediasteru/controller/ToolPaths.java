package com.mediasteru.controller;

import java.io.File;
import java.util.List;

public final class ToolPaths {

	private ToolPaths() {
	}

	public static String get(String toolType) {
		String os = System.getProperty("os.name").toLowerCase();
		String arch = System.getProperty("os.arch").toLowerCase();
		boolean arm64 = arch.contains("aarch64") || arch.contains("arm64");
		List<String> fileNames;
		if (toolType.equals("ytdlp")) {
			if (os.contains("win"))
				fileNames = List.of("yt-dlp.exe");
			else if (os.contains("mac"))
				fileNames = List.of("yt-dlp-macos");
			else
				fileNames = List.of(arm64 ? "yt-dlp-linux-arm64" : "yt-dlp-linux-x64", "yt-dlp");
		} else if (toolType.equals("ffmpeg")) {
			if (os.contains("win"))
				fileNames = List.of("ffmpeg-win-x64.exe", "ffmpeg.exe");
			else if (os.contains("mac"))
				fileNames = List.of(arm64 ? "ffmpeg-macos-arm64" : "ffmpeg-macos-x64", "ffmpeg-macos");
			else if (arm64)
				fileNames = List.of("ffmpeg-linux-arm64");
			else
				fileNames = List.of("ffmpeg-linux-x64");
		} else if (toolType.equals("deno")) {
			if (os.contains("win"))
				fileNames = List.of("deno-win-x64.exe", "deno.exe");
			else if (os.contains("mac"))
				fileNames = List.of(arm64 ? "deno-macos-arm64" : "deno-macos-x64", "deno-macos");
			else
				fileNames = List.of(arm64 ? "deno-linux-arm64" : "deno-linux-x64", "deno");
		} else {
			throw new IllegalArgumentException("Unknown tool type: " + toolType);
		}

		String projectRoot = System.getProperty("user.dir");
		String jarDir = projectRoot;
		try {
			File jarPath = new File(
					ToolPaths.class.getProtectionDomain().getCodeSource().getLocation().toURI());
			jarDir = jarPath.getParent();
		} catch (Exception ignored) {
		}

		File devTools = new File(projectRoot, "tools");
		for (String fileName : fileNames) {
			File toolInDevFolder = new File(devTools, fileName);
			if (toolInDevFolder.exists()) {
				return toolInDevFolder.getAbsolutePath();
			}
		}
		for (String fileName : fileNames) {
			File toolInJarDir = new File(jarDir, fileName);
			if (toolInJarDir.exists()) {
				return toolInJarDir.getAbsolutePath();
			}
		}
		File destinationDirectory = devTools.isDirectory() ? devTools : new File(jarDir);
		return new File(destinationDirectory, fileNames.get(0)).getAbsolutePath();
	}
}
