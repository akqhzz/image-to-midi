import { PROJECTS_KEY, STORAGE_KEY } from './constants.js';
import { appState, applySettings, createTrack, ensureTrackPresence, serializeSettings } from './state.js';

function encodeTrackImage(track) {
  if (track.imageDataUrl) return track.imageDataUrl;
  if (!track.analysisCanvas) return null;

  try {
    return track.analysisCanvas.toDataURL('image/jpeg', 0.75);
  } catch {
    return null;
  }
}

function serializeTrackRecord(track, includeImage = false) {
  return {
    id: track.id,
    settings: serializeSettings(track),
    imageDataUrl: includeImage ? encodeTrackImage(track) : null,
  };
}

function restoreTrackImage(track, imageDataUrl, onTrackImageLoaded) {
  if (!imageDataUrl) return;

  track.imageDataUrl = imageDataUrl;
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext('2d').drawImage(image, 0, 0);
    track.analysisCanvas = canvas;
    onTrackImageLoaded?.(track);
  };
  image.src = imageDataUrl;
}

export function saveToStorage() {
  clearTimeout(appState.saveTimer);
  appState.saveTimer = setTimeout(() => {
    try {
      const data = {
        version: 3,
        activeTrackId: appState.activeTrackId,
        trackIdSeq: appState.trackIdSeq,
        settingsClipboard: appState.settingsClipboard,
        currentProjectId: appState.currentProjectId,
        currentProjectName: appState.currentProjectName,
        outputMode: appState.outputMode,
        tracks: appState.tracks.map((track) => serializeTrackRecord(track, true)),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {}
  }, 500);
}

export function loadFromStorage(onTrackImageLoaded) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      appState.settingsClipboard = null;
      appState.currentProjectId = null;
      appState.currentProjectName = '';
      appState.outputMode = 'midi';
      ensureTrackPresence();
      return;
    }

    const data = JSON.parse(raw);
    const tracks = Array.isArray(data)
      ? data.map((track) => ({ ...track, imageDataUrl: null }))
      : Array.isArray(data?.tracks) ? data.tracks : null;

    if (!tracks) throw new Error('Invalid session data');

    appState.tracks.length = 0;
    appState.trackIdSeq = 1;
    appState.settingsClipboard = data?.settingsClipboard || null;
    appState.currentProjectId = data?.currentProjectId || null;
    appState.currentProjectName = data?.currentProjectName || '';
    appState.outputMode = data?.outputMode === 'music' ? 'music' : 'midi';

    for (const { id, settings, imageDataUrl } of tracks) {
      const track = createTrack();
      track.id = id;
      if (id >= appState.trackIdSeq) appState.trackIdSeq = id + 1;
      applySettings(track, settings);
      track.imageDataUrl = imageDataUrl || null;
      appState.tracks.push(track);
      restoreTrackImage(track, imageDataUrl, onTrackImageLoaded);
    }

    if (typeof data?.trackIdSeq === 'number' && data.trackIdSeq >= appState.trackIdSeq) {
      appState.trackIdSeq = data.trackIdSeq;
    }

    ensureTrackPresence();
    const savedActiveTrackId = Array.isArray(data) ? appState.tracks[0].id : data?.activeTrackId;
    appState.activeTrackId = appState.tracks.some((track) => track.id === savedActiveTrackId)
      ? savedActiveTrackId
      : appState.tracks[0].id;
  } catch {
    appState.tracks.length = 0;
    appState.trackIdSeq = 1;
    appState.settingsClipboard = null;
    appState.currentProjectId = null;
    appState.currentProjectName = '';
    appState.outputMode = 'midi';
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
