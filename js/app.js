import { refs } from './dom.js';
import { exportSession, getProjects, importSessionFile, loadFromStorage, saveToStorage, setProjects } from './persistence.js';
import { initMidi, refreshOutputs, updateSelectedOutput, trackAllNotesOff } from './midi.js';
import { computeSequence } from './sequence.js';
import { appState, applySettings, createTrack, ensureTrackPresence, getActiveTrack, serializeSettings, trackDisplayName } from './state.js';
import { drawStats, refreshKnobs, renderProjectsList, renderSidebar, renderTrackStrip, syncPreviewDisplay, updateFilterCount, updatePlayBtn } from './ui.js';
import { midiNoteName, parseNoteName, showToast } from './utils.js';
import { startPlayback, stopPlayback } from './playback.js';
import { MAX_HIST } from './constants.js';

const sidebarActions = {
  updateDualRange,
  onTogglePitchClass(track, pitchClass) {
    pushHistory();
    if (track.allowedPitchClasses.has(pitchClass)) track.allowedPitchClasses.delete(pitchClass);
    else track.allowedPitchClasses.add(pitchClass);
    renderSidebar(sidebarActions);
    computeSequence(track);
    drawStats();
    saveToStorage();
  },
};

const stripActions = {
  onAddTrack: addNewTrack,
  onSelectTrack: setActiveTrack,
  onConfirmRemoveTrack: confirmRemoveTrack,
  onRenameTrack(track, name) {
    track.name = name;
    renderSidebar(sidebarActions);
    saveToStorage();
  },
  onToggleMute(track) {
    track.muted = !track.muted;
    renderTrackStrip(stripActions);
    saveToStorage();
  },
};

function captureSnap() {
  return {
    trackIdSeq: appState.trackIdSeq,
    activeTrackId: appState.activeTrackId,
    tracks: appState.tracks.map((track) => ({
      id: track.id,
      analysisCanvas: track.analysisCanvas,
      imgBounds: track.imgBounds ? { ...track.imgBounds } : null,
      settings: serializeSettings(track),
    })),
  };
}

function pushHistory() {
  if (appState.historyBlocked || appState.suppressHistory) return;
  appState.undoStack.push(captureSnap());
  if (appState.undoStack.length > MAX_HIST) appState.undoStack.shift();
  appState.redoStack.length = 0;
  updateUndoButtons();
  saveToStorage();
}

function applySnap(snapshot) {
  appState.historyBlocked = true;
  appState.tracks.length = 0;
  for (const item of snapshot.tracks) {
    const track = createTrack();
    track.id = item.id;
    track.analysisCanvas = item.analysisCanvas;
    track.imgBounds = item.imgBounds;
    applySettings(track, item.settings);
    computeSequence(track);
    appState.tracks.push(track);
  }
  appState.trackIdSeq = snapshot.trackIdSeq;
  appState.activeTrackId = snapshot.activeTrackId;
  ensureTrackPresence();
  if (!appState.tracks.find((track) => track.id === appState.activeTrackId)) {
    appState.activeTrackId = appState.tracks[0].id;
  }
  appState.historyBlocked = false;
  syncPreviewDisplay(getActiveTrack());
  renderSidebar(sidebarActions);
  renderTrackStrip(stripActions);
  drawStats();
  updatePlayBtn();
}

function undo() {
  if (!appState.undoStack.length) return;
  appState.redoStack.push(captureSnap());
  applySnap(appState.undoStack.pop());
  updateUndoButtons();
  showToast('UNDO');
}

function redo() {
  if (!appState.redoStack.length) return;
  appState.undoStack.push(captureSnap());
  applySnap(appState.redoStack.pop());
  updateUndoButtons();
  showToast('REDO');
}

function updateUndoButtons() {
  refs.undoBtn.disabled = appState.undoStack.length === 0;
  refs.redoBtn.disabled = appState.redoStack.length === 0;
}

function copySettings() {
  const track = getActiveTrack();
  if (!track) return;
  appState.settingsClipboard = serializeSettings(track);
  refs.pasteSettingsBtn.style.display = '';
  showToast('SETTINGS COPIED');
}

function pasteSettings() {
  const track = getActiveTrack();
  if (!track || !appState.settingsClipboard) return;
  pushHistory();
  applySettings(track, appState.settingsClipboard);
  computeSequence(track);
  renderSidebar(sidebarActions);
  renderTrackStrip(stripActions);
  drawStats();
  saveToStorage();
  showToast('SETTINGS PASTED');
}

function fitImageBounds(track) {
  if (!track?.analysisCanvas) return false;

  const zoneWidth = Math.max(refs.dropZone.clientWidth, refs.dropZone.offsetWidth, 0);
  const zoneHeight = Math.max(refs.dropZone.clientHeight, refs.dropZone.offsetHeight, 0);
  if (zoneWidth < 20 || zoneHeight < 20) return false;

  const scale = Math.min(zoneWidth / track.analysisCanvas.width, zoneHeight / track.analysisCanvas.height);
  const drawWidth = track.analysisCanvas.width * scale;
  const drawHeight = track.analysisCanvas.height * scale;
  track.imgBounds = {
    dx: (zoneWidth - drawWidth) / 2,
    dy: (zoneHeight - drawHeight) / 2,
    dw: drawWidth,
    dh: drawHeight,
  };
  return true;
}

function loadImage(file, track) {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    URL.revokeObjectURL(url);
    const analysisCanvas = document.createElement('canvas');
    analysisCanvas.width = image.width;
    analysisCanvas.height = image.height;
    analysisCanvas.getContext('2d').drawImage(image, 0, 0);

    track.analysisCanvas = analysisCanvas;

    const finalizeImageLoad = (attempt = 0) => {
      if (!fitImageBounds(track) && attempt < 12) {
        requestAnimationFrame(() => finalizeImageLoad(attempt + 1));
        return;
      }

      renderTrackStrip(stripActions);
      computeSequence(track);
      if (track.id === appState.activeTrackId) {
        syncPreviewDisplay(track);
        drawStats();
      }
      updatePlayBtn();
      saveToStorage();
    };

    finalizeImageLoad();
  };
  image.onerror = () => URL.revokeObjectURL(url);
  image.src = url;
}

function setActiveTrack(id) {
  appState.activeTrackId = id;
  const track = getActiveTrack();
  syncPreviewDisplay(track);
  renderSidebar(sidebarActions);
  renderTrackStrip(stripActions);
  drawStats();
  if (!appState.isPlaying && track) refs.stepLabel.textContent = `— / ${track.steps}`;
}

function addNewTrack() {
  const track = createTrack();
  appState.tracks.push(track);
  appState.activeTrackId = track.id;
  syncPreviewDisplay(track);
  renderSidebar(sidebarActions);
  renderTrackStrip(stripActions);
  refs.fileInput.click();
}

function removeTrack(id) {
  pushHistory();
  const index = appState.tracks.findIndex((track) => track.id === id);
  if (index < 0) return;
  clearTimeout(appState.tracks[index].timer);
  trackAllNotesOff(appState.tracks[index]);
  appState.tracks.splice(index, 1);
  ensureTrackPresence();
  if (appState.activeTrackId === id) {
    appState.activeTrackId = appState.tracks[Math.min(index, appState.tracks.length - 1)].id;
  }
  setActiveTrack(appState.activeTrackId);
}

function showConfirm(message, onConfirm) {
  refs.confirmMsg.textContent = message;
  appState.confirmCallback = onConfirm;
  refs.confirmOverlay.classList.add('open');
}

function confirmRemoveTrack(id) {
  const track = appState.tracks.find((item) => item.id === id);
  const name = track ? trackDisplayName(track) : 'this track';
  showConfirm(`DELETE ${name}?`, () => removeTrack(id));
}

function withTrack(mutator, options = { recompute: true, save: true }) {
  const track = getActiveTrack();
  if (!track) return;
  pushHistory();
  mutator(track);
  if (options.recompute) computeSequence(track);
  drawStats();
  if (options.save) saveToStorage();
}

function withTrackNoHistory(mutator) {
  const track = getActiveTrack();
  if (!track) return;
  mutator(track);
  drawStats();
}

function commitNoteInput(input, slider, isMin) {
  const midi = parseNoteName(input.value);
  if (midi === null) {
    input.classList.add('err');
    return;
  }

  input.classList.remove('err');
  input.value = midiNoteName(midi);
  if (isMin && midi > Number(refs.noteMaxSlider.value)) return;
  if (!isMin && midi < Number(refs.noteMinSlider.value)) return;
  slider.value = midi;
  withTrack((track) => {
    if (isMin) track.noteMin = midi;
    else track.noteMax = midi;
  });
  updateDualRange();
}

function closeMenu() {
  refs.trackMenuDropdown.classList.remove('open');
}

function updateDualRange() {
  const lo = Number(refs.noteMinSlider.value);
  const hi = Number(refs.noteMaxSlider.value);
  const loPct = (lo / 127) * 100;
  const hiPct = (hi / 127) * 100;
  refs.drThumbLo.style.left = `${loPct}%`;
  refs.drThumbHi.style.left = `${hiPct}%`;
  refs.dualRangeFill.style.left = `${loPct}%`;
  refs.dualRangeFill.style.width = `${hiPct - loPct}%`;
}

function initDualRange() {
  const makeDraggable = (thumb, isLow) => {
    thumb.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      pushHistory();
      appState.suppressHistory = true;
      const rect = refs.dualRangeBar.getBoundingClientRect();

      const onMove = (moveEvent) => {
        const pct = Math.max(0, Math.min(1, (moveEvent.clientX - rect.left) / rect.width));
        let midi = Math.round(pct * 127);
        const track = getActiveTrack();
        if (!track) return;

        if (isLow) {
          midi = Math.min(midi, track.noteMax - 1);
          track.noteMin = midi;
          refs.noteMinSlider.value = midi;
          refs.noteMinTxt.value = midiNoteName(midi);
        } else {
          midi = Math.max(midi, track.noteMin + 1);
          track.noteMax = midi;
          refs.noteMaxSlider.value = midi;
          refs.noteMaxTxt.value = midiNoteName(midi);
        }

        computeSequence(track);
        drawStats();
        saveToStorage();
        updateDualRange();
      };

      const onUp = () => {
        appState.suppressHistory = false;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  };

  makeDraggable(refs.drThumbLo, true);
  makeDraggable(refs.drThumbHi, false);
  updateDualRange();
}

function initKnobs() {
  for (const knob of document.querySelectorAll('.knob[data-input]')) {
    const input = document.getElementById(knob.dataset.input);
    if (!input) continue;

    const min = Number.parseFloat(knob.dataset.min);
    const max = Number.parseFloat(knob.dataset.max);
    const isInt = Number.isInteger(min) && Number.isInteger(max);

    input.addEventListener('input', refreshKnobs);

    knob.addEventListener('mousedown', (event) => {
      event.preventDefault();
      const startY = event.clientY;
      const startValue = Number.parseFloat(input.value);
      pushHistory();
      appState.suppressHistory = true;

      const onMove = (moveEvent) => {
        const dy = startY - moveEvent.clientY;
        const sensitivity = (max - min) / 140;
        let value = startValue + dy * sensitivity;
        value = Math.max(min, Math.min(max, value));
        if (isInt) value = Math.round(value);
        input.value = String(value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };

      const onUp = () => {
        appState.suppressHistory = false;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    knob.addEventListener('wheel', (event) => {
      event.preventDefault();
      const delta = event.deltaY < 0 ? 1 : -1;
      let value = Math.max(min, Math.min(max, Number.parseFloat(input.value) + delta));
      if (isInt) value = Math.round(value);
      input.value = String(value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, { passive: false });
  }

  refreshKnobs();
}

function openProjectsPanel() {
  renderProjects();
  refs.projectsOverlay.classList.add('open');
  refs.projNameInput.value = '';
  setTimeout(() => refs.projNameInput.focus(), 60);
}

function closeProjectsPanel() {
  refs.projectsOverlay.classList.remove('open');
}

function renderProjects() {
  renderProjectsList(getProjects(), {
    onLoad: loadProject,
    onDelete(id) {
      const project = getProjects().find((p) => p.id === id);
      const name = project?.name || 'this project';
      showConfirm(`DELETE "${name.toUpperCase()}"?`, () => {
        setProjects(getProjects().filter((p) => p.id !== id));
        renderProjects();
      });
    },
  });
}

function saveProject() {
  const name = refs.projNameInput.value.trim();
  if (!name) {
    refs.projNameInput.focus();
    return;
  }

  const projects = getProjects();
  projects.unshift({
    id: Date.now(),
    name,
    timestamp: new Date().toISOString(),
    tracks: appState.tracks.map((track) => ({
      id: track.id,
      settings: serializeSettings(track),
      imageDataUrl: track.analysisCanvas ? (() => { try { return track.analysisCanvas.toDataURL('image/jpeg', 0.75); } catch { return null; } })() : null,
    })),
  });
  setProjects(projects);
  renderProjects();
  refs.projNameInput.value = '';
  showToast('PROJECT SAVED');
}

function loadProject(id) {
  const project = getProjects().find((item) => item.id === id);
  if (!project) return;

  pushHistory();
  appState.tracks.length = 0;
  appState.trackIdSeq = 1;
  for (const { id: trackId, settings, imageDataUrl } of project.tracks) {
    const track = createTrack();
    track.id = trackId;
    if (trackId >= appState.trackIdSeq) appState.trackIdSeq = trackId + 1;
    applySettings(track, settings);
    if (imageDataUrl) {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        canvas.getContext('2d').drawImage(img, 0, 0);
        track.analysisCanvas = canvas;
        const zoneWidth = refs.dropZone.clientWidth;
        const zoneHeight = refs.dropZone.clientHeight;
        const scale = Math.min(zoneWidth / img.width, zoneHeight / img.height);
        const drawWidth = img.width * scale;
        const drawHeight = img.height * scale;
        track.imgBounds = {
          dx: (zoneWidth - drawWidth) / 2,
          dy: (zoneHeight - drawHeight) / 2,
          dw: drawWidth,
          dh: drawHeight,
        };
        computeSequence(track);
        renderTrackStrip(stripActions);
        syncPreviewDisplay(getActiveTrack());
        drawStats();
        updatePlayBtn();
      };
      img.src = imageDataUrl;
    }
    appState.tracks.push(track);
  }

  ensureTrackPresence();
  appState.activeTrackId = appState.tracks[0].id;
  syncPreviewDisplay(getActiveTrack());
  renderSidebar(sidebarActions);
  renderTrackStrip(stripActions);
  drawStats();
  updatePlayBtn();
  saveToStorage();
  closeProjectsPanel();
  showToast(`LOADED: ${project.name.toUpperCase()}`);
}

function bindEvents() {
  const refreshMidiSelector = async () => {
    if (!appState.midiAccess) await initMidi(updatePlayBtn);
    else refreshOutputs(updatePlayBtn);
  };

  refs.dropZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    refs.dropZone.classList.add('drag-over');
  });
  refs.dropZone.addEventListener('dragleave', () => refs.dropZone.classList.remove('drag-over'));
  refs.dropZone.addEventListener('drop', (event) => {
    event.preventDefault();
    refs.dropZone.classList.remove('drag-over');
    const file = event.dataTransfer.files[0];
    if (file?.type.startsWith('image/')) loadImage(file, getActiveTrack());
  });
  refs.fileInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) loadImage(file, getActiveTrack());
    refs.fileInput.value = '';
  });

  refs.midiOutput.addEventListener('pointerdown', refreshMidiSelector);
  refs.midiOutput.addEventListener('focus', refreshMidiSelector);
  refs.midiOutput.addEventListener('change', () => updateSelectedOutput(updatePlayBtn));

  refs.noteMinSlider.addEventListener('input', () => {
    if (Number(refs.noteMinSlider.value) > Number(refs.noteMaxSlider.value)) {
      refs.noteMinSlider.value = refs.noteMaxSlider.value;
    }
    refs.noteMinTxt.value = midiNoteName(Number(refs.noteMinSlider.value));
    refs.noteMinTxt.classList.remove('err');
    withTrack((track) => { track.noteMin = Number(refs.noteMinSlider.value); });
    updateDualRange();
  });
  refs.noteMaxSlider.addEventListener('input', () => {
    if (Number(refs.noteMaxSlider.value) < Number(refs.noteMinSlider.value)) {
      refs.noteMaxSlider.value = refs.noteMinSlider.value;
    }
    refs.noteMaxTxt.value = midiNoteName(Number(refs.noteMaxSlider.value));
    refs.noteMaxTxt.classList.remove('err');
    withTrack((track) => { track.noteMax = Number(refs.noteMaxSlider.value); });
    updateDualRange();
  });

  refs.noteMinTxt.addEventListener('blur', () => commitNoteInput(refs.noteMinTxt, refs.noteMinSlider, true));
  refs.noteMinTxt.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') commitNoteInput(refs.noteMinTxt, refs.noteMinSlider, true);
  });
  refs.noteMaxTxt.addEventListener('blur', () => commitNoteInput(refs.noteMaxTxt, refs.noteMaxSlider, false));
  refs.noteMaxTxt.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') commitNoteInput(refs.noteMaxTxt, refs.noteMaxSlider, false);
  });

  refs.chordType.addEventListener('change', () => withTrack((track) => { track.chord = refs.chordType.value; }));
  refs.colorMode.addEventListener('change', () => withTrack((track) => { track.colorMode = refs.colorMode.value; }));
  refs.normalize.addEventListener('change', () => withTrack((track) => { track.normalize = refs.normalize.checked; }));
  refs.invertMode.addEventListener('change', () => withTrack((track) => { track.invert = refs.invertMode.checked; }));

  refs.threshold.addEventListener('input', () => {
    refs.threshVal.textContent = `${refs.threshold.value}%`;
    withTrack((track) => { track.threshold = Number(refs.threshold.value); });
  });
  refs.velocityScale.addEventListener('input', () => {
    refs.velocVal.textContent = `${refs.velocityScale.value}%`;
    withTrackNoHistory((track) => { track.velocityScale = Number(refs.velocityScale.value); });
    saveToStorage();
  });
  refs.maxPoly.addEventListener('input', () => {
    refs.polyVal.textContent = refs.maxPoly.value;
    withTrack((track) => { track.maxPoly = Number(refs.maxPoly.value); });
  });
  refs.density.addEventListener('input', () => {
    refs.densityVal.textContent = `${refs.density.value}%`;
    withTrack((track) => { track.density = Number(refs.density.value); });
  });

  refs.midiChannel.addEventListener('change', () => {
    const track = getActiveTrack();
    if (!track) return;
    pushHistory();
    track.channel = Number(refs.midiChannel.value);
    renderTrackStrip(stripActions);
    saveToStorage();
  });

  refs.bpm.addEventListener('change', () => {
    const track = getActiveTrack();
    if (!track) return;
    pushHistory();
    track.bpm = Number(refs.bpm.value);
    saveToStorage();
  });
  refs.steps.addEventListener('change', () => withTrack((track) => { track.steps = Number(refs.steps.value); }));
  refs.noteDiv.addEventListener('change', () => {
    const track = getActiveTrack();
    if (!track) return;
    pushHistory();
    track.noteDiv = Number(refs.noteDiv.value);
    saveToStorage();
  });
  refs.loopMode.addEventListener('change', () => {
    const track = getActiveTrack();
    if (!track) return;
    track.loop = refs.loopMode.checked;
    saveToStorage();
  });

  refs.filterAllBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const track = getActiveTrack();
    if (!track) return;
    pushHistory();
    track.allowedPitchClasses = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    renderSidebar(sidebarActions);
    computeSequence(track);
    drawStats();
    saveToStorage();
  });
  refs.filterNoneBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const track = getActiveTrack();
    if (!track) return;
    pushHistory();
    track.allowedPitchClasses = new Set();
    renderSidebar(sidebarActions);
    computeSequence(track);
    drawStats();
    saveToStorage();
  });

  refs.copySettingsBtn.addEventListener('click', copySettings);
  refs.pasteSettingsBtn.addEventListener('click', pasteSettings);

  refs.removeTrackBtn.addEventListener('click', () => {
    closeMenu();
    confirmRemoveTrack(appState.activeTrackId);
  });

  refs.projectsBtn.addEventListener('click', openProjectsPanel);
  refs.projCloseBtn.addEventListener('click', closeProjectsPanel);
  refs.projSaveBtn.addEventListener('click', saveProject);
  refs.projNameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') saveProject();
  });
  refs.projectsOverlay.addEventListener('click', (event) => {
    if (event.target === refs.projectsOverlay) closeProjectsPanel();
  });

  refs.exportBtn.addEventListener('click', () => {
    exportSession();
    showToast('EXPORTED');
  });
  refs.importBtn.addEventListener('click', () => refs.fileImport.click());
  refs.fileImport.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;
    pushHistory();
    importSessionFile(
      file,
      () => {
        syncPreviewDisplay(getActiveTrack());
        renderSidebar(sidebarActions);
        renderTrackStrip(stripActions);
        drawStats();
        updatePlayBtn();
        saveToStorage();
        showToast('IMPORTED — re-drop images');
      },
      () => {
        showToast('IMPORT FAILED');
      },
    );
    refs.fileImport.value = '';
  });

  refs.undoBtn.addEventListener('click', undo);
  refs.redoBtn.addEventListener('click', redo);

  refs.playBtn.addEventListener('click', () => (appState.isPlaying ? stopPlayback() : startPlayback()));
  refs.transportPlayBtn.addEventListener('click', () => (appState.isPlaying ? stopPlayback() : startPlayback()));
  refs.transportRew.addEventListener('click', () => {
    if (appState.isPlaying) stopPlayback();
  });

  document.addEventListener('keydown', (event) => {
    const mac = event.metaKey || event.ctrlKey;
    if (event.code === 'Space' && event.target.tagName !== 'INPUT' && event.target.tagName !== 'SELECT') {
      event.preventDefault();
      appState.isPlaying ? stopPlayback() : startPlayback();
      return;
    }
    if (mac && !event.shiftKey && event.key === 'z') {
      event.preventDefault();
      undo();
      return;
    }
    if (mac && ((event.shiftKey && event.key === 'z') || event.key === 'y')) {
      event.preventDefault();
      redo();
    }
  });

  window.addEventListener('resize', () => {
    const track = getActiveTrack();
    if (track?.analysisCanvas) fitImageBounds(track);
    syncPreviewDisplay(track);
    drawStats();
    updateDualRange();
  });

  refs.confirmCancel.addEventListener('click', () => refs.confirmOverlay.classList.remove('open'));
  refs.confirmOk.addEventListener('click', () => {
    refs.confirmOverlay.classList.remove('open');
    if (appState.confirmCallback) {
      const callback = appState.confirmCallback;
      appState.confirmCallback = null;
      callback();
    }
  });
  refs.confirmOverlay.addEventListener('click', (event) => {
    if (event.target === refs.confirmOverlay) refs.confirmOverlay.classList.remove('open');
  });

  refs.trackMenuBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    refs.trackMenuDropdown.classList.toggle('open');
  });
  refs.trackMenuDropdown.addEventListener('click', (event) => event.stopPropagation());
  refs.renameTrackBtn.addEventListener('click', () => {
    closeMenu();
    const chip = refs.trackStrip.querySelector('.track-chip.selected .chip-name-lbl');
    if (chip) chip.dispatchEvent(new MouseEvent('dblclick'));
  });
  document.addEventListener('click', closeMenu);
}

function init() {
  loadFromStorage();
  ensureTrackPresence();
  renderSidebar(sidebarActions);
  renderTrackStrip(stripActions);
  syncPreviewDisplay(getActiveTrack());
  drawStats();
  updateUndoButtons();
  initDualRange();
  initKnobs();
  bindEvents();
  initMidi(updatePlayBtn);
  updatePlayBtn();
  const activeTrack = getActiveTrack();
  if (activeTrack) refs.stepLabel.textContent = `— / ${activeTrack.steps}`;
}

init();
