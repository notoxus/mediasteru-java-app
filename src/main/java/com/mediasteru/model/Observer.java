package com.mediasteru.model;

public interface Observer {
	void onProgressUpdate(String videoId, double percent, String speed);

	void onComplete(String videoId, String savedPath);

	void onError(String videoId, String errorMessage);
}