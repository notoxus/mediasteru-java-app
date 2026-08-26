// Keep this file as a browser script (no imports/exports). The preload bridge
// supplies runtime APIs; importing even types here makes CommonJS emit an
// `exports` marker, which is unavailable in a sandboxed renderer.
type DownloadFormat = 'mp4' | 'mkv' | 'mp3';
type DownloadQuality = '720' | '1080' | '1440' | '2160' | 'best';

interface DownloadRequest {
  id: string;
  url: string;
  savePath: string;
  format: DownloadFormat;
  quality: DownloadQuality;
  referer?: string;
  requestHeaders?: Record<string, string>;
}

interface DownloadEvent {
  id: string;
  type: 'started' | 'progress' | 'log' | 'complete' | 'error' | 'canceled';
  percent?: number;
  speed?: string;
  message?: string;
  savedPath?: string;
}

interface CapturedMedia {
  url: string;
  referer?: string;
  requestHeaders: Record<string, string>;
}

type TaskStatus = 'Waiting' | 'Preparing' | 'Downloading' | 'Converting' | 'Completed' | 'Failed' | 'Canceled';

interface QueueTask extends DownloadRequest {
  name: string;
  status: TaskStatus;
  percent: number;
  speed: string;
  error?: string;
}

const tasks = new Map<string, QueueTask>();
let outputFolder = '';
let hunting = false;

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
const emptyState = byId<HTMLDivElement>('empty-state');
const statusText = byId<HTMLSpanElement>('status-text');
const statusDot = byId<HTMLSpanElement>('status-dot');
const errorLogButton = byId<HTMLButtonElement>('error-log-button');
const huntButton = byId<HTMLButtonElement>('hunt-button');

function setStatus(message: string, kind: 'info' | 'success' | 'warning' | 'error' = 'info'): void {
  statusText.textContent = message;
  statusDot.className = `status-dot ${kind}`;
  errorLogButton.hidden = kind !== 'error';
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

function formatProgress(task: QueueTask): string {
  if (task.status === 'Completed') return '100%';
  if (task.status === 'Failed' || task.status === 'Canceled') return '—';
  const percent = `${task.percent.toFixed(1)}%`;
  return task.speed && task.speed !== 'N/A' ? `${percent} · ${task.speed}` : percent;
}

function renderQueue(): void {
  queueBody.replaceChildren();
  emptyState.hidden = tasks.size > 0;
  let index = 1;
  for (const task of tasks.values()) {
    const row = document.createElement('tr');
    const progressClass = task.status === 'Failed' ? ' failed' : '';
    row.innerHTML = `
      <td class="index-cell">${index}</td>
      <td class="media-cell">
        <span class="media-name"></span>
        <span class="media-url"></span>
      </td>
      <td><span class="format-chip">${task.format.toUpperCase()} · ${task.format === 'mp3' ? 'Audio' : task.quality === 'best' ? 'Best' : `${task.quality}p`}</span></td>
      <td><span class="task-status status-${task.status.toLowerCase()}">${task.status}</span></td>
      <td class="progress-cell">
        <div class="progress-track"><div class="progress-fill${progressClass}" style="width:${Math.max(0, Math.min(100, task.percent))}%"></div></div>
        <span>${formatProgress(task)}</span>
      </td>
      <td class="action-cell"><button class="icon-button" data-cancel="${task.id}" title="Cancel or remove">×</button></td>
    `;
    row.querySelector<HTMLElement>('.media-name')!.textContent = task.name;
    row.querySelector<HTMLElement>('.media-url')!.textContent = task.url;
    queueBody.append(row);
    index += 1;
  }
}

async function ensureOutputFolder(): Promise<string | null> {
  if (outputFolder) return outputFolder;
  const selected = await window.videoDownloader.chooseFolder();
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
  const id = crypto.randomUUID();
  const task: QueueTask = {
    id,
    url,
    savePath,
    format: formatSelect.value as DownloadFormat,
    quality: qualitySelect.value as DownloadQuality,
    referer: capture?.referer,
    requestHeaders: capture?.requestHeaders,
    name: labelForUrl(url),
    status: 'Waiting',
    percent: 0,
    speed: 'N/A',
  };
  tasks.set(id, task);
  renderQueue();
  setStatus('Download added to the queue.', 'info');
  try {
    await window.videoDownloader.startDownload(task);
  } catch (error) {
    task.status = 'Failed';
    task.error = error instanceof Error ? error.message : String(error);
    renderQueue();
    setStatus(task.error, 'error');
  }
}

function handleDownloadEvent(event: DownloadEvent): void {
  const task = tasks.get(event.id);
  if (!task) return;
  switch (event.type) {
    case 'started':
      task.status = 'Preparing';
      setStatus('Preparing the download…');
      break;
    case 'progress':
      task.status = 'Downloading';
      task.percent = event.percent ?? task.percent;
      task.speed = event.speed ?? task.speed;
      setStatus(`Downloading ${task.name} — ${task.percent.toFixed(1)}%`);
      break;
    case 'log':
      if (event.message?.toLowerCase().includes('convert')) task.status = 'Converting';
      break;
    case 'complete':
      task.status = 'Completed';
      task.percent = 100;
      setStatus('Download completed. The file is ready.', 'success');
      break;
    case 'error':
      task.status = 'Failed';
      task.error = event.message;
      setStatus(event.message || 'The download failed. Open details for more information.', 'error');
      break;
    case 'canceled':
      task.status = 'Canceled';
      setStatus('Download canceled.', 'warning');
      break;
  }
  renderQueue();
}

byId<HTMLButtonElement>('folder-button').addEventListener('click', async () => {
  const selected = await window.videoDownloader.chooseFolder();
  if (selected) {
    outputFolder = selected;
    folderInput.value = selected;
    setStatus('Output folder selected.', 'success');
  }
});

byId<HTMLButtonElement>('paste-button').addEventListener('click', async () => {
  const text = (await window.videoDownloader.readClipboard()).trim();
  const match = text.match(/https?:\/\/\S+/i);
  if (!match) {
    setStatus('The clipboard does not contain an HTTP link.', 'warning');
    return;
  }
  urlInput.value = match[0];
  setStatus('Link pasted from the clipboard.', 'success');
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

huntButton.addEventListener('click', async () => {
  if (hunting) {
    setStatus('The capture browser is already open.', 'warning');
    return;
  }
  const savePath = await ensureOutputFolder();
  if (!savePath) return;
  const target = urlInput.value.trim() || 'https://www.google.com';
  try {
    hunting = true;
    huntButton.disabled = true;
    huntButton.textContent = 'Hunter open';
    await window.videoDownloader.openHunter(target);
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

errorLogButton.addEventListener('click', async () => {
  const error = await window.videoDownloader.openLogs();
  setStatus(error ? `Could not open log folder: ${error}` : 'Log folder opened.', error ? 'error' : 'success');
});

queueBody.addEventListener('click', async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-cancel]');
  if (!button) return;
  const id = button.dataset.cancel!;
  const task = tasks.get(id);
  if (!task) return;
  if (['Preparing', 'Downloading', 'Converting'].includes(task.status)) {
    await window.videoDownloader.cancelDownload(id);
  } else {
    tasks.delete(id);
    renderQueue();
  }
});

window.videoDownloader.onCaptured((capture) => {
  setStatus('Media stream captured. Starting download…', 'success');
  void enqueue(capture.url, capture);
});
window.videoDownloader.onHunterClosed(() => {
  hunting = false;
  huntButton.disabled = false;
  huntButton.textContent = 'Open Hunter';
});
window.videoDownloader.onDownloadEvent(handleDownloadEvent);

void window.videoDownloader.toolStatus().then((tools) => {
  if (!tools.ytDlp || !tools.ffmpeg) {
    setStatus('A required download component is missing. Open the error log for details.', 'error');
  }
});

renderQueue();
