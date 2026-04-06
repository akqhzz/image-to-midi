import { refs } from './dom.js';
import { trackAllNotesOff, trackNoteOn } from './midi.js';
import { computeAllSequences } from './sequence.js';
import { appState, getActiveTrack } from './state.js';
import { drawStats, syncTransport } from './ui.js';

export function startPlayback() {
  if (!appState.selectedOutput) return;
  computeAllSequences();
  appState.isPlaying = true;
  refs.playBtn.textContent = 'STOP';
  for (const track of appState.tracks) {
    if (track.sequence.length > 0) playTrackStep(track, 0);
  }
  syncTransport();
}

export function stopPlayback() {
  appState.isPlaying = false;
  for (const track of appState.tracks) {
    clearTimeout(track.timer);
    track.timer = null;
    trackAllNotesOff(track);
  }

  refs.playBtn.textContent = 'PLAY';
  refs.playhead.style.display = 'none';
  refs.progressFill.style.width = '0%';
  const activeTrack = getActiveTrack();
  if (activeTrack) refs.stepLabel.textContent = `— / ${activeTrack.steps}`;
  syncTransport();
}

function playTrackStep(track, step) {
  if (!appState.isPlaying) return;

  const steps = track.sequence.length || track.steps;
  const ms = (60000 / track.bpm) / track.noteDiv;
  trackAllNotesOff(track);

  if (!track.muted && track.sequence[step]) {
    for (const { note, velocity } of track.sequence[step]) {
      const scaledVelocity = Math.round(velocity * (track.velocityScale / 100) * (track.volume / 100));
      if (scaledVelocity > 0) trackNoteOn(track, note, scaledVelocity);
    }
  }

  if (track.id === appState.activeTrackId) {
    const pct = steps > 0 ? (step / steps) * 100 : 0;
    refs.progressFill.style.width = `${pct}%`;
    refs.stepLabel.textContent = `${step + 1} / ${steps}`;
    if (track.imgBounds) {
      const { dx, dw } = track.imgBounds;
      refs.playhead.style.left = `${dx + (pct / 100) * dw}px`;
      refs.playhead.style.display = 'block';
    }
    drawStats(step);
  }

  const nextStep = step + 1;
  if (nextStep >= steps) {
    if (track.loop) track.timer = setTimeout(() => playTrackStep(track, 0), ms);
    else track.timer = setTimeout(() => trackAllNotesOff(track), ms);
  } else {
    track.timer = setTimeout(() => playTrackStep(track, nextStep), ms);
  }
}
