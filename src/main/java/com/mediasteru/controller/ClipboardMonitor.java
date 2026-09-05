package com.mediasteru.controller;

import java.awt.Toolkit;
import java.awt.datatransfer.Clipboard;
import java.awt.datatransfer.DataFlavor;

public class ClipboardMonitor implements Runnable {
	private final DownloadManager manager;

	public ClipboardMonitor(DownloadManager manager) {
		this.manager = manager;
	}

	@Override
	public void run() {
		Clipboard clipboard = Toolkit.getDefaultToolkit().getSystemClipboard();
		String lastContent = "";

		while (true) {
			try {
				if (clipboard.isDataFlavorAvailable(DataFlavor.stringFlavor)) {
					String data = (String) clipboard.getData(DataFlavor.stringFlavor);

					if (data != null) {
						data = data.trim();
						if (!data.equals(lastContent) && (data.startsWith("http") || data.startsWith("https"))) {
							lastContent = data;
							System.out.println("\n[Clipboard] Detected new link: " + data);
							manager.processLink(data);
						}
					}
				}
				Thread.sleep(1500);
			} catch (IllegalStateException busy) {
				try {
					Thread.sleep(500);
				} catch (InterruptedException ignored) {
				}
			} catch (Exception e) {
				System.err.println("Clipboard monitoring error: " + e.getMessage());
				try {
					Thread.sleep(5000);
				} catch (InterruptedException ie) {
					Thread.currentThread().interrupt();
				}
			}
		}
	}
}