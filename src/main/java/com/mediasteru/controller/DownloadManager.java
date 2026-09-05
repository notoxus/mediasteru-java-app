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

	public void enqueuePendingTask(int rowIndex) {
		DownloadTask task = pendingTasks.remove(rowIndex);
		if (task != null) {
			try {
				downloadQueue.put(task);
			} catch (InterruptedException e) {
				Thread.currentThread().interrupt();
			}
		}
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
							this, task.referer, task.requestHeaders);
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

		DownloadOptionsDialog.Options opts = DownloadOptionsDialog
				.show("Video Hunter has caught a download link!\n\nTarget: " + url);

		if (opts != null) {
			System.out.println("\n[Auto-Capture] Preparing, waiting for user to start...");
			String savePath = FolderSelector.chooseSaveDirectory();

			if (savePath != null && !savePath.isEmpty()) {
				SwingUtilities.invokeLater(() -> {
					if (gui != null) {
						String formatLabel = opts.format.toUpperCase();
						int newRow = gui.addQueueItem(url, formatLabel, "Waiting...");
						pendingTasks.put(newRow,
								new DownloadTask(url, savePath, opts.format, null, false, newRow, referer,
										requestHeaders));
						gui.logToConsole(
								"=> [Hunter] Added captured link to list (Row " + newRow + "). Ready to download.");
						resolveTitleAsync(url, newRow);
					}
				});
			} else {
				System.out.println("=> Canceled cuz you didn't choose saved directory.");
			}
		} else {
			System.out.println("\n[Auto-Capture] Skip the trash links: " + url);
		}
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
				String formatLabel = task.format.toUpperCase() + (task.trimSection != null ? " ✂" : "");
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

						String formatLabel = opts.format.toUpperCase();
						boolean resolveTitles = links.size() <= 20;

						for (String link : links) {
							String display = (links.size() == 1 && info.getTitle() != null
									&& !info.getTitle().isBlank()) ? info.getTitle() : link;
							int newRow = (gui != null) ? gui.addQueueItem(display, formatLabel, "Waiting...") : -1;
							if (newRow != -1) {
								pendingTasks.put(newRow,
										new DownloadTask(link, savePath, opts.format, null, false, newRow));
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
							int newRow = gui.addQueueItem(fileName, "MP4", "Waiting...");
							pendingTasks.put(newRow, new DownloadTask(m3u8Url, savePath, "mp4", null, false, newRow));
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
		String trimSection; // null = full video
		boolean preciseCut;
		int rowIndex;
		String referer;
		Map<String, String> requestHeaders;

		public DownloadTask(String url, String savePath, String format, String trimSection, boolean preciseCut,
				int rowIndex) {
			this(url, savePath, format, trimSection, preciseCut, rowIndex, null);
		}

		public DownloadTask(String url, String savePath, String format, String trimSection, boolean preciseCut,
				int rowIndex, String referer) {
			this(url, savePath, format, trimSection, preciseCut, rowIndex, referer, Map.of());
		}

		public DownloadTask(String url, String savePath, String format, String trimSection, boolean preciseCut,
				int rowIndex, String referer, Map<String, String> requestHeaders) {
			this.url = url;
			this.savePath = savePath;
			this.format = format;
			this.trimSection = trimSection;
			this.preciseCut = preciseCut;
			this.rowIndex = rowIndex;
			this.referer = referer;
			this.requestHeaders = requestHeaders == null ? Map.of() : Map.copyOf(requestHeaders);
		}
	}
}
