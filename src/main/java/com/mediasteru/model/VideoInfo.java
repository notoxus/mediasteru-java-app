package com.mediasteru.model;

public class VideoInfo {
	private String id;
	private String title;
	private String webpage_url;
	private double duration;

	public VideoInfo(String id, String title, String webpage_url) {
		this.id = id;
		this.title = title;
		this.webpage_url = webpage_url;
	}

	public String getId() {
		return id;
	}

	public String getTitle() {
		return title;
	}

	public String getWebpage_url() {
		return webpage_url;
	}

	// Duration in whole seconds
	public int getDurationSeconds() {
		return (int) Math.round(duration);
	}

}
