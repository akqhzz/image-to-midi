export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const CHORD_INTERVALS = {
  none: [0],
  power: [0, 7],
  major: [0, 4, 7],
  minor: [0, 3, 7],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  dom7: [0, 4, 7, 10],
};

export const WHITE_KEYS = [[0, 'C'], [2, 'D'], [4, 'E'], [5, 'F'], [7, 'G'], [9, 'A'], [11, 'B']];
export const BLACK_KEYS = [[1, 9.8], [3, 24.1], [6, 52.6], [8, 66.9], [10, 81.2]];

export const MUSIC_INSTRUMENTS = [
  ['aurora', 'AURORA PAD'],
  ['glass', 'GLASS HARP'],
  ['choir', 'MIST CHOIR'],
  ['nocturne', 'NOCTURNE'],
];

export const STORAGE_KEY = 'image-midi-session';
export const PROJECTS_KEY = 'image-midi-projects';
export const MAX_HIST = 60;
