import { PROJECTS_KEY, STORAGE_KEY } from './constants.js';
import { appState, applySettings, createTrack, ensureTrackPresence, serializeSettings } from './state.js';

export function saveToStorage() {
  clearTimeout(appState.saveTimer);
  appState.saveTimer = setTimeout(() => {
    try {
      const data = appState.tracks.map((track) => ({ id: track.id, settings: serializeSettings(track) }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {}
  }, 500);
}

export function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      ensureTrackPresence();
      return;
    }

    const data = JSON.parse(raw);
    appState.tracks.length = 0;
    appState.trackIdSeq = 1;

    for (const { id, settings } of data) {
      const track = createTrack();
      track.id = id;
      if (id >= appState.trackIdSeq) appState.trackIdSeq = id + 1;
      applySettings(track, settings);
      appState.tracks.push(track);
    }

    ensureTrackPresence();
    appState.activeTrackId = appState.tracks[0].id;
  } catch {
    appState.tracks.length = 0;
    appState.trackIdSeq = 1;
    ensureTrackPresence();
  }
}

export function exportSession() {
  const data = {
    version: 1,
    tracks: appState.tracks.map((track) => ({ id: track.id, settings: serializeSettings(track) })),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = 'image-midi-session.json';
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

export function importSessionFile(file, onLoaded, onError) {
  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const raw = event.target?.result;
      const data = JSON.parse(raw);

      if (data.version !== 1 || !Array.isArray(data.tracks)) {
        throw new Error('Unsupported import format');
      }

      appState.tracks.length = 0;
      appState.trackIdSeq = 1;
      for (const { id, settings } of data.tracks) {
        const track = createTrack();
        track.id = id;
        if (id >= appState.trackIdSeq) appState.trackIdSeq = id + 1;
        applySettings(track, settings);
        appState.tracks.push(track);
      }

      ensureTrackPresence();
      appState.activeTrackId = appState.tracks[0].id;
      onLoaded?.();
    } catch (error) {
      onError?.(error);
    }
  };
  reader.onerror = () => onError?.(reader.error);
  reader.readAsText(file);
}

export function getProjects() {
  try {
    return JSON.parse(localStorage.getItem(PROJECTS_KEY)) || [];
  } catch {
    return [];
  }
}

export function setProjects(projects) {
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
  } catch {}
}
