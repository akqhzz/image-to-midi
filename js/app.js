import { refs } from './dom.js';
import { exportSession, getProjects, importSessionFile, loadFromStorage, saveToStorage, setProjects } from './persistence.js';
import { initMidi, refreshOutputs, updateSelectedOutput, trackAllNotesOff } from './midi.js';
import { computeSequence } from './sequence.js';
import { appState, applySettings, createTrack, ensureTrackPresence, getActiveTrack, serializeSettings, trackDisplayName } from './state.js';
import { drawStats, refreshKnobs, renderProjectsList, renderSidebar, renderTrackStrip, syncPreviewDisplay, syncProjectTitle, updateFilterCount, updatePlayBtn } from './ui.js';
import { clamp, midiNoteName, parseNoteName, showToast } from './utils.js';
import { seekPlayback, setPlaybackHooks, startPlayback, stopPlayback } from './playback.js';
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
  onDuplicateTrack: duplicateTrack,
  onReorderTrack: reorderTrack,
  onRenameTrack(track, name) {
    pushHistory();
    track.name = name;
    renderSidebar(sidebarActions);
    renderTrackStrip(stripActions);
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
    currentProjectId: appState.currentProjectId,
    currentProjectName: appState.currentProjectName,
    settingsClipboard: appState.settingsClipboard ? structuredClone(appState.settingsClipboard) : null,
    projects: getProjects(),
    tracks: appState.tracks.map((track) => ({
      id: track.id,
      analysisCanvas: track.analysisCanvas,
      imageDataUrl: track.imageDataUrl,
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
    track.imageDataUrl = item.imageDataUrl || null;
    track.imgBounds = item.imgBounds;
    applySettings(track, item.settings);
    computeSequence(track);
    appState.tracks.push(track);
  }
  appState.trackIdSeq = snapshot.trackIdSeq;
  appState.activeTrackId = snapshot.activeTrackId;
  appState.currentProjectId = snapshot.currentProjectId ?? null;
  appState.currentProjectName = snapshot.currentProjectName ?? '';
  appState.settingsClipboard = snapshot.settingsClipboard ? structuredClone(snapshot.settingsClipboard) : null;
  if (Array.isArray(snapshot.projects)) setProjects(snapshot.projects);
  ensureTrackPresence();
  if (!appState.tracks.find((track) => track.id === appState.activeTrackId)) {
    appState.activeTrackId = appState.tracks[0].id;
  }
  appState.historyBlocked = false;
  syncProjectTitle();
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
  if (!track) return;
  if (appState.activeTrackId !== track.id) setActiveTrack(track.id);
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    URL.revokeObjectURL(url);
    const analysisCanvas = document.createElement('canvas');
    analysisCanvas.width = image.width;
    analysisCanvas.height = image.height;
    analysisCanvas.getContext('2d').drawImage(image, 0, 0);

    track.analysisCanvas = analysisCanvas;
    try {
      track.imageDataUrl = analysisCanvas.toDataURL('image/jpeg', 0.75);
    } catch {
      track.imageDataUrl = null;
    }

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
      if (appState.isPlaying && appState.playbackScope === 'current' && track.id === appState.activeTrackId) {
        stopPlayback();
        startPlayback();
        return;
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

function duplicateTrack(sourceTrack) {
  pushHistory();
  const track = createTrack();
  applySettings(track, serializeSettings(sourceTrack));
  track.name = sourceTrack.name ? `${sourceTrack.name} Copy` : '';
  track.imageDataUrl = sourceTrack.imageDataUrl;
  track.imgBounds = sourceTrack.imgBounds ? { ...sourceTrack.imgBounds } : null;

  if (sourceTrack.analysisCanvas) {
    const canvas = document.createElement('canvas');
    canvas.width = sourceTrack.analysisCanvas.width;
    canvas.height = sourceTrack.analysisCanvas.height;
    canvas.getContext('2d').drawImage(sourceTrack.analysisCanvas, 0, 0);
    track.analysisCanvas = canvas;
  }

  computeSequence(track);
  appState.tracks.push(track);
  setActiveTrack(track.id);
  saveToStorage();
  showToast('TRACK DUPLICATED');
}

function reorderTrack(sourceId, targetId, placement = 'before') {
  if (sourceId === targetId) return;
  const sourceIndex = appState.tracks.findIndex((track) => track.id === sourceId);
  const targetIndex = appState.tracks.findIndex((track) => track.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return;

  pushHistory();
  const [moved] = appState.tracks.splice(sourceIndex, 1);
  const nextTargetIndex = appState.tracks.findIndex((track) => track.id === targetId);
  const insertIndex = placement === 'after' ? nextTargetIndex + 1 : nextTargetIndex;
  appState.tracks.splice(insertIndex, 0, moved);
  renderTrackStrip(stripActions);
  renderSidebar(sidebarActions);
  saveToStorage();
}

function startPlaybackFromBeginning() {
  appState.playbackStartRatio = 0;
  startPlayback();
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

    knob.addEventListener('dblclick', (event) => {
      event.preventDefault();
      if (input.value === input.defaultValue) return;
      pushHistory();
      appState.suppressHistory = true;
      input.value = input.defaultValue;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      appState.suppressHistory = false;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  refreshKnobs();
}

function openProjectsPanel() {
  refs.projSaveRow.style.display = 'none';
  renderProjects();
  refs.projectsOverlay.classList.add('open');
  refs.projNameInput.value = appState.currentProjectName || '';
}

function closeProjectsPanel() {
  appState.editingProjectId = null;
  refs.projectsOverlay.classList.remove('open');
}

function openProjectSavePanel() {
  refs.projSaveRow.style.display = 'flex';
  renderProjects();
  refs.projectsOverlay.classList.add('open');
  refs.projNameInput.value = appState.currentProjectName || '';
  setTimeout(() => refs.projNameInput.focus(), 60);
}

function renderProjects() {
  renderProjectsList(getProjects(), {
    onLoad: loadProject,
    onRename(id) {
      appState.editingProjectId = id;
      renderProjects();
    },
    onCommitRename: commitProjectRename,
    onCancelRename() {
      appState.editingProjectId = null;
      renderProjects();
    },
    onDuplicate: duplicateProject,
    onDelete(id) {
      const project = getProjects().find((p) => p.id === id);
      const name = project?.name || 'this project';
      showConfirm(`DELETE "${name.toUpperCase()}"?`, () => {
        pushHistory();
        setProjects(getProjects().filter((p) => p.id !== id));
        if (appState.currentProjectId === id) {
          appState.currentProjectId = null;
          appState.currentProjectName = '';
          syncProjectTitle();
          saveToStorage();
        }
        renderProjects();
      });
    },
  });
}

function buildProjectSnapshot(name, id = Date.now()) {
  return {
    id,
    name,
    timestamp: new Date().toISOString(),
    tracks: appState.tracks.map((track) => ({
      id: track.id,
      settings: serializeSettings(track),
      imageDataUrl: track.imageDataUrl || (track.analysisCanvas ? (() => { try { return track.analysisCanvas.toDataURL('image/jpeg', 0.75); } catch { return null; } })() : null),
    })),
  };
}

function persistProject(name, existingId = null) {
  const projectId = existingId || Date.now();
  const nextProject = buildProjectSnapshot(name, projectId);
  const projects = getProjects().filter((project) => project.id !== projectId);
  projects.unshift(nextProject);
  setProjects(projects);
  appState.currentProjectId = projectId;
  appState.currentProjectName = name;
  saveToStorage();
  return nextProject;
}

function saveProject() {
  const name = refs.projNameInput.value.trim() || appState.currentProjectName;
  if (!name) {
    refs.projNameInput.focus();
    return;
  }

  persistProject(name, appState.currentProjectId);
  syncProjectTitle();
  renderProjects();
  refs.projNameInput.value = name;
  showToast('PROJECT SAVED');
}

function quickSaveProject() {
  if (!appState.currentProjectName) {
    openProjectSavePanel();
    return;
  }

  persistProject(appState.currentProjectName, appState.currentProjectId);
  syncProjectTitle();
  showToast('PROGRESS SAVED');
}

function renameProject(id) {
  appState.editingProjectId = id;
  renderProjects();
}

function commitProjectRename(id, nextName) {
  const project = getProjects().find((item) => item.id === id);
  appState.editingProjectId = null;
  if (!project || !nextName || nextName === project.name) {
    renderProjects();
    return;
  }

  pushHistory();
  const projects = getProjects().map((item) => (item.id === id ? { ...item, name: nextName } : item));
  setProjects(projects);
  if (appState.currentProjectId === id) {
    appState.currentProjectName = nextName;
    syncProjectTitle();
    saveToStorage();
  }
  renderProjects();
  showToast('PROJECT RENAMED');
}

function duplicateProject(id) {
  const project = getProjects().find((item) => item.id === id);
  if (!project) return;

  pushHistory();
  const duplicate = {
    ...project,
    id: Date.now(),
    name: `${project.name} Copy`,
    timestamp: new Date().toISOString(),
  };
  const projects = getProjects();
  projects.unshift(duplicate);
  setProjects(projects);
  renderProjects();
  showToast('PROJECT DUPLICATED');
}

function deleteCurrentProject() {
  pushHistory();

  if (appState.currentProjectId) {
    setProjects(getProjects().filter((project) => project.id !== appState.currentProjectId));
  }

  createNewProject({ skipHistory: true, toastMessage: 'PROJECT DELETED' });
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
      track.imageDataUrl = imageDataUrl;
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
  appState.currentProjectId = project.id;
  appState.currentProjectName = project.name;
  syncProjectTitle();
  syncPreviewDisplay(getActiveTrack());
  renderSidebar(sidebarActions);
  renderTrackStrip(stripActions);
  drawStats();
  updatePlayBtn();
  saveToStorage();
  closeProjectsPanel();
  showToast(`LOADED: ${project.name.toUpperCase()}`);
}

function createNewProject(options = {}) {
  if (!options.skipHistory) pushHistory();
  if (appState.isPlaying) stopPlayback();
  closeMenu();
  closeProjectsPanel();

  for (const track of appState.tracks) {
    clearTimeout(track.timer);
    trackAllNotesOff(track);
  }

  appState.tracks.length = 0;
  appState.trackIdSeq = 1;
  appState.activeTrackId = 1;
  appState.undoStack.length = 0;
  appState.redoStack.length = 0;
  appState.settingsClipboard = null;
  appState.currentProjectId = null;
  appState.currentProjectName = '';
  appState.confirmCallback = null;

  ensureTrackPresence();
  const track = getActiveTrack();
  syncPreviewDisplay(track);
  renderSidebar(sidebarActions);
  renderTrackStrip(stripActions);
  drawStats();
  updateUndoButtons();
  updatePlayBtn();
  if (track) refs.stepLabel.textContent = `— / ${track.steps}`;
  syncProjectTitle();
  saveToStorage();
  showToast(options.toastMessage || 'NEW PROJECT');
}

function beginProjectTitleRename() {
  refs.projectTitleLabel.style.display = 'none';
  refs.projectTitleInput.classList.add('visible');
  refs.projectTitleInput.value = appState.currentProjectName || '';
  refs.projectTitleInput.focus();
  refs.projectTitleInput.select();
}

function commitProjectTitleRename() {
  const nextName = refs.projectTitleInput.value.trim();
  refs.projectTitleInput.classList.remove('visible');
  refs.projectTitleLabel.style.display = '';

  if (!nextName) {
    syncProjectTitle();
    return;
  }

  pushHistory();
  appState.currentProjectName = nextName;
  if (appState.currentProjectId) {
    persistProject(nextName, appState.currentProjectId);
    renderProjects();
  } else {
    saveToStorage();
  }
  syncProjectTitle();
  showToast('PROJECT RENAMED');
}

function sanitizeNumberInput(input, fallback) {
  const min = input.min === '' ? Number.NEGATIVE_INFINITY : Number(input.min);
  const max = input.max === '' ? Number.POSITIVE_INFINITY : Number(input.max);
  const rawValue = Number(input.value);
  const nextValue = Number.isFinite(rawValue) ? clamp(Math.round(rawValue), min, max) : fallback;
  input.value = String(nextValue);
  return nextValue;
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
  refs.dropZone.addEventListener('click', () => {
    refs.fileInput.value = '';
    if (typeof refs.fileInput.showPicker === 'function') refs.fileInput.showPicker();
    else refs.fileInput.click();
  });
  refs.fileInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) loadImage(file, getActiveTrack());
    refs.fileInput.value = '';
  });
  refs.progressTrack.addEventListener('click', (event) => {
    const rect = refs.progressTrack.getBoundingClientRect();
    if (rect.width <= 0) return;
    seekPlayback((event.clientX - rect.left) / rect.width);
  });

  refs.playModeAllBtn.addEventListener('click', () => {
    appState.playbackScope = 'all';
    updatePlayBtn();
  });
  refs.playModeCurrentBtn.addEventListener('click', () => {
    appState.playbackScope = 'current';
    updatePlayBtn();
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
    track.channel = sanitizeNumberInput(refs.midiChannel, track.channel);
    renderTrackStrip(stripActions);
    saveToStorage();
  });

  refs.bpm.addEventListener('change', () => {
    const track = getActiveTrack();
    if (!track) return;
    pushHistory();
    track.bpm = sanitizeNumberInput(refs.bpm, track.bpm);
    saveToStorage();
  });
  refs.steps.addEventListener('change', () => {
    const activeTrack = getActiveTrack();
    if (!activeTrack) return;
    withTrack((track) => {
      track.steps = sanitizeNumberInput(refs.steps, track.steps);
    });
    if (!appState.isPlaying) refs.stepLabel.textContent = `— / ${getActiveTrack().steps}`;
  });
  refs.noteDiv.addEventListener('change', () => {
    const track = getActiveTrack();
    if (!track) return;
    pushHistory();
    track.noteDiv = Number(refs.noteDiv.value) || track.noteDiv;
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

  refs.newProjectBtn.addEventListener('click', () => createNewProject());
  refs.quickSaveBtn.addEventListener('click', quickSaveProject);
  refs.deleteProjectBtn.addEventListener('click', () => {
    const label = appState.currentProjectName || 'this project';
    showConfirm(`DELETE ${label.toUpperCase()}?`, deleteCurrentProject);
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
  refs.projectTitleLabel.addEventListener('dblclick', beginProjectTitleRename);
  refs.projectTitleInput.addEventListener('blur', commitProjectTitleRename);
  refs.projectTitleInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') commitProjectTitleRename();
    if (event.key === 'Escape') {
      refs.projectTitleInput.classList.remove('visible');
      refs.projectTitleLabel.style.display = '';
      syncProjectTitle();
    }
  });

  refs.playBtn.addEventListener('click', () => (appState.isPlaying ? stopPlayback() : startPlaybackFromBeginning()));
  refs.transportPlayBtn.addEventListener('click', () => (appState.isPlaying ? stopPlayback() : startPlaybackFromBeginning()));
  refs.transportRew.addEventListener('click', () => {
    if (appState.isPlaying) stopPlayback();
  });

  document.addEventListener('keydown', (event) => {
    const mac = event.metaKey || event.ctrlKey;
    if (event.code === 'Space' && event.target.tagName !== 'INPUT' && event.target.tagName !== 'SELECT') {
      event.preventDefault();
      appState.isPlaying ? stopPlayback() : startPlaybackFromBeginning();
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

  refs.confirmCancel.addEventListener('click', () => {
    appState.confirmCallback = null;
    refs.confirmOverlay.classList.remove('open');
  });
  refs.confirmOk.addEventListener('click', () => {
    refs.confirmOverlay.classList.remove('open');
    if (appState.confirmCallback) {
      const callback = appState.confirmCallback;
      appState.confirmCallback = null;
      callback();
    }
  });
  refs.confirmOverlay.addEventListener('click', (event) => {
    if (event.target === refs.confirmOverlay) {
      appState.confirmCallback = null;
      refs.confirmOverlay.classList.remove('open');
    }
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
  setPlaybackHooks({ activateTrack: setActiveTrack });
  loadFromStorage((track) => {
    fitImageBounds(track);
    computeSequence(track);
    renderTrackStrip(stripActions);
    if (track.id === appState.activeTrackId) {
      syncPreviewDisplay(track);
      drawStats();
    }
    updatePlayBtn();
  });
  ensureTrackPresence();
  renderSidebar(sidebarActions);
  renderTrackStrip(stripActions);
  syncProjectTitle();
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
