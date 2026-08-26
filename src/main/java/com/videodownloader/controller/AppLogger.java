package com.videodownloader.controller;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Consumer;

/**
 * Captures stdout/stderr for diagnostics while keeping normal console output in
 * development. Logs are bounded so the app data directory cannot grow forever.
 */
public final class AppLogger {
	private static final long MAX_LOG_BYTES = 2L * 1024 * 1024;
	private static final int MAX_BACKUPS = 3;
	private static final int MAX_RECENT_CHARS = 100_000;
	private static final DateTimeFormatter TIME_FORMAT = DateTimeFormatter.ofPattern("HH:mm:ss");
	private static final Path LOG_DIR = Path.of(System.getProperty("user.home"), ".VideoDownloaderApp", "logs");
	private static final Path LOG_FILE = LOG_DIR.resolve("app.log");
	private static final CopyOnWriteArrayList<Consumer<String>> LISTENERS = new CopyOnWriteArrayList<>();
	private static final StringBuilder RECENT = new StringBuilder();

	private static volatile boolean installed;
	private static OutputStream fileOutput;
	private static long writtenBytes;

	private AppLogger() {
	}

	public static synchronized void install() {
		if (installed) {
			return;
		}

		PrintStream originalOut = System.out;
		PrintStream originalErr = System.err;
		try {
			Files.createDirectories(LOG_DIR);
			if (Files.exists(LOG_FILE) && Files.size(LOG_FILE) >= MAX_LOG_BYTES) {
				rotateLogs();
			}
			openLogFile();
		} catch (Exception e) {
			originalErr.println("[Logger] Could not open diagnostic log: " + e.getMessage());
		}

		System.setOut(new PrintStream(new CapturingOutputStream(originalOut, false), true, StandardCharsets.UTF_8));
		System.setErr(new PrintStream(new CapturingOutputStream(originalErr, true), true, StandardCharsets.UTF_8));
		installed = true;
	}

	public static void addListener(Consumer<String> listener) {
		if (listener != null) {
			LISTENERS.add(listener);
		}
	}

	public static void removeListener(Consumer<String> listener) {
		LISTENERS.remove(listener);
	}

	public static synchronized String getRecentText() {
		return RECENT.toString();
	}

	public static File getLogFile() {
		return LOG_FILE.toFile();
	}

	private static synchronized void appendToFile(byte[] data, int offset, int length) {
		if (fileOutput == null || length <= 0) {
			return;
		}
		try {
			if (writtenBytes + length > MAX_LOG_BYTES) {
				fileOutput.close();
				fileOutput = null;
				rotateLogs();
				openLogFile();
			}
			fileOutput.write(data, offset, length);
			fileOutput.flush();
			writtenBytes += length;
		} catch (Exception ignored) {
			// Logging must never interrupt a download.
		}
	}

	private static void openLogFile() throws IOException {
		fileOutput = Files.newOutputStream(LOG_FILE, StandardOpenOption.CREATE, StandardOpenOption.APPEND);
		writtenBytes = Files.exists(LOG_FILE) ? Files.size(LOG_FILE) : 0;
	}

	private static void rotateLogs() throws IOException {
		for (int index = MAX_BACKUPS; index >= 2; index--) {
			Path previous = LOG_DIR.resolve("app.log." + (index - 1));
			Path next = LOG_DIR.resolve("app.log." + index);
			if (Files.exists(previous)) {
				Files.move(previous, next, StandardCopyOption.REPLACE_EXISTING);
			}
		}
		if (Files.exists(LOG_FILE)) {
			Files.move(LOG_FILE, LOG_DIR.resolve("app.log.1"), StandardCopyOption.REPLACE_EXISTING);
		}
	}

	private static void publishLine(String line, boolean error) {
		String text = line == null ? "" : line.stripTrailing();
		if (text.isBlank()) {
			return;
		}
		String formatted = LocalTime.now().format(TIME_FORMAT) + (error ? "  ERROR  " : "  ") + text;
		synchronized (AppLogger.class) {
			RECENT.append(formatted).append('\n');
			if (RECENT.length() > MAX_RECENT_CHARS) {
				RECENT.delete(0, RECENT.length() - MAX_RECENT_CHARS);
			}
		}
		for (Consumer<String> listener : LISTENERS) {
			try {
				listener.accept(formatted);
			} catch (Exception ignored) {
			}
		}
	}

	private static final class CapturingOutputStream extends OutputStream {
		private final PrintStream original;
		private final boolean error;
		private final ByteArrayOutputStream lineBuffer = new ByteArrayOutputStream();

		private CapturingOutputStream(PrintStream original, boolean error) {
			this.original = original;
			this.error = error;
		}

		@Override
		public synchronized void write(int value) {
			byte[] single = { (byte) value };
			write(single, 0, 1);
		}

		@Override
		public synchronized void write(byte[] data, int offset, int length) {
			original.write(data, offset, length);
			appendToFile(data, offset, length);
			for (int index = offset; index < offset + length; index++) {
				int value = data[index] & 0xff;
				if (value == '\n') {
					flushLine();
				} else if (value == '\r') {
					lineBuffer.reset();
				} else {
					lineBuffer.write(value);
				}
			}
		}

		@Override
		public synchronized void flush() {
			original.flush();
		}

		private void flushLine() {
			if (lineBuffer.size() == 0) {
				return;
			}
			String line = lineBuffer.toString(StandardCharsets.UTF_8);
			lineBuffer.reset();
			publishLine(line, error);
		}
	}
}
