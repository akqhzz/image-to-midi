import { NOTE_NAMES } from './constants.js';
import { refs } from './dom.js';
import { appState } from './state.js';

export function midiNoteName(note) {
  return NOTE_NAMES[note % 12] + (Math.floor(note / 12) - 1);
}

export function parseNoteName(input) {
  const match = input.trim().match(/^([A-Ga-g])([#b]?)(-?\d+)$/);
  if (!match) return null;
  const pc = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1].toUpperCase()];
  if (pc === undefined) return null;
  const accidental = match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0;
  const octave = Number.parseInt(match[3], 10);
  const midi = (octave + 1) * 12 + pc + accidental;
  return midi >= 0 && midi <= 127 ? midi : null;
}

export function snapToAllowed(note, allowedPitchClasses) {
  if (!allowedPitchClasses || allowedPitchClasses.size === 0) {
    return null;
  }

  for (let distance = 0; distance <= 12; distance += 1) {
    const up = note + distance;
    const down = note - distance;

    if (allowedPitchClasses.has(normalizePitchClass(up))) return clamp(up, 0, 127);
    if (distance > 0 && allowedPitchClasses.has(normalizePitchClass(down))) return clamp(down, 0, 127);
  }

  return clamp(note, 0, 127);
}

export function rgbToHsl(r, g, b) {
  const nr = r / 255;
  const ng = g / 255;
  const nb = b / 255;
  const max = Math.max(nr, ng, nb);
  const min = Math.min(nr, ng, nb);
  const lightness = (max + min) / 2;

  if (max === min) return { h: 0, s: 0, l: lightness };

  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue;

  if (max === nr) hue = (ng - nb) / delta + (ng < nb ? 6 : 0);
  else if (max === ng) hue = (nb - nr) / delta + 2;
  else hue = (nr - ng) / delta + 4;

  return { h: hue / 6, s: saturation, l: lightness };
}

export function showToast(message) {
  refs.toast.textContent = message;
  refs.toast.classList.add('show');
  clearTimeout(appState.toastTimer);
  appState.toastTimer = setTimeout(() => refs.toast.classList.remove('show'), 2000);
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizePitchClass(note) {
  return ((note % 12) + 12) % 12;
}
