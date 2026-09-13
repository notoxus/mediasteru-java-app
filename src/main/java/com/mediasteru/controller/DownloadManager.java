package com.mediasteru.controller;

import java.awt.Toolkit;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.LinkedBlockingQueue;

import javax.swing.SwingUtilities;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mediasteru.model.DownloadStrategy;
import com.mediasteru.model.Observer;
import com.mediasteru.model.VideoInfo;
import com.mediasteru.view.AppGUI;
import com.mediasteru.view.DownloadOptionsDialog;
import com.mediasteru.view.FolderSelector;
import com.mediasteru.view.TrimDialog;

public class DownloadManager implements Observer {
	private DownloadStrategy strategy;
	private AppGUI gui;
	private int currentRowIndex = -1;

	private final Map<Integer, DownloadTask> pendingTasks = new ConcurrentHashMap<>();
	private final BlockingQueue<DownloadTask> downloadQueue = new LinkedBlockingQueue<>();
	private final Thread queueWorker;

	// Spam avoid
	private final Set<String> analyzingUrls = ConcurrentHashMap.newKeySet();

	public DownloadManager() {
		this.queueWorker = new Thread(this::processQueue);
		queueWorker.setDaemon(true);
		queueWorker.start();
	}

	public void setStrategy(DownloadStrategy strategy) {
		this.strategy = strategy;
	}

	public void setGUI(AppGUI gui) {
		this.gui = gui;
	}

	public boolean enqueuePendingTask(int rowIndex) {
		DownloadTask task = pendingTasks.get(rowIndex);
		if (task == null) {
			return false;
		}
		if (!task.isConfigured()) {
			if (gui != null) {
				gui.logToConsole("=> [Queue] Choose options for this captured stream before starting it.");
			}
			return false;
		}
		pendingTasks.remove(rowIndex);
		if (task != null) {
			try {
				downloadQueue.put(task);
				return true;
			} catch (InterruptedException e) {
				Thread.currentThread().interrupt();
			}
		}
		return false;
	}

	public void removePendingTask(int rowIndex) {
		pendingTasks.remove(rowIndex);
		Map<Integer, DownloadTask> updatedMap = new ConcurrentHashMap<>();
		for (Map.Entry<Integer, DownloadTask> entry : pendingTasks.entrySet()) {
			int oldIndex = entry.getKey();
			DownloadTask task = entry.getValue();
			if (oldIndex > rowIndex) {
				int newIndex = oldIndex - 1;
				task.rowIndex = newIndex;
				updatedMap.put(newIndex, task);
			} else {
				updatedMap.put(oldIndex, task);
			}
		}
		pendingTasks.clear();
		pendingTasks.putAll(updatedMap);
	}

	private void processQueue() {
		while (true) {
			try {
				DownloadTask task = downloadQueue.take();
				this.currentRowIndex = task.rowIndex;
				int remaining = downloadQueue.size();
				System.out.println("\n==================================");

				if (gui != null) {
					gui.logToConsole("=> [Queue] Handling link: " + task.url);
					gui.updateQueueItemStatus(task.rowIndex, "Loading...", "0%");
				}

				System.out.println("Remaining: " + remaining + " video.");
				if (strategy != null) {
					strategy.startDownload(task.url, task.savePath, task.format, task.trimSection, task.preciseCut,
							this, task.referer, task.requestHeaders, task.quality);
				}

			} catch (InterruptedException e) {
				Thread.currentThread().interrupt();
				break;
			} catch (Exception e) {
				System.err.println("[Queue] Error: " + e.getMessage());
				if (gui != null)
					gui.logToConsole("[Queue Error] " + e.getMessage());
			}
		}
	}

	@Override
	public void onProgressUpdate(String videoId, double percent, String speed) {
		int width = 50;
		int progress = (int) (percent / 100 * width);

		StringBuilder bar = new StringBuilder("[");
		for (int i = 0; i < width; i++) {
			if (i < progress)
				bar.append("=");
			else if (i == progress)
				bar.append(">");
			else
				bar.append(" ");
		}

		String output = String.format("\r%s] %.1f%% | speed: %s", bar.toString(), percent, speed);
		System.out.print(output);

		if (gui != null && currentRowIndex != -1) {
			String progressStr = String.format("%.1f%%", percent);
			if (speed != null && !speed.trim().isEmpty() && !speed.equals("N/A")) {
				progressStr += " (" + speed + ")";
			}
			gui.updateQueueItemStatus(currentRowIndex, "Downloading...", progressStr);
		}
	}

	@Override
	public void onComplete(String videoId, String savedPath) {
		System.out.println("\n>> Video download completed successfully!");
		System.out.println(">> Saved at: " + savedPath);
		System.out.println("--------------------------------------------------");

		if (gui != null && currentRowIndex != -1) {
			gui.updateQueueItemStatus(currentRowIndex, "Completed", "100%");
			gui.logToConsole(">> Download completed: " + savedPath);
		}
	}

	@Override
	public void onError(String videoId, String errorMessage) {
		System.err.println("\n>> Error: failed to download. Details: " + errorMessage);

		if (gui != null && currentRowIndex != -1) {
			gui.updateQueueItemStatus(currentRowIndex, "Failed", "—");
			gui.logToConsole(">> Download failed: " + errorMessage);
		}
	}

	public void processAutoCapture(String url) {
		processAutoCapture(url, null, Map.of());
	}

	public void processAutoCapture(String url, String referer) {
		processAutoCapture(url, referer, Map.of());
	}

	public void processAutoCapture(String url, String referer, Map<String, String> requestHeaders) {
		Toolkit.getDefaultToolkit().beep();
		System.out.println("\n[Auto-Capture] Stream caught and added to the review queue: " + url);
		SwingUtilities.invokeLater(() -> {
			if (gui == null) return;
			int newRow = gui.addQueueItem(url, "Choose options", "Captured");
			pendingTasks.put(newRow,
					new DownloadTask(url, null, "mp4", "1080", null, false, newRow, referer, requestHeaders));
			gui.logToConsole("=> [Hunter] Captured a stream (Row " + newRow
					+ "). Double-click it to choose format, quality, and folder.");
			resolveTitleAsync(url, newRow);
		});
	}

	public boolean configurePendingTask(int rowIndex) {
		DownloadTask task = pendingTasks.get(rowIndex);
		if (task == null) return false;
		DownloadOptionsDialog.Options opts = DownloadOptionsDialog.show("Choose options for the captured stream.");
		if (opts == null) return false;
		String savePath = FolderSelector.chooseSaveDirectory();
		if (savePath == null || savePath.isBlank()) return false;
		task.format = opts.format;
		task.quality = opts.quality;
		task.savePath = savePath;
		if (gui != null) {
			gui.updateQueueItemFormat(rowIndex, formatLabel(task));
			gui.updateQueueItemStatus(rowIndex, "Waiting...", "0%");
			gui.logToConsole("=> [Queue] Stream options saved.");
		}
		return true;
	}

	private String formatLabel(DownloadTask task) {
		if (task.format.equalsIgnoreCase("mp3")) return "MP3";
		String quality = task.quality.equalsIgnoreCase("best") ? "Best" : task.quality + "p";
		return task.format.toUpperCase() + " · " + quality;
	}

	private void resolveTitleAsync(String url, int rowIndex) {
		new Thread(() -> {
			try {
				VideoInfo info = strategy.fetchMetadata(url);
				if (info != null && info.getTitle() != null && !info.getTitle().isBlank() && gui != null) {
					gui.updateQueueItemName(rowIndex, info.getTitle());
				}
			} catch (Exception ignored) {
			}
		}).start();
	}

	public void openTrimDialog(int row) {
		DownloadTask task = pendingTasks.get(row);
		if (task == null)
			return;

		boolean isAudio = task.format.equalsIgnoreCase("mp3");
		TrimDialog.TrimOptions trimOpts = TrimDialog.show("Trim Video", task.url, 0, task.url, isAudio);
		if (trimOpts != null) {
			task.trimSection = trimOpts.trimSection;
			task.preciseCut = trimOpts.preciseCut;
			if (gui != null) {
				String formatLabel = formatLabel(task) + (task.trimSection != null ? " ✂" : "");
				gui.updateQueueItemFormat(row, formatLabel);
			}
		}
	}

	public void processLink(String url) {
		if (!analyzingUrls.add(url)) {
			return;
		}

		new Thread(() -> {
			boolean isDialogOpened = false;
			try {
				System.out.println("\n[Analyzing link] " + url);
				List<String> links = strategy.extractPlaylistLinks(url);
				if (links.isEmpty()) {
					System.out.println("=> Couldn't found video/playlist or internet connection issues.");
					return;
				}

				VideoInfo info = strategy.fetchMetadata(links.get(0));
				String displayTitle = (links.size() > 1) ? "Playlist (" + links.size() + " videos): " + info.getTitle()
						: info.getTitle();

				isDialogOpened = true;
				SwingUtilities.invokeLater(() -> {
					try {
						String savePath = FolderSelector.chooseSaveDirectory();
						if (savePath == null || savePath.isEmpty())
							return;

						DownloadOptionsDialog.Options opts = DownloadOptionsDialog
								.show("Choose download options for:\n" + displayTitle);
						if (opts == null)
							return;

						String formatLabel = opts.format.equalsIgnoreCase("mp3") ? "MP3"
								: opts.format.toUpperCase() + " · " + (opts.quality.equalsIgnoreCase("best") ? "Best" : opts.quality + "p");
						boolean resolveTitles = links.size() <= 20;

						for (String link : links) {
							String display = (links.size() == 1 && info.getTitle() != null
									&& !info.getTitle().isBlank()) ? info.getTitle() : link;
							int newRow = (gui != null) ? gui.addQueueItem(display, formatLabel, "Waiting...") : -1;
							if (newRow != -1) {
								pendingTasks.put(newRow,
										new DownloadTask(link, savePath, opts.format, opts.quality, null, false, newRow));
								if (links.size() > 1 && resolveTitles) {
									resolveTitleAsync(link, newRow);
								}
							}
						}
						if (gui != null)
							gui.logToConsole("=> [System] Added " + links.size() + " items to waitlist.");
					} finally {
						analyzingUrls.remove(url);
					}
				});

			} catch (Exception e) {
				System.err.println("Analytics error! Error: " + e.getMessage());
			} finally {
				if (!isDialogOpened) {
					analyzingUrls.remove(url);
				}
			}
		}).start();
	}

	public void processApiJson(String jsonResponse) {
		try {
			JsonObject root = JsonParser.parseString(jsonResponse).getAsJsonObject();
			JsonObject movie = root.getAsJsonObject("movie");

			String movieName = movie.get("name").getAsString();

			JsonArray episodesArray = root.getAsJsonArray("episodes");
			if (episodesArray.size() > 0) {
				JsonObject server = episodesArray.get(0).getAsJsonObject();
				JsonArray items = server.getAsJsonArray("items");

				System.out.println("\n[API Parser] Found Movie: " + movieName);
				System.out.println("[API Parser] Total episodes: " + items.size());

				String savePath = FolderSelector.chooseSaveDirectory();
				if (savePath == null || savePath.isEmpty())
					return;

				SwingUtilities.invokeLater(() -> {
					for (JsonElement itemElement : items) {
						JsonObject item = itemElement.getAsJsonObject();
						String epNumber = item.get("name").getAsString();
						String m3u8Url = item.get("m3u8").getAsString();

						String fileName = movieName + " - "
								+ (epNumber.toLowerCase().startsWith("episode") || epNumber.toLowerCase().startsWith("ep")
										? epNumber
										: "Episode " + epNumber);

						if (gui != null) {
							int newRow = gui.addQueueItem(fileName, "MP4 · 1080p", "Waiting...");
							pendingTasks.put(newRow, new DownloadTask(m3u8Url, savePath, "mp4", "1080", null, false, newRow));
						}
					}
					if (gui != null)
						gui.logToConsole(
								"=> [API] Successfully loaded " + items.size() + " episodes. Ready to download.");
				});
			}
		} catch (Exception e) {
			System.err.println("API Parse Error: " + e.getMessage());
		}
	}

	private static class DownloadTask {
		String url;
		String savePath;
		String format;
		String quality;
		String trimSection; // null = full video
		boolean preciseCut;
		int rowIndex;
		String referer;
		Map<String, String> requestHeaders;

		public DownloadTask(String url, String savePath, String format, String trimSection, boolean preciseCut,
				int rowIndex) {
			this(url, savePath, format, "1080", trimSection, preciseCut, rowIndex, null, Map.of());
		}

		public DownloadTask(String url, String savePath, String format, String trimSection, boolean preciseCut,
				int rowIndex, String referer) {
			this(url, savePath, format, "1080", trimSection, preciseCut, rowIndex, referer, Map.of());
		}

		public DownloadTask(String url, String savePath, String format, String quality, String trimSection,
				boolean preciseCut, int rowIndex) {
			this(url, savePath, format, quality, trimSection, preciseCut, rowIndex, null, Map.of());
		}

		public DownloadTask(String url, String savePath, String format, String quality, String trimSection, boolean preciseCut,
				int rowIndex, String referer, Map<String, String> requestHeaders) {
			this.url = url;
			this.savePath = savePath;
			this.format = format;
			this.quality = quality;
			this.trimSection = trimSection;
			this.preciseCut = preciseCut;
			this.rowIndex = rowIndex;
			this.referer = referer;
			this.requestHeaders = requestHeaders == null ? Map.of() : Map.copyOf(requestHeaders);
		}

		boolean isConfigured() {
			return savePath != null && !savePath.isBlank();
		}
	}
}
