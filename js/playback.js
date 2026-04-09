import { refs } from './dom.js';
import { trackAllNotesOff, trackNoteOn } from './midi.js';
import { trackMusicAllNotesOff, trackMusicNoteOn } from './music.js';
import { computeAllSequences } from './sequence.js';
import { appState, getActiveTrack } from './state.js';
import { drawStats, syncTransport } from './ui.js';

const playbackHooks = {
  activateTrack: null,
};

export function setPlaybackHooks(hooks) {
  playbackHooks.activateTrack = hooks?.activateTrack || null;
}

export function startPlayback() {
  if (appState.outputMode === 'midi' && !appState.selectedOutput) return;
  computeAllSequences();
  appState.isPlaying = true;
  refs.playBtn.textContent = 'STOP';
  stopTrackTimers();
  const startRatio = Math.max(0, Math.min(1, appState.playbackStartRatio || 0));

  if (appState.playbackScope === 'current') {
    const activeTrack = getActiveTrack();
    if (activeTrack?.sequence.length > 0) {
      const startStep = ratioToStep(activeTrack, startRatio);
      playTrackStep(activeTrack, startStep);
    }
  } else {
    for (const track of appState.tracks) {
      if (track.sequence.length > 0) {
        const startStep = ratioToStep(track, startRatio);
        playTrackStep(track, startStep);
      }
    }
  }
  syncTransport();
}

export function stopPlayback() {
  const progressPct = Number.parseFloat(refs.progressFill.style.width) || 0;
  if (progressPct > 0) {
    appState.playbackStartRatio = Math.max(0, Math.min(1, progressPct / 100));
  }
  appState.isPlaying = false;
  stopTrackTimers();

  refs.playBtn.textContent = 'PLAY';
  refs.playhead.style.display = 'none';
  refs.progressFill.style.width = '0%';
  const activeTrack = getActiveTrack();
  if (activeTrack) refs.stepLabel.textContent = `— / ${activeTrack.steps}`;
  syncTransport();
}

function stopTrackTimers() {
  for (const track of appState.tracks) {
    clearTimeout(track.timer);
    track.timer = null;
    silenceTrack(track);
  }
}

function playTrackStep(track, step) {
  if (!appState.isPlaying) return;

  const steps = track.sequence.length || track.steps;
  const ms = (60000 / track.bpm) / track.noteDiv;
  silenceTrack(track);

  if (!track.muted && track.sequence[step]) {
    for (const { note, velocity } of track.sequence[step]) {
      const scaledVelocity = Math.round(velocity * (track.velocityScale / 100) * (track.volume / 100));
      if (scaledVelocity > 0) playNote(track, note, scaledVelocity, ms);
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
    if (track.loop) {
      track.timer = setTimeout(() => playTrackStep(track, 0), ms);
    } else if (appState.playbackScope === 'current') {
      track.timer = setTimeout(() => advanceToNextTrack(track), ms);
    } else {
      track.timer = setTimeout(() => finishTrackPlayback(track), ms);
    }
  } else {
    track.timer = setTimeout(() => playTrackStep(track, nextStep), ms);
  }
}

function advanceToNextTrack(track) {
  silenceTrack(track);
  track.timer = null;
  if (!appState.isPlaying) return;

  const currentIndex = appState.tracks.findIndex((item) => item.id === track.id);
  const nextTrack = appState.tracks
    .slice(currentIndex + 1)
    .find((item) => item.analysisCanvas && item.sequence.length > 0);

  if (!nextTrack) {
    stopPlayback();
    return;
  }

  playbackHooks.activateTrack?.(nextTrack.id);
  playTrackStep(nextTrack, 0);
}

function finishTrackPlayback(track) {
  silenceTrack(track);
  track.timer = null;
  if (!appState.isPlaying) return;

  const anyRunning = appState.tracks.some((item) => item.timer !== null);
  if (!anyRunning) stopPlayback();
}

export function seekPlayback(ratio) {
  appState.playbackStartRatio = Math.max(0, Math.min(1, ratio));
  const activeTrack = getActiveTrack();
  if (!activeTrack?.analysisCanvas) return;

  const step = ratioToStep(activeTrack, appState.playbackStartRatio);
  const steps = activeTrack.sequence.length || activeTrack.steps;
  const pct = steps > 0 ? (step / steps) * 100 : 0;
  refs.progressFill.style.width = `${pct}%`;
  refs.stepLabel.textContent = `${step + 1} / ${steps}`;
  if (activeTrack.imgBounds) {
    const { dx, dw } = activeTrack.imgBounds;
    refs.playhead.style.left = `${dx + pct / 100 * dw}px`;
    refs.playhead.style.display = 'block';
  }
  drawStats(step);

  if (appState.isPlaying) {
    stopPlayback();
    startPlayback();
  }
}

function ratioToStep(track, ratio) {
  const steps = track.sequence.length || track.steps || 1;
  return Math.max(0, Math.min(steps - 1, Math.floor(ratio * steps)));
}

function silenceTrack(track) {
  if (appState.outputMode === 'music') trackMusicAllNotesOff(track);
  else trackAllNotesOff(track);
}

function playNote(track, note, velocity, stepMs) {
  if (appState.outputMode === 'music') trackMusicNoteOn(track, note, velocity, stepMs);
  else trackNoteOn(track, note, velocity);
}
