import { CapturedMedia } from './types';

interface HunterCandidate {
  capture: CapturedMedia;
  sourceWebContentsId: number;
}

export interface HunterCandidateState {
  candidateCount: number;
  downloadReady: boolean;
}

export class HunterCandidateStore {
  private candidates: HunterCandidate[] = [];
  private activeMediaContentsId: number | null = null;
  private lastDetectedContentsId: number | null = null;
  private playbackObserved = false;

  add(capture: CapturedMedia, sourceWebContentsId: number): boolean {
    if (this.candidates.some((candidate) => candidate.sourceWebContentsId === sourceWebContentsId
      && candidate.capture.url === capture.url)) return false;
    this.candidates.push({ capture, sourceWebContentsId });
    if (this.candidates.length > 24) this.candidates.shift();
    this.lastDetectedContentsId = sourceWebContentsId;
    return true;
  }

  markPlaying(sourceWebContentsId: number): void {
    this.activeMediaContentsId = sourceWebContentsId;
    this.playbackObserved = true;
  }

  private selectedContentsId(): number | null {
    if (this.activeMediaContentsId !== null && this.candidates.some(
      (candidate) => candidate.sourceWebContentsId === this.activeMediaContentsId,
    )) return this.activeMediaContentsId;
    return this.lastDetectedContentsId;
  }

  state(huntingEnabled: boolean): HunterCandidateState {
    const selectedContentsId = this.selectedContentsId();
    const candidateCount = selectedContentsId === null
      ? 0
      : this.candidates.filter(
        (candidate) => candidate.sourceWebContentsId === selectedContentsId,
      ).length;
    return {
      candidateCount,
      downloadReady: huntingEnabled && this.playbackObserved && selectedContentsId !== null && candidateCount > 0,
    };
  }

  takeLatest(): CapturedMedia | null {
    if (!this.playbackObserved) return null;
    const selectedContentsId = this.selectedContentsId();
    if (selectedContentsId === null) return null;
    const latest = [...this.candidates].reverse().find(
      (candidate) => candidate.sourceWebContentsId === selectedContentsId,
    );
    if (!latest) return null;
    return latest.capture;
  }

  removeSource(sourceWebContentsId: number): void {
    this.candidates = this.candidates.filter(
      (candidate) => candidate.sourceWebContentsId !== sourceWebContentsId,
    );
    if (this.activeMediaContentsId === sourceWebContentsId) this.activeMediaContentsId = null;
    if (this.lastDetectedContentsId === sourceWebContentsId) {
      this.lastDetectedContentsId = this.candidates.at(-1)?.sourceWebContentsId ?? null;
    }
  }

  clearPlayback(): void {
    this.activeMediaContentsId = null;
    this.playbackObserved = false;
  }

  clear(): void {
    this.candidates = [];
    this.activeMediaContentsId = null;
    this.lastDetectedContentsId = null;
    this.playbackObserved = false;
  }
}
