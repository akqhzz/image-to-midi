import { CHORD_INTERVALS } from './constants.js';
import { rgbToHsl, snapToAllowed } from './utils.js';
import { appState } from './state.js';

export function computeSequence(track) {
  if (!track.analysisCanvas) {
    track.sequence = [];
    return;
  }

  const width = track.analysisCanvas.width;
  const height = track.analysisCanvas.height;
  const ctx = track.analysisCanvas.getContext('2d');
  const noteRange = Math.max(1, track.noteMax - track.noteMin + 1);
  const threshold = track.threshold / 100;
  let rng = track.id * 1234567 + 1;
  const rand = () => {
    rng = (rng * 1664525 + 1013904223) & 0xFFFFFFFF;
    return (rng >>> 0) / 0x100000000;
  };

  track.sequence = [];

  for (let step = 0; step < track.steps; step += 1) {
    if (track.density < 100 && rand() > track.density / 100) {
      track.sequence.push([]);
      continue;
    }

    const column = Math.round((step / track.steps) * (width - 1));
    const pixels = ctx.getImageData(column, 0, 1, height).data;
    const buckets = new Float32Array(noteRange);

    for (let y = 0; y < height; y += 1) {
      const i = y * 4;
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const noteIndex = Math.floor((1 - (y + 0.5) / height) * noteRange);
      const clampedIndex = Math.max(0, Math.min(noteRange - 1, noteIndex));

      if (track.colorMode === 'luma') {
        let luma = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
        if (track.invert) luma = 1 - luma;
        if (luma > buckets[clampedIndex]) buckets[clampedIndex] = luma;
      } else if (track.colorMode === 'rgb') {
        const band = Math.floor((clampedIndex / noteRange) * 3);
        const weight = [r, g, b][band] / 255;
        if (weight > buckets[clampedIndex]) buckets[clampedIndex] = weight;
      } else {
        const { h, s, l } = rgbToHsl(r, g, b);
        const hueIndex = Math.max(0, Math.min(noteRange - 1, Math.floor(h * noteRange)));
        const gate = s * (1 - Math.abs(2 * l - 1));
        if (gate > buckets[hueIndex]) buckets[hueIndex] = gate;
      }
    }

    if (track.normalize) {
      const columnMax = Math.max(...buckets);
      if (columnMax < 0.01) {
        track.sequence.push([]);
        continue;
      }
      for (let i = 0; i < noteRange; i += 1) buckets[i] /= columnMax;
    }

    const candidates = [];
    for (let i = 0; i < noteRange; i += 1) {
      if (buckets[i] >= threshold) candidates.push({ i, value: buckets[i] });
    }
    candidates.sort((left, right) => right.value - left.value);

    const stepNotes = [];
    const seen = new Set();
    for (const { i, value } of candidates.slice(0, track.maxPoly)) {
      const rootNote = snapToAllowed(track.noteMin + i, track.allowedPitchClasses);
      if (rootNote === null) continue;
      const velocity = Math.round(Math.min(127, value * 127));

      for (const interval of CHORD_INTERVALS[track.chord]) {
        const note = snapToAllowed(rootNote + interval, track.allowedPitchClasses);
        if (note !== null && note >= 0 && note <= 127 && !seen.has(note)) {
          seen.add(note);
          stepNotes.push({ note, velocity });
        }
      }
    }

    track.sequence.push(stepNotes);
  }
}

export function computeAllSequences() {
  for (const track of appState.tracks) computeSequence(track);
}
