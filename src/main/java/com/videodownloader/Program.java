package com.videodownloader;

import javax.swing.SwingUtilities;

import com.formdev.flatlaf.FlatDarculaLaf;
import com.videodownloader.controller.AppLogger;
import com.videodownloader.controller.ClipboardMonitor;
import com.videodownloader.controller.DependencyManager;
import com.videodownloader.controller.DownloadManager;
import com.videodownloader.controller.LocalHttpServer;
import com.videodownloader.controller.NeccessaryToolsAdapter;
import com.videodownloader.controller.UpdateChecker;
import com.videodownloader.view.AppGUI;

public class Program {
	public static void main(String[] args) {
		AppLogger.install();
		FlatDarculaLaf.setup();

		DependencyManager.checkAndDownloadDependencies();

		UpdateChecker.checkForUpdates();

		SwingUtilities.invokeLater(() -> {
			DownloadManager manager = new DownloadManager();
			AppGUI gui = new AppGUI(manager);
			manager.setGUI(gui);

			manager.setStrategy(new NeccessaryToolsAdapter());
			new LocalHttpServer(manager).start();

			Thread clipboardThread = new Thread(new ClipboardMonitor(manager));
			clipboardThread.setDaemon(true);
			clipboardThread.start();

			gui.setVisible(true);
		});
	}
}
