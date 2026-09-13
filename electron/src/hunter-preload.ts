import { contextBridge, ipcRenderer } from 'electron';
import { HunterNavigationState } from './types';

contextBridge.exposeInMainWorld('hunterNavigation', {
  getState: (): Promise<HunterNavigationState> => ipcRenderer.invoke('hunter:state'),
  navigate: (url: string): Promise<void> => ipcRenderer.invoke('hunter:navigate', url),
  back: (): Promise<void> => ipcRenderer.invoke('hunter:back'),
  forward: (): Promise<void> => ipcRenderer.invoke('hunter:forward'),
  reload: (): Promise<void> => ipcRenderer.invoke('hunter:reload'),
  setHuntingMode: (enabled: boolean): Promise<HunterNavigationState> => ipcRenderer.invoke('hunter:set-mode', enabled),
  onStateChanged: (callback: (state: HunterNavigationState) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: HunterNavigationState): void => callback(state);
    ipcRenderer.on('hunter:state-changed', handler);
    return () => ipcRenderer.removeListener('hunter:state-changed', handler);
  },
});
