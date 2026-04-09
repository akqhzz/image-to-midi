import { appState } from './state.js';

let audioContext = null;
let masterGain = null;
let reverbNode = null;
let dryBus = null;
let wetBus = null;

const INSTRUMENT_PRESETS = {
  aurora: {
    attack: 0.18,
    release: 1.8,
    filter: 1800,
    q: 0.8,
    voices: [
      { type: 'triangle', detune: -4, gain: 0.6 },
      { type: 'sine', detune: 5, gain: 0.35 },
      { type: 'sine', ratio: 0.5, gain: 0.18 },
    ],
    wet: 0.45,
  },
  glass: {
    attack: 0.02,
    release: 1.3,
    filter: 3200,
    q: 1.8,
    voices: [
      { type: 'sine', detune: 0, gain: 0.55 },
      { type: 'triangle', ratio: 2, detune: 7, gain: 0.2 },
      { type: 'sine', ratio: 3, detune: -5, gain: 0.08 },
    ],
    wet: 0.35,
  },
  choir: {
    attack: 0.22,
    release: 2.2,
    filter: 1450,
    q: 1.1,
    voices: [
      { type: 'sawtooth', detune: -7, gain: 0.28 },
      { type: 'triangle', detune: 6, gain: 0.38 },
      { type: 'sine', ratio: 1, detune: 0, gain: 0.22 },
    ],
    wet: 0.52,
  },
  nocturne: {
    attack: 0.12,
    release: 1.9,
    filter: 1200,
    q: 0.9,
    voices: [
      { type: 'triangle', detune: 0, gain: 0.44 },
      { type: 'sine', ratio: 0.5, detune: 0, gain: 0.18 },
      { type: 'square', detune: 3, gain: 0.08 },
    ],
    wet: 0.4,
  },
};

function midiToFrequency(note) {
  return 440 * 2 ** ((note - 69) / 12);
}

function buildImpulse(ctx, duration = 2.4, decay = 2.6) {
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * duration);
  const impulse = ctx.createBuffer(2, length, sampleRate);

  for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      const t = i / length;
      data[i] = (Math.random() * 2 - 1) * (1 - t) ** decay;
    }
  }

  return impulse;
}

function ensureAudioGraph() {
  if (audioContext) return audioContext;

  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;

  audioContext = new Ctx();
  masterGain = audioContext.createGain();
  dryBus = audioContext.createGain();
  wetBus = audioContext.createGain();
  reverbNode = audioContext.createConvolver();

  masterGain.gain.value = 0.82;
  dryBus.gain.value = 0.95;
  wetBus.gain.value = 0.28;
  reverbNode.buffer = buildImpulse(audioContext);

  dryBus.connect(masterGain);
  wetBus.connect(reverbNode);
  reverbNode.connect(masterGain);
  masterGain.connect(audioContext.destination);

  return audioContext;
}

export async function ensureMusicReady() {
  const ctx = ensureAudioGraph();
  if (!ctx) return false;
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch {
      return false;
    }
  }
  return ctx.state === 'running';
}

function stopVoice(track, note, voice, release = 0.2) {
  if (!voice || !audioContext) return;
  const now = audioContext.currentTime;
  const stopAt = now + Math.max(0.04, release);

  try {
    voice.output.gain.cancelScheduledValues(now);
    voice.output.gain.setValueAtTime(voice.output.gain.value, now);
    voice.output.gain.linearRampToValueAtTime(0.0001, stopAt);
  } catch {}

  for (const osc of voice.oscillators) {
    try {
      osc.stop(stopAt + 0.03);
    } catch {}
  }

  setTimeout(() => {
    const voices = track.activeVoices.get(note);
    if (!voices) return;
    const nextVoices = voices.filter((item) => item !== voice);
    if (nextVoices.length) track.activeVoices.set(note, nextVoices);
    else track.activeVoices.delete(note);
    track.activeNotes.delete(note);
  }, Math.ceil((release + 0.08) * 1000));
}

export function trackMusicNoteOn(track, note, velocity, stepMs) {
  if (!ensureAudioGraph() || audioContext.state !== 'running') return;

  const preset = INSTRUMENT_PRESETS[track.instrument] || INSTRUMENT_PRESETS.aurora;
  const now = audioContext.currentTime;
  const output = audioContext.createGain();
  const filter = audioContext.createBiquadFilter();
  const dryGain = audioContext.createGain();
  const wetGain = audioContext.createGain();

  const amplitude = Math.min(0.36, Math.max(0.03, (velocity / 127) * 0.22 * (track.volume / 100)));
  const sustainLength = Math.max(stepMs / 1000 * 1.4, preset.release * 0.75);

  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(preset.filter, now);
  filter.Q.setValueAtTime(preset.q, now);

  dryGain.gain.value = 1 - preset.wet * 0.45;
  wetGain.gain.value = preset.wet;
  output.gain.setValueAtTime(0.0001, now);
  output.gain.linearRampToValueAtTime(amplitude, now + preset.attack);
  output.gain.setTargetAtTime(amplitude * 0.72, now + preset.attack, 0.25);

  output.connect(filter);
  filter.connect(dryGain);
  filter.connect(wetGain);
  dryGain.connect(dryBus);
  wetGain.connect(wetBus);

  const oscillators = preset.voices.map((voiceDef) => {
    const oscillator = audioContext.createOscillator();
    oscillator.type = voiceDef.type;
    oscillator.detune.setValueAtTime(voiceDef.detune || 0, now);
    oscillator.frequency.setValueAtTime(midiToFrequency(note) * (voiceDef.ratio || 1), now);

    const gain = audioContext.createGain();
    gain.gain.value = voiceDef.gain;
    oscillator.connect(gain);
    gain.connect(output);
    oscillator.start(now);
    return oscillator;
  });

  const voice = { output, oscillators };
  const current = track.activeVoices.get(note) || [];
  current.push(voice);
  track.activeVoices.set(note, current);
  track.activeNotes.add(note);

  window.setTimeout(() => stopVoice(track, note, voice, preset.release), Math.round(sustainLength * 1000));
}

export function trackMusicAllNotesOff(track) {
  const activeEntries = [...track.activeVoices.entries()];
  for (const [note, voices] of activeEntries) {
    for (const voice of voices) stopVoice(track, note, voice, 0.16);
  }
  track.activeVoices.clear();
  track.activeNotes.clear();
}
