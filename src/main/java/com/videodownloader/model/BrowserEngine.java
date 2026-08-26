package com.videodownloader.model;

public enum BrowserEngine {
	AUTO("Auto Detect"),
	CHROMIUM("Chromium / Chrome");

	private final String displayName;

	BrowserEngine(String displayName) {
		this.displayName = displayName;
	}

	public String getDisplayName() {
		return displayName;
	}

	@Override
	public String toString() {
		return displayName;
	}

	public static BrowserEngine fromString(String text) {
		if (text == null) {
			return AUTO;
		}
		for (BrowserEngine engine : BrowserEngine.values()) {
			if (engine.name().equalsIgnoreCase(text) || engine.displayName.equalsIgnoreCase(text)) {
				return engine;
			}
		}
		return AUTO;
	}
}
