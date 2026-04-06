import { refs } from './dom.js';
import { appState } from './state.js';

function setBadge(text, className) {
  refs.midiBadge.textContent = text;
  refs.midiBadge.className = className;
}

export async function initMidi(onChanged) {
  if (!navigator.requestMIDIAccess) {
    setBadge('NO WEB MIDI', 'error');
    return;
  }

  try {
    appState.midiAccess = await navigator.requestMIDIAccess({ sysex: false });
    appState.midiAccess.onstatechange = () => refreshOutputs(onChanged);
    refreshOutputs(onChanged);
  } catch {
    setBadge('MIDI DENIED', 'error');
  }
}

export function refreshOutputs(onChanged) {
  if (!appState.midiAccess) return;
  const previous = refs.midiOutput.value;
  refs.midiOutput.innerHTML = '';

  const noneOpt = document.createElement('option');
  noneOpt.value = '';
  noneOpt.textContent = '— none —';
  refs.midiOutput.appendChild(noneOpt);

  let autoIac = null;
  for (const output of appState.midiAccess.outputs.values()) {
    const id = output.id;
    const option = document.createElement('option');
    option.value = id;
    const searchText = [output.manufacturer, output.name, output.id].filter(Boolean).join(' ').toLowerCase();
    let label = output.name || output.id || 'Unknown MIDI Output';
    if (searchText.includes('iac') && !label.toLowerCase().includes('iac')) {
      label = `IAC Driver - ${output.name || 'Bus'}`;
    }
    option.textContent = label;
    refs.midiOutput.appendChild(option);
    if (!autoIac && searchText.includes('iac')) autoIac = id;
  }

  if (!appState.midiAccess.outputs.size) {
    setBadge('NO OUTPUT', 'warn');
  } else {
    if (previous && appState.midiAccess.outputs.has(previous)) refs.midiOutput.value = previous;
    else if (autoIac) refs.midiOutput.value = autoIac;
    setBadge('MIDI OK', 'ok');
  }

  updateSelectedOutput(onChanged);
}

export function updateSelectedOutput(onChanged) {
  const id = refs.midiOutput.value;
  appState.selectedOutput = id ? appState.midiAccess?.outputs.get(id) ?? null : null;
  onChanged?.();
}

export function trackNoteOn(track, note, velocity) {
  if (!appState.selectedOutput) return;
  appState.selectedOutput.send([0x90 | ((track.channel - 1) & 0xF), note & 0x7F, velocity & 0x7F]);
  track.activeNotes.add(note);
}

export function trackNoteOff(track, note) {
  if (!appState.selectedOutput) return;
  appState.selectedOutput.send([0x80 | ((track.channel - 1) & 0xF), note & 0x7F, 0]);
  track.activeNotes.delete(note);
}

export function trackAllNotesOff(track) {
  for (const note of track.activeNotes) trackNoteOff(track, note);
  track.activeNotes.clear();
  if (appState.selectedOutput) {
    appState.selectedOutput.send([0xB0 | ((track.channel - 1) & 0xF), 123, 0]);
  }
}
