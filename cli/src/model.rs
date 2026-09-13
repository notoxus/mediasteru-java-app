use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadTask {
    pub id: String,
    pub url: String,
    pub name: String,
    pub format: String,
    pub quality: String,
    pub status: String,
    pub percent: f64,
    pub speed: String,
    pub error: Option<String>,
    pub output_path: Option<String>,
}

impl DownloadTask {
    pub fn terminal(&self) -> bool {
        matches!(self.status.as_str(), "completed" | "failed" | "canceled")
    }

    pub fn progress(&self) -> String {
        match self.status.as_str() {
            "completed" => "100%".to_owned(),
            "failed" | "canceled" => "—".to_owned(),
            "processing" => "finalizing".to_owned(),
            _ if self.speed.is_empty() || self.speed == "N/A" => format!("{:.1}%", self.percent),
            _ => format!("{:.1}% · {}", self.percent, self.speed),
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryItem {
    pub id: i64,
    pub title: String,
    pub local_path: String,
    pub format: String,
    pub resolution: Option<String>,
    pub downloaded_at: String,
}

#[derive(Debug, Deserialize)]
pub struct DownloadsResponse {
    pub downloads: Vec<DownloadTask>,
}

#[derive(Debug, Deserialize)]
pub struct DownloadResponse {
    pub download: DownloadTask,
}

#[derive(Debug, Deserialize)]
pub struct LibraryResponse {
    pub items: Vec<LibraryItem>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackState {
    pub status: String,
    pub item_id: Option<i64>,
    pub title: Option<String>,
    pub local_path: Option<String>,
    pub media_kind: Option<String>,
    pub position: f64,
    pub duration: f64,
    pub volume: f64,
    pub queue_index: i64,
    pub queue_length: usize,
}

impl PlaybackState {
    pub fn idle() -> Self {
        Self {
            status: "idle".to_owned(),
            item_id: None,
            title: None,
            local_path: None,
            media_kind: None,
            position: 0.0,
            duration: 0.0,
            volume: 100.0,
            queue_index: -1,
            queue_length: 0,
        }
    }

    pub fn progress(&self) -> f64 {
        if self.duration <= 0.0 {
            0.0
        } else {
            (self.position / self.duration).clamp(0.0, 1.0)
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct PlayerResponse {
    pub player: PlaybackState,
}

#[derive(Debug, Deserialize)]
pub struct StatusResponse {
    pub app: String,
    #[serde(rename = "apiVersion")]
    pub api_version: u8,
    pub status: String,
}

#[derive(Debug, Deserialize)]
pub struct ActionResponse {
    pub status: String,
}

#[derive(Debug, Deserialize)]
pub struct ErrorResponse {
    pub message: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddDownload<'a> {
    pub url: &'a str,
    pub save_path: Option<&'a str>,
    pub format: &'a str,
    pub quality: &'a str,
}
