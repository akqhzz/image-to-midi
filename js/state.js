export const appState = {
  trackIdSeq: 1,
  activeTrackId: 1,
  tracks: [],
  undoStack: [],
  redoStack: [],
  historyBlocked: false,
  suppressHistory: false,
  settingsClipboard: null,
  currentProjectId: null,
  currentProjectName: '',
  editingProjectId: null,
  playbackScope: 'all',
  playbackStartRatio: 0,
  saveTimer: null,
  toastTimer: null,
  midiAccess: null,
  selectedOutput: null,
  isPlaying: false,
  vizAnimId: null,
  noteFlashes: [],
  vizScanPct: 0,
  confirmCallback: null,
};

export function createTrack() {
  const id = appState.trackIdSeq++;
  return {
    id,
    name: '',
    analysisCanvas: null,
    imageDataUrl: null,
    imgBounds: null,
    sequence: [],
    timer: null,
    activeNotes: new Set(),
    channel: Math.min(id, 16),
    noteMin: 36,
    noteMax: 84,
    chord: 'major',
    threshold: 20,
    velocityScale: 100,
    colorMode: 'rgb',
    normalize: true,
    maxPoly: 3,
    density: 100,
    invert: false,
    allowedPitchClasses: new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
    bpm: 120,
    steps: 64,
    noteDiv: 2,
    loop: true,
    volume: 100,
    muted: false,
  };
}

export function trackDisplayName(track) {
  if (track.name) return track.name;
  const index = appState.tracks.indexOf(track);
  return `TRACK ${index >= 0 ? index + 1 : track.id}`;
}

export function getActiveTrack() {
  return appState.tracks.find((track) => track.id === appState.activeTrackId);
}

export function serializeSettings(track) {
  return {
    name: track.name,
    channel: track.channel,
    noteMin: track.noteMin,
    noteMax: track.noteMax,
    chord: track.chord,
    threshold: track.threshold,
    velocityScale: track.velocityScale,
    colorMode: track.colorMode,
    normalize: track.normalize,
    maxPoly: track.maxPoly,
    density: track.density,
    invert: track.invert,
    allowedPitchClasses: [...track.allowedPitchClasses],
    bpm: track.bpm,
    steps: track.steps,
    noteDiv: track.noteDiv,
    loop: track.loop,
    volume: track.volume,
    muted: track.muted,
  };
}

export function applySettings(track, settings) {
  const { allowedPitchClasses, ...rest } = settings;
  Object.assign(track, rest);
  track.allowedPitchClasses = new Set(allowedPitchClasses || [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
}

export function ensureTrackPresence() {
  if (appState.tracks.length) return;
  const track = createTrack();
  appState.tracks.push(track);
  appState.activeTrackId = track.id;
}
