import { BLACK_KEYS, NOTE_NAMES, WHITE_KEYS } from './constants.js';
import { refs } from './dom.js';
import { appState, getActiveTrack, trackDisplayName } from './state.js';
import { midiNoteName, rgbToHsl } from './utils.js';

export function redrawDisplay(track) {
  const width = Math.max(refs.dropZone.clientWidth, refs.dropZone.offsetWidth, 1);
  const height = Math.max(refs.dropZone.clientHeight, refs.dropZone.offsetHeight, 1);
  refs.previewCanvas.width = width;
  refs.previewCanvas.height = height;

  const ctx = refs.previewCanvas.getContext('2d');
  ctx.fillStyle = '#080b07';
  ctx.fillRect(0, 0, width, height);

  if (track?.analysisCanvas && track.imgBounds) {
    const { dx, dy, dw, dh } = track.imgBounds;
    ctx.drawImage(track.analysisCanvas, dx, dy, dw, dh);
  }
}

export function syncPreviewDisplay(track) {
  if (track?.analysisCanvas) {
    redrawDisplay(track);
    refs.previewCanvas.style.display = 'block';
    refs.dropPlaceholder.style.display = 'none';
    refs.dropZone.classList.add('has-image');
    return;
  }

  refs.previewCanvas.style.display = 'none';
  refs.dropPlaceholder.style.display = '';
  refs.dropZone.classList.remove('has-image');
}

export function updatePlayBtn() {
  const hasPlayableTrack = appState.playbackScope === 'current'
    ? Boolean(getActiveTrack()?.analysisCanvas)
    : appState.tracks.some((track) => track.analysisCanvas);
  const outputReady = appState.outputMode === 'music' ? true : Boolean(appState.selectedOutput);
  const enabled = Boolean(outputReady && hasPlayableTrack);
  refs.playBtn.disabled = !enabled;
  refs.transportPlayBtn.disabled = !enabled;
  syncTransport();
}

export function syncTransport() {
  refs.transportPlayBtn.disabled = refs.playBtn.disabled;
  refs.playModeAllBtn.classList.toggle('active', appState.playbackScope === 'all');
  refs.playModeCurrentBtn.classList.toggle('active', appState.playbackScope === 'current');
  if (appState.isPlaying) {
    refs.transportPlayBtn.textContent = '⏹';
    refs.transportPlayBtn.classList.add('playing');
  } else {
    refs.transportPlayBtn.textContent = '▶';
    refs.transportPlayBtn.classList.remove('playing');
  }
}

export function drawStats(currentStep) {
  const track = getActiveTrack();
  const width = refs.statsCanvas.clientWidth;
  const height = refs.statsCanvas.clientHeight;
  if (width <= 0 || height <= 0) return;

  const dpr = devicePixelRatio || 1;
  refs.statsCanvas.width = width * dpr;
  refs.statsCanvas.height = height * dpr;
  const ctx = refs.statsCanvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = '#181816';
  ctx.fillRect(0, 0, width, height);

  if (!track || !track.sequence.length) {
    ctx.fillStyle = '#2a2a28';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('NO SEQUENCE', width / 2, height / 2 + 3);
    refs.statActive.textContent = '—';
    refs.statPoly.textContent = '—';
    refs.statRange.textContent = '—';
    refs.statTotal.textContent = '—';
    return;
  }

  const isLive = currentStep !== undefined;
  const steps = track.sequence.length;
  const noteRange = Math.max(1, track.noteMax - track.noteMin + 1);
  const stripHeight = isLive && track.analysisCanvas ? 7 : 0;
  const sparkHeight = Math.floor((height - stripHeight) * 0.42);
  const stripY = sparkHeight + 1;
  const histY = stripY + stripHeight + 1;
  const histHeight = height - histY - 1;
  const barWidth = Math.max(1, width / steps);

  ctx.fillStyle = '#222220';
  ctx.fillRect(0, sparkHeight, width, 1);

  let activeSteps = 0;
  let totalNotes = 0;
  let totalPoly = 0;
  let minNote = 127;
  let maxNote = 0;

  for (let step = 0; step < steps; step += 1) {
    const notes = track.sequence[step];
    if (!notes?.length) continue;

    activeSteps += 1;
    totalNotes += notes.length;
    totalPoly += notes.length;

    for (const { note } of notes) {
      if (note < minNote) minNote = note;
      if (note > maxNote) maxNote = note;
    }

    const intensity = Math.min(1, notes.length / Math.max(1, track.maxPoly));
    const barHeight = Math.max(2, intensity * (sparkHeight - 4));
    const x = step * barWidth;
    const luma = isLive && step === currentStep ? 220 : Math.round(38 + intensity * 72);
    ctx.fillStyle = `rgb(${luma},${luma},${luma})`;
    ctx.fillRect(x, sparkHeight - barHeight, Math.max(1, barWidth - 0.5), barHeight);
  }

  if (isLive) {
    const cursorX = currentStep * barWidth + barWidth * 0.5;
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(Math.max(0, cursorX - 0.5), 0, 1, sparkHeight);
  }

  if (isLive && track.analysisCanvas && stripHeight > 0) {
    const imgCtx = track.analysisCanvas.getContext('2d');
    const columnX = Math.round((currentStep / steps) * (track.analysisCanvas.width - 1));
    const columnData = imgCtx.getImageData(columnX, 0, 1, track.analysisCanvas.height).data;
    const buckets = new Float32Array(noteRange);

    for (let y = 0; y < track.analysisCanvas.height; y += 1) {
      const i = y * 4;
      const r = columnData[i];
      const g = columnData[i + 1];
      const b = columnData[i + 2];
      const noteIndex = Math.floor((1 - (y + 0.5) / track.analysisCanvas.height) * noteRange);
      const clampedIndex = Math.max(0, Math.min(noteRange - 1, noteIndex));

      if (track.colorMode === 'luma') {
        let value = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
        if (track.invert) value = 1 - value;
        buckets[clampedIndex] = Math.max(buckets[clampedIndex], value);
      } else if (track.colorMode === 'rgb') {
        const band = Math.floor((clampedIndex / noteRange) * 3);
        buckets[clampedIndex] = Math.max(buckets[clampedIndex], [r, g, b][band] / 255);
      } else {
        const { h, s, l } = rgbToHsl(r, g, b);
        const hueIndex = Math.max(0, Math.min(noteRange - 1, Math.floor(h * noteRange)));
        buckets[hueIndex] = Math.max(buckets[hueIndex], s * (1 - Math.abs(2 * l - 1)));
      }
    }

    const stripMax = Math.max(0.01, ...buckets);
    const noteBarWidth = width / noteRange;
    for (let i = 0; i < noteRange; i += 1) {
      const luma = Math.round((buckets[i] / stripMax) * 180);
      if (luma < 8) continue;
      ctx.fillStyle = `rgb(${luma},${luma},${luma})`;
      ctx.fillRect(i * noteBarWidth, stripY, Math.max(1, noteBarWidth - 0.3), stripHeight);
    }

    ctx.fillStyle = '#1e1e1c';
    ctx.fillRect(0, stripY - 1, width, 1);
    ctx.fillRect(0, stripY + stripHeight, width, 1);
  }

  const frequencies = new Float32Array(noteRange);
  for (const notes of track.sequence) {
    for (const { note } of notes) {
      const index = note - track.noteMin;
      if (index >= 0 && index < noteRange) frequencies[index] += 1;
    }
  }

  const maxFrequency = Math.max(1, ...frequencies);
  const noteBarWidth = width / noteRange;
  for (let i = 0; i < noteRange; i += 1) {
    const note = track.noteMin + i;
    const pc = note % 12;
    const isBlack = [1, 3, 6, 8, 10].includes(pc);
    const isCurrentC = pc === 0;
    const isActive = isLive && track.activeNotes.has(note);

    let luma;
    let barHeight;
    if (isActive) {
      luma = 230;
      barHeight = Math.max(2, histHeight * 0.85);
    } else {
      if (frequencies[i] === 0) continue;
      luma = isBlack ? 52 : (isCurrentC ? 110 : 90);
      barHeight = Math.max(1, (frequencies[i] / maxFrequency) * histHeight);
    }

    const x = i * noteBarWidth;
    ctx.fillStyle = `rgb(${luma},${luma},${luma})`;
    ctx.fillRect(x + 0.5, histY + histHeight - barHeight, Math.max(1, noteBarWidth - 0.5), barHeight);
  }

  ctx.fillStyle = '#222';
  for (let note = track.noteMin; note <= track.noteMax; note += 1) {
    if (note % 12 === 0) {
      const x = (note - track.noteMin) * noteBarWidth;
      ctx.fillRect(x, histY, 1, histHeight);
    }
  }

  const avgPoly = activeSteps > 0 ? (totalPoly / activeSteps).toFixed(1) : '0';
  const activePct = Math.round((activeSteps / steps) * 100);
  refs.statActive.textContent = `${activeSteps}/${steps} (${activePct}%)`;
  refs.statPoly.textContent = avgPoly;
  refs.statRange.textContent = activeSteps > 0 ? `${midiNoteName(minNote)}–${midiNoteName(maxNote)}` : '—';
  refs.statTotal.textContent = totalNotes;
}

export function updateFilterCount(track) {
  if (!refs.filterCount) return;
  const count = track.allowedPitchClasses.size;
  refs.filterCount.textContent = count < 12 ? `${count}/12` : '';
}

export function renderPiano(track, actions) {
  refs.pianoKeyboard.innerHTML = '';
  const activePitchClasses = track.allowedPitchClasses;

  for (const [pc, label] of WHITE_KEYS) {
    const key = document.createElement('div');
    key.className = `piano-white ${activePitchClasses.has(pc) ? 'on' : 'off'}`;
    key.style.left = `${(WHITE_KEYS.findIndex(([value]) => value === pc) / 7) * 100}%`;
    key.style.width = `${100 / 7}%`;
    key.textContent = label;
    key.addEventListener('click', () => actions.onTogglePitchClass(track, pc));
    refs.pianoKeyboard.appendChild(key);
  }

  for (const [pc, leftPct] of BLACK_KEYS) {
    const key = document.createElement('div');
    key.className = `piano-black ${activePitchClasses.has(pc) ? 'on' : 'off'}`;
    key.style.left = `${leftPct}%`;
    key.style.width = '9%';
    const keyLabel = document.createElement('span');
    keyLabel.className = 'piano-black-label';
    keyLabel.textContent = NOTE_NAMES[pc];
    key.appendChild(keyLabel);
    key.addEventListener('click', () => actions.onTogglePitchClass(track, pc));
    refs.pianoKeyboard.appendChild(key);
  }

  updateFilterCount(track);
}

export function renderTrackStrip(actions) {
  refs.trackStrip.innerHTML = '';

  for (const track of appState.tracks) {
    const chip = document.createElement('div');
    chip.className = `track-chip${track.id === appState.activeTrackId ? ' selected' : ''}${track.muted ? ' muted' : ''}${track.analysisCanvas ? ' has-image' : ''}`;
    chip.draggable = true;
    chip.dataset.trackId = String(track.id);

    const nameRow = document.createElement('div');
    nameRow.className = 'chip-name-row';

    const nameLabel = document.createElement('span');
    nameLabel.className = 'chip-name-lbl';
    nameLabel.textContent = trackDisplayName(track);

    const nameInput = document.createElement('input');
    nameInput.className = 'chip-name-input';
    nameInput.type = 'text';
    nameInput.maxLength = 20;

    const startRename = (event) => {
      event?.stopPropagation();
      nameLabel.classList.add('editing');
      nameInput.classList.add('visible');
      nameInput.value = track.name;
      nameInput.focus();
      nameInput.select();
    };

    const commitRename = () => {
      actions.onRenameTrack(track, nameInput.value.trim());
      nameLabel.classList.remove('editing');
      nameInput.classList.remove('visible');
      nameLabel.textContent = trackDisplayName(track);
    };

    nameLabel.addEventListener('dblclick', startRename);
    nameInput.addEventListener('blur', commitRename);
    nameInput.addEventListener('click', (event) => event.stopPropagation());
    nameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') commitRename();
      if (event.key === 'Escape') {
        nameInput.value = track.name;
        commitRename();
      }
    });

    nameRow.append(nameLabel, nameInput);

    const thumbArea = document.createElement('div');
    thumbArea.className = 'chip-media';
    if (track.analysisCanvas) {
      const thumb = document.createElement('canvas');
      thumb.width = 76;
      thumb.height = 60;
      const ctx = thumb.getContext('2d');
      const sourceRatio = track.analysisCanvas.width / track.analysisCanvas.height;
      const targetRatio = thumb.width / thumb.height;
      let sx = 0;
      let sy = 0;
      let sw = track.analysisCanvas.width;
      let sh = track.analysisCanvas.height;

      if (sourceRatio > targetRatio) {
        sw = track.analysisCanvas.height * targetRatio;
        sx = (track.analysisCanvas.width - sw) / 2;
      } else {
        sh = track.analysisCanvas.width / targetRatio;
        sy = (track.analysisCanvas.height - sh) / 2;
      }

      ctx.drawImage(track.analysisCanvas, sx, sy, sw, sh, 0, 0, thumb.width, thumb.height);
      thumbArea.appendChild(thumb);
    }

    const footer = document.createElement('div');
    footer.className = 'chip-footer';

    const channelLabel = document.createElement('span');
    channelLabel.className = 'chip-ch';
    channelLabel.textContent = `CH${track.channel}`;

    if (track.analysisCanvas) {
      footer.appendChild(channelLabel);
      const muteButton = document.createElement('button');
      muteButton.className = `chip-mute chip-mute-overlay${track.muted ? ' active' : ''}`;
      muteButton.textContent = 'MUTE';
      muteButton.addEventListener('click', (event) => {
        event.stopPropagation();
        actions.onToggleMute(track);
      });
      thumbArea.appendChild(muteButton);

      const duplicateButton = document.createElement('button');
      duplicateButton.className = 'chip-action chip-duplicate';
      duplicateButton.title = 'Duplicate track';
      duplicateButton.textContent = '⧉';
      duplicateButton.addEventListener('click', (event) => {
        event.stopPropagation();
        actions.onDuplicateTrack(track);
      });
      thumbArea.appendChild(duplicateButton);

      chip.append(thumbArea);
    } else {
      footer.append(nameLabel, nameInput);
      chip.append(thumbArea, footer);
    }

    const removeButton = document.createElement('button');
    removeButton.className = 'chip-action chip-remove';
    removeButton.title = 'Delete track';
    removeButton.textContent = '×';
    removeButton.addEventListener('click', (event) => {
      event.stopPropagation();
      actions.onConfirmRemoveTrack(track.id);
    });

    chip.appendChild(removeButton);
    chip.addEventListener('click', () => actions.onSelectTrack(track.id));
    chip.addEventListener('dragstart', (event) => {
      event.dataTransfer?.setData('text/plain', String(track.id));
      event.dataTransfer.effectAllowed = 'move';
      chip.classList.add('dragging');
    });
    chip.addEventListener('dragend', () => {
      chip.classList.remove('dragging', 'drag-over-before', 'drag-over-after');
      refs.trackStrip.querySelectorAll('.drag-over-before, .drag-over-after').forEach((node) => {
        node.classList.remove('drag-over-before', 'drag-over-after');
      });
    });
    chip.addEventListener('dragover', (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      const rect = chip.getBoundingClientRect();
      const placeAfter = event.clientX > rect.left + rect.width / 2;
      chip.classList.toggle('drag-over-before', !placeAfter);
      chip.classList.toggle('drag-over-after', placeAfter);
    });
    chip.addEventListener('dragleave', () => {
      chip.classList.remove('drag-over-before', 'drag-over-after');
    });
    chip.addEventListener('drop', (event) => {
      event.preventDefault();
      const sourceId = Number(event.dataTransfer?.getData('text/plain'));
      const rect = chip.getBoundingClientRect();
      const placement = event.clientX > rect.left + rect.width / 2 ? 'after' : 'before';
      chip.classList.remove('drag-over-before', 'drag-over-after');
      if (Number.isFinite(sourceId)) actions.onReorderTrack(sourceId, track.id, placement);
    });
    refs.trackStrip.appendChild(chip);
  }

  const addButton = document.createElement('button');
  addButton.className = 'track-add-btn';
  addButton.textContent = '+';
  addButton.addEventListener('click', actions.onAddTrack);
  refs.trackStrip.appendChild(addButton);
}

export function renderSidebar(actions) {
  const track = getActiveTrack();
  if (!track) return;

  refs.crtPrimaryLabel.textContent = trackDisplayName(track);
  refs.crtSecondaryLabel.textContent = '';
  refs.sidebarTrackLabel.textContent = trackDisplayName(track);
  refs.pasteSettingsBtn.style.display = appState.settingsClipboard ? '' : 'none';
  refs.midiChannel.value = track.channel;
  refs.musicInstrument.value = track.instrument;
  refs.noteMinSlider.value = track.noteMin;
  refs.noteMaxSlider.value = track.noteMax;
  refs.noteMinTxt.value = midiNoteName(track.noteMin);
  refs.noteMaxTxt.value = midiNoteName(track.noteMax);
  actions.updateDualRange();
  refs.chordType.value = track.chord;
  refs.threshold.value = track.threshold;
  refs.threshVal.textContent = `${track.threshold}%`;
  refs.velocityScale.value = track.velocityScale;
  refs.velocVal.textContent = `${track.velocityScale}%`;
  refs.maxPoly.value = track.maxPoly;
  refs.polyVal.textContent = `${track.maxPoly}`;
  refs.density.value = track.density;
  refs.densityVal.textContent = `${track.density}%`;
  refs.colorMode.value = track.colorMode;
  refs.normalize.checked = track.normalize;
  refs.invertMode.checked = track.invert;
  refs.bpm.value = track.bpm;
  refs.steps.value = track.steps;
  refs.noteDiv.value = track.noteDiv;
  refs.loopMode.checked = track.loop;
  refs.outputModeMidiBtn.classList.toggle('active', appState.outputMode === 'midi');
  refs.outputModeMusicBtn.classList.toggle('active', appState.outputMode === 'music');
  refs.midiOutputRow.style.display = appState.outputMode === 'midi' ? '' : 'none';
  refs.musicInstrumentRow.style.display = appState.outputMode === 'music' ? '' : 'none';

  renderPiano(track, actions);
  refreshKnobs();
}

export function refreshKnobs() {
  for (const knob of document.querySelectorAll('.knob[data-input]')) {
    const input = document.getElementById(knob.dataset.input);
    if (!input) continue;
    const min = Number.parseFloat(knob.dataset.min);
    const max = Number.parseFloat(knob.dataset.max);
    const value = Number.parseFloat(input.value);
    const degrees = -135 + ((value - min) / (max - min)) * 270;
    knob.style.setProperty('--rot', `${degrees}deg`);
  }
}

export function syncProjectTitle() {
  const name = appState.currentProjectName?.trim();
  refs.projectTitleLabel.textContent = name || 'IMAGE → MIDI';
  refs.projectTitleInput.value = name || '';
}

export function renderProjectsList(projects, actions) {
  if (!projects.length) {
    refs.projList.innerHTML = '<div class="proj-empty">NO SAVED PROJECTS</div>';
    return;
  }

  refs.projList.innerHTML = '';
  for (const project of projects) {
    const item = document.createElement('div');
    item.className = 'proj-item';

    const nameWrap = document.createElement('div');
    nameWrap.className = 'proj-item-name-wrap';

    if (appState.editingProjectId === project.id) {
      const renameInput = document.createElement('input');
      renameInput.className = 'proj-item-name-input';
      renameInput.type = 'text';
      renameInput.maxLength = 60;
      renameInput.value = project.name;
      renameInput.addEventListener('click', (event) => event.stopPropagation());
      renameInput.addEventListener('blur', () => actions.onCommitRename(project.id, renameInput.value.trim()));
      renameInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') actions.onCommitRename(project.id, renameInput.value.trim());
        if (event.key === 'Escape') actions.onCancelRename();
      });
      nameWrap.appendChild(renameInput);
      requestAnimationFrame(() => {
        renameInput.focus();
        renameInput.select();
      });
    } else {
      const name = document.createElement('span');
      name.className = 'proj-item-name';
      name.textContent = project.name;
      nameWrap.appendChild(name);
    }

    const date = document.createElement('span');
    date.className = 'proj-item-date';
    const parsedDate = new Date(project.timestamp);
    date.textContent = `${parsedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${parsedDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}`;

    const loadButton = document.createElement('button');
    loadButton.className = 'proj-item-load';
    loadButton.textContent = 'LOAD';
    loadButton.addEventListener('click', () => actions.onLoad(project.id));

    const menuWrap = document.createElement('div');
    menuWrap.className = 'menu-wrap proj-item-menu-wrap';

    const menuButton = document.createElement('button');
    menuButton.className = 'menu-btn proj-item-menu-btn';
    menuButton.textContent = '⋯';
    menuButton.addEventListener('click', (event) => {
      event.stopPropagation();
      dropdown.classList.toggle('open');
    });

    const dropdown = document.createElement('div');
    dropdown.className = 'menu-dropdown proj-item-dropdown';

    const renameButton = document.createElement('button');
    renameButton.className = 'menu-item';
    renameButton.textContent = 'RENAME';
    renameButton.addEventListener('click', () => {
      dropdown.classList.remove('open');
      actions.onRename(project.id);
    });

    const duplicateButton = document.createElement('button');
    duplicateButton.className = 'menu-item';
    duplicateButton.textContent = 'DUPLICATE';
    duplicateButton.addEventListener('click', () => {
      dropdown.classList.remove('open');
      actions.onDuplicate(project.id);
    });

    const deleteButton = document.createElement('button');
    deleteButton.className = 'menu-item danger';
    deleteButton.textContent = 'DELETE';
    deleteButton.addEventListener('click', () => {
      dropdown.classList.remove('open');
      actions.onDelete(project.id);
    });

    menuWrap.addEventListener('focusout', (event) => {
      if (!menuWrap.contains(event.relatedTarget)) dropdown.classList.remove('open');
    });

    dropdown.append(renameButton, duplicateButton, deleteButton);
    menuWrap.append(menuButton, dropdown);

    item.append(nameWrap, date, loadButton, menuWrap);
    refs.projList.appendChild(item);
  }
}
