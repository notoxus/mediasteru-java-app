use std::{
    io,
    time::{Duration, Instant},
};

use crossterm::{
    event::{self, Event, KeyCode, KeyEventKind},
    execute,
    terminal::{EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode},
};
use ratatui::{
    Terminal,
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout},
    style::{Color, Modifier, Style},
    text::Line,
    widgets::{Block, Borders, Cell, Gauge, Paragraph, Row, Table, TableState, Tabs},
};

use crate::{
    api::ApiClient,
    model::{DownloadTask, LibraryItem, PlaybackState},
};

#[derive(Clone, Copy, PartialEq)]
enum View {
    Downloads,
    Library,
}

struct App {
    api: ApiClient,
    view: View,
    downloads: Vec<DownloadTask>,
    library: Vec<LibraryItem>,
    player: PlaybackState,
    selected: usize,
    input: String,
    editing: bool,
    searching: bool,
    library_query: String,
    message: String,
    last_refresh: Instant,
}

impl App {
    fn new(api: ApiClient) -> Self {
        Self {
            api,
            view: View::Downloads,
            downloads: Vec::new(),
            library: Vec::new(),
            player: PlaybackState::idle(),
            selected: 0,
            input: String::new(),
            editing: false,
            searching: false,
            library_query: String::new(),
            message: "Connected to the local MediaSteru core.".to_owned(),
            last_refresh: Instant::now() - Duration::from_secs(2),
        }
    }

    fn refresh(&mut self) {
        if self.last_refresh.elapsed() < Duration::from_millis(750) {
            return;
        }
        self.last_refresh = Instant::now();
        match (
            self.api.downloads(),
            self.api
                .library((!self.library_query.is_empty()).then_some(self.library_query.as_str())),
            self.api.player(),
        ) {
            (Ok(downloads), Ok(library), Ok(player)) => {
                self.downloads = downloads;
                self.library = library;
                self.player = player;
                self.clamp_selection();
            }
            (Err(error), _, _) | (_, Err(error), _) | (_, _, Err(error)) => self.message = error,
        }
    }

    fn clamp_selection(&mut self) {
        let len = if self.view == View::Downloads {
            self.downloads.len()
        } else {
            self.library.len()
        };
        self.selected = self.selected.min(len.saturating_sub(1));
    }

    fn move_selection(&mut self, offset: isize) {
        let len = if self.view == View::Downloads {
            self.downloads.len()
        } else {
            self.library.len()
        };
        if len == 0 {
            self.selected = 0;
            return;
        }
        self.selected = (self.selected as isize + offset).clamp(0, len as isize - 1) as usize;
    }

    fn submit_input(&mut self) {
        if self.searching {
            self.library_query = self.input.trim().to_owned();
            self.input.clear();
            self.editing = false;
            self.searching = false;
            self.selected = 0;
            self.message = if self.library_query.is_empty() {
                "Library filter cleared.".to_owned()
            } else {
                format!("Filtering library by ‘{}’. ", self.library_query)
            };
            self.last_refresh = Instant::now() - Duration::from_secs(2);
            return;
        }
        let url = self.input.trim().to_owned();
        if url.is_empty() {
            return;
        }
        match self.api.add(&url, None, "mp4", "1080") {
            Ok(task) => {
                self.message = format!("Queued {}", task.name);
                self.input.clear();
                self.editing = false;
                self.last_refresh = Instant::now() - Duration::from_secs(2);
            }
            Err(error) => self.message = error,
        }
    }

    fn cancel_selected(&mut self) {
        if let Some(task) = self.downloads.get(self.selected) {
            self.message = match self.api.cancel(&task.id) {
                Ok(()) => format!("Canceled {}", task.name),
                Err(error) => error,
            };
        }
    }

    fn retry_selected(&mut self) {
        if let Some(task) = self.downloads.get(self.selected) {
            self.message = match self.api.retry(&task.id) {
                Ok(()) => format!("Retrying {}", task.name),
                Err(error) => error,
            };
        }
    }

    fn play_selected(&mut self) {
        if let Some(item) = self.library.get(self.selected) {
            self.message = match self.api.play(item.id) {
                Ok(()) => format!("Playing {}", item.title),
                Err(error) => error,
            };
        }
    }

    fn control_player(&mut self, command: &str) {
        match self.api.player_command(command) {
            Ok(player) => {
                self.player = player;
                self.message = match command {
                    "toggle" => format!("Player is {}.", self.player.status),
                    "next" => "Playing the next item.".to_owned(),
                    "previous" => "Playing the previous item.".to_owned(),
                    "stop" => "Playback stopped.".to_owned(),
                    _ => "Playback updated.".to_owned(),
                };
            }
            Err(error) => self.message = error,
        }
    }
}

pub fn run(api: ApiClient) -> io::Result<()> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;
    let result = run_loop(&mut terminal, App::new(api));
    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;
    result
}

fn run_loop(terminal: &mut Terminal<CrosstermBackend<io::Stdout>>, mut app: App) -> io::Result<()> {
    loop {
        app.refresh();
        terminal.draw(|frame| draw(frame, &app))?;
        if !event::poll(Duration::from_millis(100))? {
            continue;
        }
        let Event::Key(key) = event::read()? else {
            continue;
        };
        if key.kind != KeyEventKind::Press {
            continue;
        }
        if app.editing {
            match key.code {
                KeyCode::Esc => {
                    app.editing = false;
                    app.searching = false;
                    app.input.clear();
                }
                KeyCode::Enter => app.submit_input(),
                KeyCode::Backspace => {
                    app.input.pop();
                }
                KeyCode::Char(character) => app.input.push(character),
                _ => {}
            }
            continue;
        }
        match key.code {
            KeyCode::Char('q') => return Ok(()),
            KeyCode::Char('1') => {
                app.view = View::Downloads;
                app.selected = 0;
            }
            KeyCode::Char('2') => {
                app.view = View::Library;
                app.selected = 0;
            }
            KeyCode::Down | KeyCode::Char('j') => app.move_selection(1),
            KeyCode::Up | KeyCode::Char('k') => app.move_selection(-1),
            KeyCode::Char('a') | KeyCode::Char('d') => {
                app.editing = true;
                app.searching = false;
                app.input.clear();
                app.view = View::Downloads;
            }
            KeyCode::Char('/') if app.view == View::Library => {
                app.editing = true;
                app.searching = true;
                app.input.clone_from(&app.library_query);
            }
            KeyCode::Char('c') if app.view == View::Downloads => app.cancel_selected(),
            KeyCode::Char('r') if app.view == View::Downloads => app.retry_selected(),
            KeyCode::Char('p') if app.view == View::Library => app.play_selected(),
            KeyCode::Char(' ') => app.control_player("toggle"),
            KeyCode::Char('n') => app.control_player("next"),
            KeyCode::Char('N') => app.control_player("previous"),
            KeyCode::Char('s') => app.control_player("stop"),
            _ => {}
        }
    }
}

fn draw(frame: &mut ratatui::Frame<'_>, app: &App) {
    let areas = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),
            Constraint::Length(if app.editing { 3 } else { 0 }),
            Constraint::Min(8),
            Constraint::Length(3),
            Constraint::Length(3),
        ])
        .split(frame.area());

    let active = Style::default()
        .fg(Color::Rgb(133, 167, 255))
        .add_modifier(Modifier::BOLD);
    let tabs = Tabs::new(vec![Line::from("1 Downloads"), Line::from("2 Library")])
        .select(if app.view == View::Downloads { 0 } else { 1 })
        .highlight_style(active)
        .divider("  ")
        .block(
            Block::default()
                .title(" MediaSteru · local · 2 slots ")
                .borders(Borders::ALL),
        );
    frame.render_widget(tabs, areas[0]);

    if app.editing {
        frame.render_widget(
            Paragraph::new(format!("> {}", app.input))
                .style(Style::default().fg(Color::Cyan))
                .block(
                    Block::default()
                        .title(if app.searching {
                            " Library search · Enter to apply · Esc to cancel "
                        } else {
                            " URL · Enter to queue · Esc to cancel "
                        })
                        .borders(Borders::ALL),
                ),
            areas[1],
        );
    }

    match app.view {
        View::Downloads => draw_downloads(frame, areas[2], app),
        View::Library => draw_library(frame, areas[2], app),
    }
    draw_player(frame, areas[3], app);
    let help = match app.view {
        View::Downloads => {
            " a/d add · j/k move · c cancel · r retry · Space pause · n/N next/prev · q quit "
        }
        View::Library => {
            " / search · j/k move · p play · Space pause · n/N next/prev · s stop · q quit "
        }
    };
    let selected_error = (app.view == View::Downloads)
        .then(|| app.downloads.get(app.selected))
        .flatten()
        .and_then(|task| task.error.as_deref());
    let status_text = selected_error
        .map(|error| format!("Error: {error}"))
        .unwrap_or_else(|| app.message.clone());
    frame.render_widget(
        Paragraph::new(status_text)
            .block(Block::default().title(help).borders(Borders::ALL))
            .style(Style::default().fg(if selected_error.is_some() {
                Color::LightRed
            } else {
                Color::Gray
            })),
        areas[4],
    );
}

fn draw_player(frame: &mut ratatui::Frame<'_>, area: ratatui::layout::Rect, app: &App) {
    if app.player.status == "idle" {
        frame.render_widget(
            Paragraph::new("No active media · select a Library item and press p")
                .style(Style::default().fg(Color::DarkGray))
                .block(
                    Block::default()
                        .title(" Now Playing ")
                        .borders(Borders::ALL),
                ),
            area,
        );
        return;
    }
    let title = app.player.title.as_deref().unwrap_or("Unknown title");
    let elapsed = format_duration(app.player.position);
    let duration = format_duration(app.player.duration);
    let queue_position = if app.player.queue_index >= 0 {
        app.player.queue_index + 1
    } else {
        0
    };
    frame.render_widget(
        Gauge::default()
            .block(
                Block::default()
                    .title(format!(" Now Playing · {title} · {} ", app.player.status))
                    .borders(Borders::ALL),
            )
            .gauge_style(Style::default().fg(Color::Rgb(133, 167, 255)))
            .ratio(app.player.progress())
            .label(format!(
                "{elapsed} / {duration} · {queue_position}/{} · {:.0}%",
                app.player.queue_length, app.player.volume,
            )),
        area,
    );
}

fn format_duration(seconds: f64) -> String {
    let total = seconds.max(0.0).round() as u64;
    format!("{}:{:02}", total / 60, total % 60)
}

fn draw_downloads(frame: &mut ratatui::Frame<'_>, area: ratatui::layout::Rect, app: &App) {
    let header = Row::new(["Name / URL", "Format", "Status", "Progress"]).style(
        Style::default()
            .fg(Color::Rgb(133, 167, 255))
            .add_modifier(Modifier::BOLD),
    );
    let rows = app.downloads.iter().map(|task| {
        Row::new([
            Cell::from(if task.name.is_empty() {
                task.url.clone()
            } else {
                task.name.clone()
            }),
            Cell::from(format!("{} · {}", task.format.to_uppercase(), task.quality)),
            Cell::from(task.status.clone()),
            Cell::from(task.progress()),
        ])
    });
    let table = Table::new(
        rows,
        [
            Constraint::Percentage(48),
            Constraint::Length(14),
            Constraint::Length(12),
            Constraint::Min(16),
        ],
    )
    .header(header)
    .row_highlight_style(Style::default().bg(Color::Rgb(26, 34, 50)).fg(Color::White))
    .highlight_symbol("› ")
    .block(
        Block::default()
            .title(" Download queue ")
            .borders(Borders::ALL),
    );
    let mut state =
        TableState::default().with_selected((!app.downloads.is_empty()).then_some(app.selected));
    frame.render_stateful_widget(table, area, &mut state);
}

fn draw_library(frame: &mut ratatui::Frame<'_>, area: ratatui::layout::Rect, app: &App) {
    let header = Row::new(["ID", "Title", "Format", "Path"]).style(
        Style::default()
            .fg(Color::Rgb(133, 167, 255))
            .add_modifier(Modifier::BOLD),
    );
    let rows = app.library.iter().map(|item| {
        Row::new([
            Cell::from(item.id.to_string()),
            Cell::from(item.title.clone()),
            Cell::from(
                item.resolution
                    .as_deref()
                    .map(|value| format!("{} · {value}", item.format.to_uppercase()))
                    .unwrap_or_else(|| item.format.to_uppercase()),
            ),
            Cell::from(item.local_path.clone()),
        ])
    });
    let table = Table::new(
        rows,
        [
            Constraint::Length(6),
            Constraint::Percentage(36),
            Constraint::Length(14),
            Constraint::Percentage(48),
        ],
    )
    .header(header)
    .row_highlight_style(Style::default().bg(Color::Rgb(26, 34, 50)).fg(Color::White))
    .highlight_symbol("› ")
    .block(
        Block::default()
            .title(" Local library ")
            .borders(Borders::ALL),
    );
    let mut state =
        TableState::default().with_selected((!app.library.is_empty()).then_some(app.selected));
    frame.render_stateful_widget(table, area, &mut state);
}
