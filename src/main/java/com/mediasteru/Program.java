package com.mediasteru;

import javax.swing.SwingUtilities;

import com.formdev.flatlaf.FlatDarculaLaf;
import com.formdev.flatlaf.FlatSystemProperties;
import com.formdev.flatlaf.util.UIScale;
import com.mediasteru.controller.AppLogger;
import com.mediasteru.controller.ClipboardMonitor;
import com.mediasteru.controller.DependencyManager;
import com.mediasteru.controller.DownloadManager;
import com.mediasteru.controller.LocalHttpServer;
import com.mediasteru.controller.NeccessaryToolsAdapter;
import com.mediasteru.controller.UpdateChecker;
import com.mediasteru.view.AppGUI;

public class Program {
	private static final String APP_UI_SCALE_PROPERTY = "mediasteru.uiScale";
	private static final String APP_UI_SCALE_ENV = "MEDIASTERU_UI_SCALE";

	public static void main(String[] args) {
		AppLogger.install();
		FlatDarculaLaf.setup();
		configureUiScale();

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

	private static void configureUiScale() {
		String configuredScale = System.getProperty(APP_UI_SCALE_PROPERTY);
		if (configuredScale == null || configuredScale.isBlank()) {
			configuredScale = System.getenv(APP_UI_SCALE_ENV);
		}

		Float zoom = parseScale(configuredScale);
		if (zoom == null) {
			// Java/FlatLaf cannot always read KDE's fractional scale on Wayland.
			// A Linux-only zoom keeps the UI readable without changing other platforms.
			String flatLafScale = System.getProperty(FlatSystemProperties.UI_SCALE);
			if (flatLafScale != null) {
				System.out.println("[UI] Interface scale managed by flatlaf.uiScale=" + flatLafScale);
				return;
			}
			zoom = isLinux() ? 1.75f : 1f;
		}

		UIScale.setZoomFactor(zoom);
		System.out.printf("[UI] Interface scale: %.0f%%%n", zoom * 100);
	}

	private static Float parseScale(String value) {
		if (value == null || value.isBlank()) {
			return null;
		}
		try {
			String normalized = value.trim();
			boolean percent = normalized.endsWith("%");
			if (percent) {
				normalized = normalized.substring(0, normalized.length() - 1).trim();
			}
			float scale = Float.parseFloat(normalized);
			if (percent) {
				scale /= 100f;
			}
			if (!Float.isFinite(scale)) {
				throw new NumberFormatException("scale must be finite");
			}
			return Math.max(0.75f, Math.min(scale, 2.5f));
		} catch (NumberFormatException e) {
			System.err.println("[UI] Ignoring invalid " + APP_UI_SCALE_ENV + " value: " + value);
			return null;
		}
	}

	private static boolean isLinux() {
		return System.getProperty("os.name", "").toLowerCase().contains("linux");
	}
}
