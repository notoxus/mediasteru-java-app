use std::{
    io::{Read, Write},
    net::TcpStream,
    time::Duration,
};

use serde::{Serialize, de::DeserializeOwned};

use crate::model::{
    ActionResponse, AddDownload, DownloadResponse, DownloadTask, DownloadsResponse, ErrorResponse,
    LibraryItem, LibraryResponse, PlaybackState, PlayerResponse, StatusResponse,
};

#[derive(Clone)]
pub struct ApiClient {
    host: String,
    port: u16,
    token: Option<String>,
}

impl ApiClient {
    pub fn new(host: String, port: u16, token: Option<String>) -> Self {
        Self { host, port, token }
    }

    pub fn status(&self) -> Result<StatusResponse, String> {
        self.request("GET", "/v1/status", None::<&()>)
    }

    pub fn downloads(&self) -> Result<Vec<DownloadTask>, String> {
        Ok(self
            .request::<_, DownloadsResponse>("GET", "/v1/downloads", None::<&()>)?
            .downloads)
    }

    pub fn add(
        &self,
        url: &str,
        save_path: Option<&str>,
        format: &str,
        quality: &str,
    ) -> Result<DownloadTask, String> {
        let request = AddDownload {
            url,
            save_path,
            format,
            quality,
        };
        Ok(self
            .request::<_, DownloadResponse>("POST", "/v1/downloads", Some(&request))?
            .download)
    }

    pub fn cancel(&self, id: &str) -> Result<(), String> {
        let path = format!("/v1/downloads/{}/cancel", encode_path(id));
        let response: ActionResponse = self.request("POST", &path, None::<&()>)?;
        if response.status == "ok" {
            Ok(())
        } else {
            Err("Cancel failed".to_owned())
        }
    }

    pub fn retry(&self, id: &str) -> Result<(), String> {
        let path = format!("/v1/downloads/{}/retry", encode_path(id));
        let response: ActionResponse = self.request("POST", &path, None::<&()>)?;
        if response.status == "ok" {
            Ok(())
        } else {
            Err("Retry failed".to_owned())
        }
    }

    pub fn library(&self, query: Option<&str>) -> Result<Vec<LibraryItem>, String> {
        let path = query
            .filter(|value| !value.is_empty())
            .map(|value| format!("/v1/library?q={}", encode_query(value)))
            .unwrap_or_else(|| "/v1/library".to_owned());
        Ok(self
            .request::<_, LibraryResponse>("GET", &path, None::<&()>)?
            .items)
    }

    pub fn play(&self, id: i64) -> Result<(), String> {
        let response: ActionResponse =
            self.request("POST", &format!("/v1/library/{id}/play"), None::<&()>)?;
        if response.status == "ok" {
            Ok(())
        } else {
            Err("Playback failed".to_owned())
        }
    }

    pub fn player(&self) -> Result<PlaybackState, String> {
        Ok(self
            .request::<_, PlayerResponse>("GET", "/v1/player", None::<&()>)?
            .player)
    }

    pub fn player_command(&self, command: &str) -> Result<PlaybackState, String> {
        Ok(self
            .request::<_, PlayerResponse>("POST", &format!("/v1/player/{command}"), None::<&()>)?
            .player)
    }

    fn request<B: Serialize, R: DeserializeOwned>(
        &self,
        method: &str,
        path: &str,
        body: Option<&B>,
    ) -> Result<R, String> {
        let body = body
            .map(serde_json::to_vec)
            .transpose()
            .map_err(|error| error.to_string())?
            .unwrap_or_default();
        let mut stream = TcpStream::connect((self.host.as_str(), self.port)).map_err(|error| {
            format!(
                "Cannot reach MediaSteru at {}:{} ({error}). Start the Electron app first.",
                self.host, self.port
            )
        })?;
        stream
            .set_read_timeout(Some(Duration::from_secs(10)))
            .map_err(|error| error.to_string())?;
        stream
            .set_write_timeout(Some(Duration::from_secs(10)))
            .map_err(|error| error.to_string())?;

        let mut headers = format!(
            "{method} {path} HTTP/1.1\r\nHost: {}:{}\r\nAccept: application/json\r\nConnection: close\r\n",
            self.host, self.port
        );
        if let Some(token) = &self.token {
            headers.push_str(&format!("Authorization: Bearer {token}\r\n"));
        }
        if !body.is_empty() {
            headers.push_str("Content-Type: application/json\r\n");
            headers.push_str(&format!("Content-Length: {}\r\n", body.len()));
        }
        headers.push_str("\r\n");
        stream
            .write_all(headers.as_bytes())
            .map_err(|error| error.to_string())?;
        stream.write_all(&body).map_err(|error| error.to_string())?;

        let mut response = Vec::new();
        stream
            .read_to_end(&mut response)
            .map_err(|error| error.to_string())?;
        let separator = response
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .ok_or_else(|| "MediaSteru returned an invalid HTTP response.".to_owned())?;
        let head = String::from_utf8_lossy(&response[..separator]);
        let status = head
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .and_then(|value| value.parse::<u16>().ok())
            .ok_or_else(|| "MediaSteru returned an invalid HTTP status.".to_owned())?;
        let raw_body = &response[separator + 4..];
        let payload = if head
            .to_ascii_lowercase()
            .contains("transfer-encoding: chunked")
        {
            decode_chunked(raw_body)?
        } else {
            raw_body.to_vec()
        };
        if !(200..300).contains(&status) {
            let parsed = serde_json::from_slice::<ErrorResponse>(&payload).ok();
            return Err(parsed
                .and_then(|value| value.message)
                .unwrap_or_else(|| format!("MediaSteru returned HTTP {status}.")));
        }
        serde_json::from_slice(&payload)
            .map_err(|error| format!("Invalid MediaSteru response: {error}"))
    }
}

fn decode_chunked(input: &[u8]) -> Result<Vec<u8>, String> {
    let mut cursor = 0;
    let mut output = Vec::new();
    loop {
        let line_end = input[cursor..]
            .windows(2)
            .position(|window| window == b"\r\n")
            .map(|offset| cursor + offset)
            .ok_or_else(|| "Invalid chunked HTTP response.".to_owned())?;
        let size_text = String::from_utf8_lossy(&input[cursor..line_end]);
        let size = usize::from_str_radix(size_text.split(';').next().unwrap_or(""), 16)
            .map_err(|_| "Invalid HTTP chunk size.".to_owned())?;
        cursor = line_end + 2;
        if size == 0 {
            break;
        }
        if cursor + size + 2 > input.len() {
            return Err("Truncated chunked HTTP response.".to_owned());
        }
        output.extend_from_slice(&input[cursor..cursor + size]);
        cursor += size + 2;
    }
    Ok(output)
}

fn encode_path(value: &str) -> String {
    percent_encode(value)
}

fn encode_query(value: &str) -> String {
    percent_encode(value)
}

fn percent_encode(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_chunked_payload() {
        assert_eq!(decode_chunked(b"4\r\ntest\r\n0\r\n\r\n").unwrap(), b"test");
    }

    #[test]
    fn encodes_query_text() {
        assert_eq!(encode_query("hello world/đ"), "hello%20world%2F%C4%91");
    }
}
