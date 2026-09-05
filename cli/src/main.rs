mod api;
mod model;
mod tui;

use std::{
    env,
    io::{self, Write},
    path::PathBuf,
    thread,
    time::Duration,
};

use api::ApiClient;
use clap::{Parser, Subcommand, ValueEnum};
use model::{DownloadTask, LibraryItem};

#[derive(Parser)]
#[command(
    name = "mediasteru",
    version,
    about = "Lightweight terminal client for MediaSteru"
)]
struct Cli {
    #[arg(long, global = true, default_value = "127.0.0.1")]
    host: String,

    #[arg(long, global = true, default_value_t = 8765)]
    port: u16,

    #[arg(
        long,
        global = true,
        help = "Control token (or MEDIASTERU_CONTROL_TOKEN)"
    )]
    token: Option<String>,

    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand)]
enum Command {
    /// Queue a download and wait until it finishes.
    Get(DownloadArgs),
    /// Add a download to the desktop queue without waiting.
    Add(DownloadArgs),
    /// Show the current download queue.
    Status,
    /// Search the local media library.
    Library { query: Option<String> },
    /// Play a library item through mpv.
    Play { id: i64 },
    /// Cancel a queued or active download.
    Cancel { id: String },
    /// Retry a failed or canceled download.
    Retry { id: String },
    /// Open the keyboard-first interactive terminal interface.
    Tui,
}

#[derive(clap::Args)]
struct DownloadArgs {
    url: String,

    #[arg(short, long)]
    output: Option<PathBuf>,

    #[arg(short, long, value_enum, default_value_t = MediaFormat::Mp4)]
    format: MediaFormat,

    #[arg(short, long, value_enum, default_value_t = Quality::P1080)]
    quality: Quality,
}

#[derive(Clone, Copy, ValueEnum)]
enum MediaFormat {
    Mp4,
    Mkv,
    Mp3,
}

impl MediaFormat {
    fn as_str(self) -> &'static str {
        match self {
            Self::Mp4 => "mp4",
            Self::Mkv => "mkv",
            Self::Mp3 => "mp3",
        }
    }
}

#[derive(Clone, Copy, ValueEnum)]
enum Quality {
    #[value(name = "720")]
    P720,
    #[value(name = "1080")]
    P1080,
    #[value(name = "1440")]
    P1440,
    #[value(name = "2160")]
    P2160,
    Best,
}

impl Quality {
    fn as_str(self) -> &'static str {
        match self {
            Self::P720 => "720",
            Self::P1080 => "1080",
            Self::P1440 => "1440",
            Self::P2160 => "2160",
            Self::Best => "best",
        }
    }
}

fn main() {
    if let Err(error) = run() {
        eprintln!("error: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let cli = Cli::parse();
    let token = cli
        .token
        .or_else(|| env::var("MEDIASTERU_CONTROL_TOKEN").ok());
    let api = ApiClient::new(cli.host, cli.port, token);
    match cli.command.unwrap_or(Command::Tui) {
        Command::Get(args) => {
            let task = add_download(&api, &args)?;
            println!("Queued {} ({})", task.name, task.id);
            wait_for_download(&api, &task.id)
        }
        Command::Add(args) => {
            let task = add_download(&api, &args)?;
            println!("{}\t{}\t{}", task.id, task.status, task.name);
            Ok(())
        }
        Command::Status => {
            let status = api.status()?;
            let downloads = api.downloads()?;
            println!(
                "{} API v{} · {}",
                status.app, status.api_version, status.status
            );
            print_downloads(&downloads);
            Ok(())
        }
        Command::Library { query } => {
            print_library(&api.library(query.as_deref())?);
            Ok(())
        }
        Command::Play { id } => {
            api.play(id)?;
            println!("Opened library item {id} in mpv.");
            Ok(())
        }
        Command::Cancel { id } => {
            api.cancel(&id)?;
            println!("Canceled {id}.");
            Ok(())
        }
        Command::Retry { id } => {
            api.retry(&id)?;
            println!("Retrying {id}.");
            Ok(())
        }
        Command::Tui => {
            api.status()?;
            tui::run(api).map_err(|error| error.to_string())
        }
    }
}

fn add_download(api: &ApiClient, args: &DownloadArgs) -> Result<DownloadTask, String> {
    let output = args
        .output
        .as_ref()
        .map(|path| {
            path.to_str()
                .map(str::to_owned)
                .ok_or_else(|| "The output path is not valid UTF-8.".to_owned())
        })
        .transpose()?;
    api.add(
        &args.url,
        output.as_deref(),
        args.format.as_str(),
        args.quality.as_str(),
    )
}

fn wait_for_download(api: &ApiClient, id: &str) -> Result<(), String> {
    loop {
        let task = api
            .downloads()?
            .into_iter()
            .find(|task| task.id == id)
            .ok_or_else(|| format!("Download {id} disappeared from the queue."))?;
        print!(
            "\r{:<12} {:>8}  {}",
            task.status,
            task.progress(),
            task.name
        );
        io::stdout().flush().map_err(|error| error.to_string())?;
        if task.terminal() {
            println!();
            if task.status == "completed" {
                if let Some(path) = task.output_path {
                    println!("Saved to {path}");
                }
                return Ok(());
            }
            return Err(task
                .error
                .unwrap_or_else(|| format!("Download ended as {}.", task.status)));
        }
        thread::sleep(Duration::from_millis(750));
    }
}

fn print_downloads(downloads: &[DownloadTask]) {
    if downloads.is_empty() {
        println!("Queue is clear.");
        return;
    }
    println!(
        "{:<10} {:<11} {:<10} {:<18} NAME",
        "ID", "FORMAT", "STATUS", "PROGRESS"
    );
    for task in downloads {
        println!(
            "{:<10} {:<11} {:<10} {:<18} {}",
            short_id(&task.id),
            format!("{}·{}", task.format.to_uppercase(), task.quality),
            task.status,
            task.progress(),
            task.name,
        );
        if let Some(error) = &task.error {
            println!("  {error}");
        }
    }
}

fn print_library(items: &[LibraryItem]) {
    if items.is_empty() {
        println!("Library is empty.");
        return;
    }
    println!("{:<6} {:<12} {:<20} TITLE", "ID", "FORMAT", "DOWNLOADED");
    for item in items {
        println!(
            "{:<6} {:<12} {:<20} {}",
            item.id,
            item.resolution
                .as_deref()
                .map(|resolution| format!("{}·{resolution}", item.format.to_uppercase()))
                .unwrap_or_else(|| item.format.to_uppercase()),
            item.downloaded_at.chars().take(19).collect::<String>(),
            item.title,
        );
        println!("       {}", item.local_path);
    }
}

fn short_id(id: &str) -> &str {
    id.get(..8).unwrap_or(id)
}
