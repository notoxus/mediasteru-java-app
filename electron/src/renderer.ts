// Browser-only presentation layer. All durable state and process orchestration
// live in the main process; this file renders snapshots and forwards intent.
type DownloadFormat = 'mp4' | 'mkv' | 'mp3';
type DownloadQuality = '360' | '720' | '1080' | '1440' | '2160' | 'best';
type DownloadTaskStatus =
  | 'waiting'
  | 'queued'
  | 'preparing'
  | 'downloading'
  | 'processing'
  | 'pausing'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'canceled';

interface CapturedMedia {
  url: string;
  title?: string;
  referer?: string;
  requestHeaders: Record<string, string>;
  manifestBody?: string;
  format?: DownloadFormat;
  quality?: DownloadQuality;
}

interface DownloadTask {
  id: string;
  url: string;
  savePath: string;
  format: DownloadFormat;
  quality: DownloadQuality;
  referer?: string;
  requestHeaders?: Record<string, string>;
  name: string;
  status: DownloadTaskStatus;
  percent: number;
  speed: string;
  error?: string;
  outputPath?: string;
  createdAt: string;
  updatedAt: string;
}

interface LibraryItem {
  id: number;
  sourceUrl: string;
  title: string;
  localPath: string;
  format: DownloadFormat;
  resolution: string | null;
  downloadedAt: string;
  lastPlayedAt: string | null;
  playbackPosition: number;
}

type PlaybackStatus = 'idle' | 'playing' | 'paused';

interface PlaybackState {
  status: PlaybackStatus;
  itemId: number | null;
  title: string | null;
  localPath: string | null;
  mediaKind: 'audio' | 'video' | null;
  position: number;
  duration: number;
  volume: number;
  queueIndex: number;
  queueLength: number;
}

const tasks = new Map<string, DownloadTask>();
const selectedTaskIds = new Set<string>();
let libraryItems: LibraryItem[] = [];
let outputFolder = '';
let hunting = false;
let mpvAvailable = false;
let playbackState: PlaybackState = {
  status: 'idle',
  itemId: null,
  title: null,
  localPath: null,
  mediaKind: null,
  position: 0,
  duration: 0,
  volume: 100,
  queueIndex: -1,
  queueLength: 0,
};

const byId = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing UI element: ${id}`);
  return node as T;
};

const urlInput = byId<HTMLInputElement>('url-input');
const folderInput = byId<HTMLInputElement>('folder-input');
const formatSelect = byId<HTMLSelectElement>('format-select');
const qualitySelect = byId<HTMLSelectElement>('quality-select');
const queueBody = byId<HTMLTableSectionElement>('queue-body');
const queueSelectAll = byId<HTMLInputElement>('queue-select-all');
const startSelectedButton = byId<HTMLButtonElement>('start-selected-button');
const emptyState = byId<HTMLDivElement>('empty-state');
const statusText = byId<HTMLSpanElement>('status-text');
const huntButton = byId<HTMLButtonElement>('hunt-button');
const libraryList = byId<HTMLDivElement>('library-list');
const libraryEmpty = byId<HTMLDivElement>('library-empty');
const librarySearch = byId<HTMLInputElement>('library-search');
const taskOptionsDialog = byId<HTMLDialogElement>('task-options-dialog');
const taskOptionsForm = byId<HTMLFormElement>('task-options-form');
const taskFormatSelect = byId<HTMLSelectElement>('task-format-select');
const taskQualitySelect = byId<HTMLSelectElement>('task-quality-select');
let configuringTaskId: string | null = null;

function setStatus(message: string, kind: 'info' | 'success' | 'warning' | 'error' = 'info'): void {
  statusText.textContent = message;
  if (kind === 'warning' || kind === 'error') void window.mediaSteru.showNotice(message, kind);
}

function labelForUrl(value: string): string {
  try {
    const url = new URL(value);
    const tail = url.pathname.split('/').filter(Boolean).pop();
    return tail ? `${url.hostname} · ${decodeURIComponent(tail).slice(0, 58)}` : url.hostname;
  } catch {
    return value.slice(0, 72);
  }
}

function statusLabel(status: DownloadTaskStatus): string {
  return {
    waiting: 'Review',
    queued: 'Queued',
    preparing: 'Preparing',
    downloading: 'Downloading',
    processing: 'Processing',
    pausing: 'Pausing',
    paused: 'Paused',
    completed: 'Done',
    failed: 'Failed',
    canceled: 'Canceled',
  }[status];
}

function formatProgress(task: DownloadTask): string {
  if (task.status === 'waiting') return 'Not started';
  if (task.status === 'completed') return '100%';
  if (task.status === 'failed' || task.status === 'canceled') return '—';
  if (task.status === 'paused') return `${task.percent.toFixed(1)}% · paused`;
  if (task.status === 'pausing') return `${task.percent.toFixed(1)}% · pausing`;
  if (task.status === 'processing') return 'Finalizing';
  const percent = `${task.percent.toFixed(1)}%`;
  return task.speed && task.speed !== 'N/A' ? `${percent} · ${task.speed}` : percent;
}

function taskActions(task: DownloadTask): string {
  if (task.status === 'completed' && task.outputPath) {
    return `
      <button class="row-action primary-action" data-action="play" data-id="${task.id}" ${mpvAvailable ? '' : 'disabled'} title="${mpvAvailable ? 'Play with mpv' : 'Install mpv to play'}">Play</button>
      <button class="row-action" data-action="show" data-id="${task.id}" title="Show in folder">Folder</button>
      <button class="row-action" data-action="copy" data-id="${task.id}" title="Copy file path">Copy</button>
      <button class="row-action danger-action" data-action="remove" data-id="${task.id}">Remove</button>
    `;
  }
  if (task.status === 'failed' || task.status === 'canceled') {
    return `
      <button class="row-action primary-action" data-action="retry" data-id="${task.id}">Download</button>
      <button class="row-action danger-action" data-action="remove" data-id="${task.id}">Remove</button>
    `;
  }
  if (task.status === 'waiting') {
    return `
      <button class="row-action" data-action="options" data-id="${task.id}">Options</button>
      <button class="row-action primary-action" data-action="download" data-id="${task.id}">Download</button>
      <button class="row-action danger-action" data-action="remove" data-id="${task.id}">Remove</button>
    `;
  }
  if (task.status === 'paused') {
    return `
      <button class="row-action primary-action" data-action="resume" data-id="${task.id}">Resume</button>
      <button class="row-action" data-action="cancel" data-id="${task.id}">Cancel</button>
      <button class="row-action danger-action" data-action="remove" data-id="${task.id}">Remove</button>
    `;
  }
  if (task.status === 'pausing') {
    return `
      <button class="row-action" disabled>Pausing…</button>
      <button class="row-action" data-action="cancel" data-id="${task.id}">Cancel</button>
      <button class="row-action danger-action" data-action="remove" data-id="${task.id}">Remove</button>
    `;
  }
  return `
    <button class="row-action primary-action" data-action="pause" data-id="${task.id}">Pause</button>
    <button class="row-action" data-action="cancel" data-id="${task.id}">Cancel</button>
    <button class="row-action danger-action" data-action="remove" data-id="${task.id}">Remove</button>
  `;
}

function openTaskOptions(task: DownloadTask): void {
  if (task.status !== 'waiting') return;
  configuringTaskId = task.id;
  taskFormatSelect.value = task.format;
  taskQualitySelect.value = task.quality;
  taskQualitySelect.disabled = task.format === 'mp3';
  taskOptionsDialog.showModal();
  taskFormatSelect.focus();
}

function renderQueue(): void {
  for (const id of selectedTaskIds) {
    if (tasks.get(id)?.status !== 'waiting') selectedTaskIds.delete(id);
  }
  const waitingTasks = [...tasks.values()].filter((task) => task.status === 'waiting');
  const selectedWaitingCount = waitingTasks.filter((task) => selectedTaskIds.has(task.id)).length;
  queueSelectAll.disabled = waitingTasks.length === 0;
  queueSelectAll.checked = waitingTasks.length > 0 && selectedWaitingCount === waitingTasks.length;
  queueSelectAll.indeterminate = selectedWaitingCount > 0 && selectedWaitingCount < waitingTasks.length;
  startSelectedButton.disabled = selectedWaitingCount === 0;
  startSelectedButton.textContent = selectedWaitingCount > 0
    ? `Start Selected (${selectedWaitingCount})`
    : 'Start Selected';
  queueBody.replaceChildren();
  emptyState.hidden = tasks.size > 0;
  byId<HTMLSpanElement>('download-count').textContent = String(tasks.size);
  let index = 1;
  for (const task of tasks.values()) {
    const row = document.createElement('tr');
    const progressClass = task.status === 'failed' ? ' failed' : '';
    row.innerHTML = `
      <td class="index-cell">
        <input class="queue-selector" type="checkbox" data-task-select="${task.id}"
          aria-label="Select queue item ${index}" ${task.status === 'waiting' ? '' : 'disabled'}
          ${selectedTaskIds.has(task.id) ? 'checked' : ''} />
        <span>${index}</span>
      </td>
      <td class="media-cell">
        <span class="media-name"></span>
        <span class="media-url"></span>
      </td>
      <td><span class="format-chip">${task.format.toUpperCase()} · ${task.format === 'mp3' ? 'Audio' : task.quality === 'best' ? 'Best' : `${task.quality}p`}</span></td>
      <td><span class="task-status status-${task.status}">${statusLabel(task.status)}</span></td>
      <td class="progress-cell">
        <div class="progress-track"><div class="progress-fill${progressClass}" style="width:${Math.max(0, Math.min(100, task.percent))}%"></div></div>
        <span>${formatProgress(task)}</span>
      </td>
      <td class="action-cell">${taskActions(task)}</td>
    `;
    row.querySelector<HTMLElement>('.media-name')!.textContent = task.name;
    row.querySelector<HTMLElement>('.media-url')!.textContent = task.error || task.url;
    queueBody.append(row);
    index += 1;
  }
}

function renderLibrary(): void {
  const query = librarySearch.value.trim().toLocaleLowerCase();
  const visible = libraryItems.filter((item) => !query
    || item.title.toLocaleLowerCase().includes(query)
    || item.localPath.toLocaleLowerCase().includes(query));
  libraryList.replaceChildren();
  libraryEmpty.hidden = visible.length > 0;
  libraryEmpty.querySelector('h3')!.textContent = libraryItems.length > 0
    ? 'No matching media'
    : 'Your library is empty';
  byId<HTMLSpanElement>('library-count').textContent = String(libraryItems.length);
  for (const item of visible) {
    const isPlaying = playbackState.status !== 'idle' && playbackState.localPath === item.localPath;
    const row = document.createElement('article');
    row.className = 'library-item';
    row.innerHTML = `
      <div class="media-glyph">${item.format === 'mp3' ? '♪' : '▶'}</div>
      <div class="library-meta">
        <strong></strong>
        <span></span>
      </div>
      <span class="format-chip">${item.format.toUpperCase()}${item.resolution ? ` · ${item.resolution}` : ''}</span>
      <div class="library-actions">
        <button class="button ${isPlaying ? 'danger-action' : 'subtle'}" data-library-action="${isPlaying ? 'stop' : 'play'}" data-path="" ${mpvAvailable ? '' : 'disabled'}>${isPlaying ? 'Stop' : 'Play'}</button>
        <button class="button subtle" data-library-action="show" data-path="">Folder</button>
        <button class="button subtle" data-library-action="copy" data-path="">Copy path</button>
      </div>
    `;
    row.querySelector('strong')!.textContent = item.title;
    row.querySelector('.library-meta span')!.textContent = item.localPath;
    row.querySelectorAll<HTMLElement>('[data-path]').forEach((button) => { button.dataset.path = item.localPath; });
    libraryList.append(row);
  }
}

async function ensureOutputFolder(): Promise<string | null> {
  if (outputFolder) return outputFolder;
  const selected = await window.mediaSteru.chooseFolder();
  if (!selected) {
    setStatus('Choose an output folder before starting a download.', 'warning');
    return null;
  }
  outputFolder = selected;
  folderInput.value = selected;
  return selected;
}

async function enqueue(url: string, capture?: CapturedMedia): Promise<void> {
  const savePath = await ensureOutputFolder();
  if (!savePath) return;
  try {
    await window.mediaSteru.startDownload({
      id: crypto.randomUUID(),
      url,
      savePath,
      format: capture?.format ?? formatSelect.value as DownloadFormat,
      quality: capture?.quality ?? qualitySelect.value as DownloadQuality,
      referer: capture?.referer,
      requestHeaders: capture?.requestHeaders,
      manifestBody: capture?.manifestBody,
      name: capture?.title?.trim() || labelForUrl(url),
    });
    setStatus('Added for review. Select it when you are ready to download.', 'info');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), 'error');
  }
}

function applyQueueSnapshot(snapshot: DownloadTask[]): void {
  const completedNow = snapshot.find((task) => task.status === 'completed'
    && tasks.get(task.id)?.status !== 'completed');
  const failedNow = snapshot.find((task) => task.status === 'failed'
    && tasks.get(task.id)?.status !== 'failed');
  tasks.clear();
  for (const task of snapshot) tasks.set(task.id, task);
  const active = snapshot.find((task) => ['preparing', 'downloading', 'processing', 'pausing'].includes(task.status));
  if (active) {
    setStatus(`${statusLabel(active.status)} ${active.name}${active.status === 'downloading' ? ` — ${active.percent.toFixed(1)}%` : ''}`);
  } else if (failedNow) {
    setStatus(failedNow.error || `Could not download ${failedNow.name}.`, 'error');
  } else if (completedNow) {
    setStatus(`${completedNow.name} downloaded successfully.`, 'success');
  }
  renderQueue();
}

async function runMediaAction(action: string, path: string): Promise<void> {
  try {
    if (action === 'play') {
      await window.mediaSteru.playMedia(path);
      setStatus('Opened in mpv.', 'success');
    } else if (action === 'stop') {
      playbackState = await window.mediaSteru.controlPlayer('stop');
      renderLibrary();
      setStatus('Playback stopped.', 'info');
    } else if (action === 'show') {
      await window.mediaSteru.showMedia(path);
    } else if (action === 'copy') {
      await window.mediaSteru.writeClipboard(path);
      setStatus('File path copied.', 'success');
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), 'error');
  }
}

byId<HTMLButtonElement>('folder-button').addEventListener('click', async () => {
  const selected = await window.mediaSteru.chooseFolder();
  if (selected) {
    outputFolder = selected;
    folderInput.value = selected;
    setStatus('Output folder selected.', 'success');
  }
});

byId<HTMLButtonElement>('paste-button').addEventListener('click', async () => {
  const text = (await window.mediaSteru.readClipboard()).trim();
  const match = text.match(/https?:\/\/\S+/i);
  if (!match) {
    setStatus('The clipboard does not contain an HTTP link.', 'warning');
    return;
  }
  urlInput.value = match[0];
  setStatus('Link pasted from the clipboard.', 'success');
});

byId<HTMLButtonElement>('import-button').addEventListener('click', async () => {
  const savePath = await ensureOutputFolder();
  if (!savePath) return;
  try {
    const items = await window.mediaSteru.importList();
    for (const item of items) {
      await window.mediaSteru.startDownload({
        id: crypto.randomUUID(),
        url: item.url,
        savePath,
        format: formatSelect.value as DownloadFormat,
        quality: qualitySelect.value as DownloadQuality,
        name: item.name,
      });
    }
    if (items.length > 0) setStatus(`${items.length} items added for review.`, 'success');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), 'error');
  }
});

byId<HTMLButtonElement>('download-button').addEventListener('click', async () => {
  const url = urlInput.value.trim();
  if (!url) {
    setStatus('Paste a URL to download directly.', 'warning');
    urlInput.focus();
    return;
  }
  await enqueue(url);
  urlInput.value = '';
});

urlInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    byId<HTMLButtonElement>('download-button').click();
  }
});

huntButton.addEventListener('click', async () => {
  if (hunting) {
    setStatus('The capture browser is already open.', 'warning');
    return;
  }
  if (!await ensureOutputFolder()) return;
  const target = urlInput.value.trim() || 'https://www.google.com';
  try {
    hunting = true;
    huntButton.disabled = true;
    huntButton.textContent = 'Hunter open';
    await window.mediaSteru.openHunter(target);
    setStatus('Play a video in the capture window. The stream will be detected automatically.');
  } catch (error) {
    hunting = false;
    huntButton.disabled = false;
    huntButton.textContent = 'Open Hunter';
    setStatus(error instanceof Error ? error.message : String(error), 'error');
  }
});

formatSelect.addEventListener('change', () => {
  const audioOnly = formatSelect.value === 'mp3';
  qualitySelect.disabled = audioOnly;
  qualitySelect.title = audioOnly ? 'Video quality does not apply to MP3 audio' : '';
});
librarySearch.addEventListener('input', renderLibrary);

function activateView(view: 'downloads' | 'library'): void {
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((item) => {
    const active = item.dataset.view === view;
    item.classList.toggle('active', active);
    item.setAttribute('aria-pressed', String(active));
  });
  byId('downloads-view').hidden = view !== 'downloads';
  byId('library-view').hidden = view !== 'library';
  if (view === 'library') librarySearch.focus();
}

document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => {
  button.addEventListener('click', () => activateView(button.dataset.view as 'downloads' | 'library'));
});

document.addEventListener('keydown', (event) => {
  const commandKey = event.ctrlKey || event.metaKey;
  if (commandKey && event.key.toLocaleLowerCase() === 'l') {
    event.preventDefault();
    activateView('downloads');
    urlInput.focus();
    urlInput.select();
  } else if (commandKey && event.key.toLocaleLowerCase() === 'o') {
    event.preventDefault();
    byId<HTMLButtonElement>('import-button').click();
  } else if (commandKey && event.key === 'Enter') {
    event.preventDefault();
    byId<HTMLButtonElement>('download-button').click();
  } else if (event.altKey && event.key === '1') {
    event.preventDefault();
    activateView('downloads');
  } else if (event.altKey && event.key === '2') {
    event.preventDefault();
    activateView('library');
  }
});

queueBody.addEventListener('click', async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
  if (!button) return;
  const task = tasks.get(button.dataset.id ?? '');
  if (!task) return;
  const action = button.dataset.action;
  try {
    if (action === 'options') {
      openTaskOptions(task);
    } else if (action === 'download') {
      button.disabled = true;
      button.textContent = 'Starting…';
      const started = await window.mediaSteru.startSelectedDownloads([task.id]);
      if (started !== 1) throw new Error('Could not start this download.');
    } else if (action === 'pause') {
      button.disabled = true;
      button.textContent = 'Pausing…';
      if (!await window.mediaSteru.pauseDownload(task.id)) throw new Error('Could not pause this download.');
    } else if (action === 'resume') {
      button.disabled = true;
      button.textContent = 'Resuming…';
      if (!await window.mediaSteru.resumeDownload(task.id)) throw new Error('Could not resume this download.');
    } else if (action === 'cancel') {
      button.disabled = true;
      button.textContent = 'Stopping…';
      if (!await window.mediaSteru.cancelDownload(task.id)) throw new Error('Could not cancel this download.');
    } else if (action === 'remove') {
      button.disabled = true;
      button.textContent = 'Removing…';
      if (!await window.mediaSteru.removeDownload(task.id)) throw new Error('Could not remove this queue item.');
    } else if (action === 'retry') {
      if (!await window.mediaSteru.retryDownload(task.id)) throw new Error('Could not restart this download.');
    } else if (task.outputPath && action) {
      await runMediaAction(action, task.outputPath);
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), 'error');
    renderQueue();
  }
});

taskFormatSelect.addEventListener('change', () => {
  taskQualitySelect.disabled = taskFormatSelect.value === 'mp3';
});
byId<HTMLButtonElement>('task-options-cancel').addEventListener('click', () => {
  configuringTaskId = null;
  taskOptionsDialog.close();
});
taskOptionsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = configuringTaskId;
  if (!id) return;
  const saveButton = byId<HTMLButtonElement>('task-options-save');
  saveButton.disabled = true;
  try {
    const updated = await window.mediaSteru.updateDownloadOptions(id, {
      format: taskFormatSelect.value as DownloadFormat,
      quality: taskQualitySelect.value as DownloadQuality,
    });
    if (!updated) throw new Error('This queue item is no longer waiting for review.');
    taskOptionsDialog.close();
    configuringTaskId = null;
    setStatus('Download options saved. Select the item when you are ready to start it.', 'success');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    saveButton.disabled = false;
  }
});

queueBody.addEventListener('change', (event) => {
  const checkbox = (event.target as HTMLElement).closest<HTMLInputElement>('[data-task-select]');
  const id = checkbox?.dataset.taskSelect;
  if (!checkbox || !id || tasks.get(id)?.status !== 'waiting') return;
  if (checkbox.checked) selectedTaskIds.add(id);
  else selectedTaskIds.delete(id);
  renderQueue();
});

queueSelectAll.addEventListener('change', () => {
  for (const task of tasks.values()) {
    if (task.status !== 'waiting') continue;
    if (queueSelectAll.checked) selectedTaskIds.add(task.id);
    else selectedTaskIds.delete(task.id);
  }
  renderQueue();
});

startSelectedButton.addEventListener('click', async () => {
  const ids = [...selectedTaskIds].filter((id) => tasks.get(id)?.status === 'waiting');
  if (ids.length === 0) return;
  startSelectedButton.disabled = true;
  try {
    const started = await window.mediaSteru.startSelectedDownloads(ids);
    selectedTaskIds.clear();
    setStatus(`${started} selected ${started === 1 ? 'download' : 'downloads'} started.`, 'success');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), 'error');
  }
});

libraryList.addEventListener('click', async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-library-action]');
  const action = button?.dataset.libraryAction;
  const path = button?.dataset.path;
  if (action && path) await runMediaAction(action, path);
});

window.mediaSteru.onCaptured((capture) => {
  setStatus('Stream candidate found. Review it in the queue before downloading.', 'success');
  void enqueue(capture.url, capture);
});
window.mediaSteru.onHunterClosed(() => {
  hunting = false;
  huntButton.disabled = false;
  huntButton.textContent = 'Open Hunter';
});
window.mediaSteru.onQueueChanged(applyQueueSnapshot);
window.mediaSteru.onLibraryChanged((items) => {
  libraryItems = items;
  renderLibrary();
});
window.mediaSteru.onPlayerChanged((state) => {
  const needsLibraryRender =
    state.status !== playbackState.status ||
    state.localPath !== playbackState.localPath;
  playbackState = state;
  // mpv emits position updates throughout playback. Rebuilding every library
  // row for those updates makes the view flicker and can interrupt clicks.
  if (needsLibraryRender) {
    renderLibrary();
  }
});

void Promise.all([
  window.mediaSteru.listDownloads(),
  window.mediaSteru.listLibrary(),
  window.mediaSteru.toolStatus(),
  window.mediaSteru.playerState(),
]).then(([downloads, media, tools, playback]) => {
  mpvAvailable = Boolean(tools.mpv);
  libraryItems = media;
  playbackState = playback;
  applyQueueSnapshot(downloads);
  renderLibrary();
  if (!tools.ytDlp || !tools.ffmpeg) {
    setStatus('A required download component is missing. Restart MediaSteru to restore its tools.', 'error');
  }
});
