package com.mediasteru.controller;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Properties;
import java.util.UUID;

import javax.swing.JOptionPane;

import com.mediasteru.model.BrowserEngine;

public class BrowserController {

	private static final String BASE_CONFIG_PATH = System.getProperty("user.home") + File.separator
			+ ".MediaSteru";
	// Browser profiles are disposable runtime state. Keep them out of the
	// persistent app directory, which should contain only settings and assets.
	private static final String CHROME_PROFILE_PATH = new File(System.getProperty("java.io.tmpdir"),
			"MediaSteruChrome-" + UUID.randomUUID()).getAbsolutePath();
	private static final File SETTINGS_FILE = new File(BASE_CONFIG_PATH, "settings.properties");
	private static final String BROWSER_OVERRIDE_ENV = "MEDIASTERU_BROWSER";

	private static final BrowserCandidate[] LINUX_CHROMIUM_BROWSERS = {
			new BrowserCandidate("Google Chrome", "google-chrome"),
			new BrowserCandidate("Google Chrome", "google-chrome-stable"),
			new BrowserCandidate("Chromium", "chromium"),
			new BrowserCandidate("Chromium", "chromium-browser"),
			new BrowserCandidate("Helium", "helium"),
			new BrowserCandidate("Brave", "brave-browser"),
			new BrowserCandidate("Microsoft Edge", "microsoft-edge"),
			new BrowserCandidate("Microsoft Edge", "microsoft-edge-stable"),
			new BrowserCandidate("Vivaldi", "vivaldi"),
			new BrowserCandidate("Vivaldi", "vivaldi-stable"),
			new BrowserCandidate("Opera", "opera"),
			new BrowserCandidate("Opera Beta", "opera-beta"),
			new BrowserCandidate("Opera Developer", "opera-developer"),
			new BrowserCandidate("Thorium", "thorium"),
			new BrowserCandidate("Thorium", "thorium-browser"),
			new BrowserCandidate("Ungoogled Chromium", "ungoogled-chromium")
	};

	private static final BrowserCandidate[] MAC_CHROMIUM_BROWSERS = {
			new BrowserCandidate("Google Chrome", "Google Chrome"),
			new BrowserCandidate("Chromium", "Chromium"),
			new BrowserCandidate("Helium", "Helium"),
			new BrowserCandidate("Brave", "Brave Browser"),
			new BrowserCandidate("Microsoft Edge", "Microsoft Edge"),
			new BrowserCandidate("Vivaldi", "Vivaldi"),
			new BrowserCandidate("Opera", "Opera"),
			new BrowserCandidate("Opera GX", "Opera GX"),
			new BrowserCandidate("Thorium", "Thorium"),
			new BrowserCandidate("Arc", "Arc")
	};

	private static final BrowserCandidate[] WINDOWS_CHROMIUM_BROWSERS = {
			new BrowserCandidate("Google Chrome", "Google\\Chrome\\Application\\chrome.exe"),
			new BrowserCandidate("Google Chrome Canary", "Google\\Chrome SxS\\Application\\chrome.exe"),
			new BrowserCandidate("Chromium", "Chromium\\Application\\chrome.exe"),
			new BrowserCandidate("Helium", "imput\\Helium\\Application\\chrome.exe"),
			new BrowserCandidate("Helium", "imput\\Helium\\Application\\helium.exe"),
			new BrowserCandidate("Brave", "BraveSoftware\\Brave-Browser\\Application\\brave.exe"),
			new BrowserCandidate("Brave Beta", "BraveSoftware\\Brave-Browser-Beta\\Application\\brave.exe"),
			new BrowserCandidate("Brave Nightly", "BraveSoftware\\Brave-Browser-Nightly\\Application\\brave.exe"),
			new BrowserCandidate("Microsoft Edge", "Microsoft\\Edge\\Application\\msedge.exe"),
			new BrowserCandidate("Microsoft Edge Beta", "Microsoft\\Edge Beta\\Application\\msedge.exe"),
			new BrowserCandidate("Microsoft Edge Dev", "Microsoft\\Edge Dev\\Application\\msedge.exe"),
			new BrowserCandidate("Vivaldi", "Vivaldi\\Application\\vivaldi.exe"),
			new BrowserCandidate("Vivaldi", "Programs\\Vivaldi\\Application\\vivaldi.exe"),
			new BrowserCandidate("Opera", "Programs\\Opera\\launcher.exe"),
			new BrowserCandidate("Opera GX", "Programs\\Opera GX\\launcher.exe"),
			new BrowserCandidate("Thorium", "Thorium\\Application\\thorium.exe"),
			new BrowserCandidate("Thorium", "Programs\\Thorium\\Application\\thorium.exe"),
			new BrowserCandidate("Ungoogled Chromium", "Ungoogled Chromium\\Application\\chrome.exe"),
			new BrowserCandidate("Yandex Browser", "Yandex\\YandexBrowser\\Application\\browser.exe"),
			new BrowserCandidate("Arc", "Programs\\Arc\\Arc.exe")
	};

	private static final String[] WINDOWS_BROWSER_EXECUTABLES = {
			"chrome.exe", "chromium.exe", "helium.exe", "brave.exe", "msedge.exe", "vivaldi.exe",
			"opera.exe", "thorium.exe", "browser.exe"
	};

	private record BrowserCandidate(String displayName, String executable) {
	}

	private record BrowserLaunch(String displayName, List<String> commandPrefix) {
	}

	private static BrowserEngine currentEngine = loadSavedEngine();

	public static BrowserEngine getEngine() {
		return currentEngine;
	}

	public static void setEngine(BrowserEngine engine) {
		currentEngine = engine != null ? engine : BrowserEngine.AUTO;
		saveEngine(currentEngine);
	}

	public static BrowserEngine loadSavedEngine() {
		try {
			if (SETTINGS_FILE.exists()) {
				Properties props = new Properties();
				try (FileInputStream in = new FileInputStream(SETTINGS_FILE)) {
					props.load(in);
					String val = props.getProperty("browser_engine");
					if (val != null) {
						return BrowserEngine.fromString(val);
					}
				}
			}
		} catch (Exception ignored) {
		}
		return BrowserEngine.AUTO;
	}

	public static void saveEngine(BrowserEngine engine) {
		try {
			if (!SETTINGS_FILE.getParentFile().exists()) {
				SETTINGS_FILE.getParentFile().mkdirs();
			}
			Properties props = new Properties();
			if (SETTINGS_FILE.exists()) {
				try (FileInputStream in = new FileInputStream(SETTINGS_FILE)) {
					props.load(in);
				}
			}
			props.setProperty("browser_engine", engine.name());
			try (FileOutputStream out = new FileOutputStream(SETTINGS_FILE)) {
				props.store(out, "MediaSteru App Settings");
			}
		} catch (Exception e) {
			System.err.println("[BrowserController] Could not save settings: " + e.getMessage());
		}
	}

	public static BrowserEngine resolveActiveEngine() {
		return BrowserEngine.CHROMIUM;
	}

	public static boolean isChromiumAvailable() {
		return findChromiumBrowser() != null;
	}

	private static BrowserLaunch findChromiumBrowser() {
		BrowserLaunch override = findBrowserOverride();
		if (override != null) {
			return override;
		}

		String os = System.getProperty("os.name").toLowerCase();
		if (os.contains("win")) {
			return findWindowsChromiumBrowser();
		}
		if (os.contains("mac")) {
			return findMacChromiumBrowser();
		}
		return findLinuxChromiumBrowser();
	}

	private static BrowserLaunch findBrowserOverride() {
		String configured = System.getenv(BROWSER_OVERRIDE_ENV);
		if (configured == null || configured.isBlank()) {
			return null;
		}
		File configuredFile = new File(configured.trim());
		if (configuredFile.isFile() && configuredFile.canExecute()) {
			return new BrowserLaunch("Custom Chromium", List.of(configuredFile.getAbsolutePath()));
		}
		File onPath = findExecutableOnPath(configured.trim());
		return onPath == null ? null : new BrowserLaunch("Custom Chromium", List.of(onPath.getAbsolutePath()));
	}

	private static BrowserLaunch findLinuxChromiumBrowser() {
		for (BrowserCandidate candidate : LINUX_CHROMIUM_BROWSERS) {
			File executable = findExecutableOnPath(candidate.executable());
			if (executable != null) {
				return new BrowserLaunch(candidate.displayName(), List.of(executable.getAbsolutePath()));
			}
		}

		File appImage = findLinuxBrowserAppImage();
		return appImage == null ? null : new BrowserLaunch(appImage.getName(), List.of(appImage.getAbsolutePath()));
	}

	private static File findExecutableOnPath(String executableName) {
		if (executableName == null || executableName.isBlank()) {
			return null;
		}
		String userHome = System.getProperty("user.home");
		String[] standardDirectories = {
				"/usr/bin", "/usr/local/bin", "/snap/bin", new File(userHome, ".local/bin").getAbsolutePath()
		};
		for (String directory : standardDirectories) {
			File candidate = new File(directory, executableName);
			if (candidate.isFile() && candidate.canExecute()) {
				return candidate;
			}
		}
		String path = System.getenv("PATH");
		if (path == null || path.isBlank()) {
			return null;
		}
		for (String directory : path.split(java.util.regex.Pattern.quote(File.pathSeparator))) {
			if (directory.isBlank()) {
				continue;
			}
			File candidate = new File(directory, executableName);
			if (candidate.isFile() && candidate.canExecute()) {
				return candidate;
			}
		}
		return null;
	}

	private static File findLinuxBrowserAppImage() {
		String userHome = System.getProperty("user.home");
		File[] directories = {
				new File(userHome, "Applications"),
				new File(userHome, ".local/bin"),
				new File(userHome, "Downloads")
		};
		String[] browserNames = {
				"helium", "chrome", "chromium", "brave", "vivaldi", "opera", "thorium"
		};
		for (File directory : directories) {
			File[] matches = directory.listFiles(file -> {
				if (!file.isFile() || !file.canExecute()) {
					return false;
				}
				String lowerName = file.getName().toLowerCase();
				if (!lowerName.endsWith(".appimage")) {
					return false;
				}
				for (String browserName : browserNames) {
					if (lowerName.contains(browserName)) {
						return true;
					}
				}
				return false;
			});
			if (matches != null && matches.length > 0) {
				Arrays.sort(matches, (left, right) -> Long.compare(right.lastModified(), left.lastModified()));
				return matches[0];
			}
		}
		return null;
	}

	private static BrowserLaunch findMacChromiumBrowser() {
		String userHome = System.getProperty("user.home");
		for (BrowserCandidate candidate : MAC_CHROMIUM_BROWSERS) {
			String appName = candidate.executable() + ".app";
			if (new File("/Applications", appName).isDirectory()
					|| new File(new File(userHome, "Applications"), appName).isDirectory()) {
				return new BrowserLaunch(candidate.displayName(),
						List.of("open", "-a", candidate.executable(), "--args"));
			}
		}
		return null;
	}

	private static BrowserLaunch findWindowsChromiumBrowser() {
		String[] roots = {
				System.getenv("ProgramFiles"),
				System.getenv("ProgramFiles(x86)"),
				System.getenv("ProgramW6432"),
				System.getenv("LocalAppData")
		};
		for (BrowserCandidate candidate : WINDOWS_CHROMIUM_BROWSERS) {
			for (String root : roots) {
				if (root == null || root.isBlank()) {
					continue;
				}
				File executable = new File(root, candidate.executable());
				if (executable.isFile()) {
					return new BrowserLaunch(candidate.displayName(), List.of(executable.getAbsolutePath()));
				}
			}
		}
		for (String executableName : WINDOWS_BROWSER_EXECUTABLES) {
			File executable = findExecutableOnPath(executableName);
			if (executable != null) {
				return new BrowserLaunch(executableName, List.of(executable.getAbsolutePath()));
			}
		}
		return null;
	}

	private static ProcessBuilder getChromiumProcess(BrowserLaunch browser, String... extraArgs) {
		List<String> command = new ArrayList<>(browser.commandPrefix());
		command.addAll(Arrays.asList(extraArgs));
		return new ProcessBuilder(command);
	}

	public static void autoSetupExtensionChromium() {
		try {
			launchChromium("chrome://extensions/");
			System.out.println("Chromium setup completed! Ready status.");
		} catch (Exception e) {
			System.err.println("Error Chromium setup: " + e.getMessage());
		}
	}

	public static void autoSetupExtension() {
		autoSetupExtensionChromium();
	}

	public static void openCaptureBrowser(String url) {
		String targetUrl = url == null || url.trim().isEmpty() ? "https://www.google.com" : url.trim();
		openChromiumCapture(targetUrl);
	}

	private static void openChromiumCapture(String targetUrl) {
		try {
			System.out.println("Deploying Auto-Capture Browser (Chromium) to: " + targetUrl);
			launchChromium(targetUrl);
		} catch (Exception e) {
			System.err.println("Error launching Chromium: " + e.getMessage());
			JOptionPane.showMessageDialog(null,
					"Could not launch Chromium-based browser: " + e.getMessage()
							+ "\nPlease install a Chromium-based browser such as Helium, Chrome, Chromium, Brave, Edge, Vivaldi, Opera, or Thorium.",
					"Browser Launch Error", JOptionPane.ERROR_MESSAGE);
		}
	}

	private static void launchChromium(String targetUrl) throws IOException {
		BrowserLaunch browser = findChromiumBrowser();
		if (browser == null) {
			throw new IOException("No Chromium-based browser was found");
		}
		System.out.println("[Hunter] Using Chromium browser: " + browser.displayName());
		String extPath = ExtensionManager.getExtensionPath();
		File profileDir = new File(CHROME_PROFILE_PATH);
		if (!profileDir.exists() && !profileDir.mkdirs()) {
			throw new IOException("Could not create temporary Chromium profile");
		}
		ProcessBuilder pb = getChromiumProcess(browser, "--user-data-dir=" + CHROME_PROFILE_PATH,
				"--load-extension=" + extPath, "--no-first-run", "--no-default-browser-check", targetUrl);
		pb.start();
	}

}
