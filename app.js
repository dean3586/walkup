/* Walk-Up Music App */

(function () {
  'use strict';

  // === State ===
  let roster = [];
  let lineup = [];
  let currentBatterIdx = -1;
  let currentPlayer = null;
  let playbackPhase = null;   // 'announcement' | 'walkup' | null
  let fadeInterval = null;
  let progressInterval = null;
  let walkupFadeTimeout = null;
  let globalDuration = 30;
  let isPaused = false;
  let playbackStartTime = 0;
  let pausedAt = 0;
  let totalPausedMs = 0;
  let wakeLock = null;

  // === Drag (lineup reorder) state ===
  let dragItem = null;
  let dragIdx = -1;
  let dragOffsetY = 0;
  let placeholder = null;

  // === Audio cache ===
  const objectUrlCache = {};   // playerNumber -> object URL for uploaded blob
  const audioBufferCache = {}; // playerNumber -> decoded AudioBuffer (for waveform)

  // === DOM refs ===
  const rosterView = document.getElementById('roster-view');
  const lineupList = document.getElementById('lineup-list');
  const availableList = document.getElementById('available-list');
  const clearLineupBtn = document.getElementById('clear-lineup-btn');
  const playbackBar = document.getElementById('playback-bar');
  const playbackNumber = document.getElementById('playback-number');
  const playbackName = document.getElementById('playback-name');
  const playbackStatus = document.getElementById('playback-status');
  const prevBtn = document.getElementById('prev-btn');
  const playPauseBtn = document.getElementById('play-pause-btn');
  const nextBtn = document.getElementById('next-btn');
  const batterBtn = document.getElementById('batter-btn');
  const playIcon = document.getElementById('play-icon');
  const pauseIcon = document.getElementById('pause-icon');
  const progressBar = document.getElementById('progress-bar');
  const progressFill = document.getElementById('progress-fill');
  const timeCurrent = document.getElementById('time-current');
  const timeTotal = document.getElementById('time-total');
  const announcementAudio = document.getElementById('announcement-audio');
  const walkupAudio = document.getElementById('walkup-audio');
  const globalDurationSlider = document.getElementById('global-duration');
  const globalDurationLabel = document.getElementById('global-duration-label');
  const songSettingsList = document.getElementById('song-settings-list');

  // Now Playing (fullscreen) refs
  const nowPlaying = document.getElementById('now-playing');
  const expandBtn = document.getElementById('expand-btn');
  const collapseBtn = document.getElementById('collapse-btn');
  const npNumber = document.getElementById('np-number');
  const npName = document.getElementById('np-name');
  const npProgressBar = document.getElementById('np-progress-bar');
  const npProgressFill = document.getElementById('np-progress-fill');
  const npTimeCurrent = document.getElementById('np-time-current');
  const npTimeTotal = document.getElementById('np-time-total');
  const npPrevBtn = document.getElementById('np-prev-btn');
  const npNextBtn = document.getElementById('np-next-btn');
  const npPlayPauseBtn = document.getElementById('np-play-pause-btn');
  const npPlayIcon = document.getElementById('np-play-icon');
  const npPauseIcon = document.getElementById('np-pause-icon');
  const npBatterBtn = document.getElementById('np-batter-btn');
  const npNextBatter = document.getElementById('np-next-batter');

  // === IndexedDB for uploaded audio files ===
  const DB_NAME = 'walkup-audio';
  const STORE_NAME = 'files';
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE_NAME);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function saveAudioFile(playerNumber, blob) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(blob, playerNumber);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getAudioFile(playerNumber) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(playerNumber);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function loadUploadedAudio() {
    // For each player, check IndexedDB for uploaded file. If present, override the walkup file path with object URL.
    for (const player of roster) {
      const blob = await getAudioFile(player.number);
      if (blob) {
        const url = URL.createObjectURL(blob);
        objectUrlCache[player.number] = url;
        if (!player.walkup) {
          player.walkup = { startTime: 0 };
        }
        player.walkup.file = url;
      }
    }
  }

  // === Wake Lock ===
  async function acquireWakeLock() {
    try {
      if ('wakeLock' in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch (e) {
      // Silent fail — wake lock not supported or denied
    }
  }

  function releaseWakeLock() {
    if (wakeLock) {
      wakeLock.release().catch(() => {});
      wakeLock = null;
    }
  }

  // Re-acquire on visibility change (page returns from background)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && playbackPhase) {
      acquireWakeLock();
    }
  });

  // === Init ===
  async function init() {
    const resp = await fetch('roster.json');
    roster = await resp.json();
    roster.sort((a, b) => a.number - b.number);

    await loadUploadedAudio();

    const saved = localStorage.getItem('walkup-lineup');
    if (saved) {
      try {
        lineup = JSON.parse(saved);
        const rosterNums = new Set(roster.map(p => p.number));
        lineup = lineup.filter(n => rosterNums.has(n));
      } catch (e) {
        lineup = [];
      }
    }

    const savedDuration = localStorage.getItem('walkup-global-duration');
    if (savedDuration) globalDuration = parseInt(savedDuration) || 30;

    const savedStartTimes = localStorage.getItem('walkup-start-times');
    if (savedStartTimes) {
      try {
        const times = JSON.parse(savedStartTimes);
        roster.forEach(p => {
          if (p.walkup && times[p.number] !== undefined) {
            p.walkup.startTime = times[p.number];
          }
        });
      } catch (e) {}
    }

    renderRoster();
    renderLineup();
    renderSettings();
    setupTabs();
    setupControls();
    updateTransportState();
  }

  // === Tab switching ===
  function setupTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.tab + '-view').classList.add('active');

        // Lazy-render waveforms when settings tab opens
        if (tab.dataset.tab === 'settings') {
          renderAllWaveforms();
        }
      });
    });
  }

  // === Roster rendering ===
  function renderRoster() {
    rosterView.innerHTML = '';
    roster.forEach(player => {
      const card = document.createElement('div');
      card.className = 'player-card';
      card.dataset.number = player.number;

      const hasWalkup = player.walkup !== null;
      card.innerHTML = `
        <div class="player-card-number">#${player.number}</div>
        <div class="player-card-info">
          <span class="player-card-first">${player.firstName}</span>
          <span class="player-card-last">${player.lastName}</span>
        </div>
        <div class="player-card-right">
          ${hasWalkup
            ? '<span class="music-indicator">&#9835;</span>'
            : '<span class="no-music-indicator">no song</span>'}
        </div>
      `;

      card.addEventListener('click', () => playPlayer(player));
      attachDropHandlers(card, player);
      rosterView.appendChild(card);
    });
  }

  // === Lineup rendering ===
  function renderLineup() {
    if (lineup.length === 0) {
      lineupList.innerHTML = '<div class="empty-lineup">No batting order set.<br>Tap players below to build the lineup.</div>';
    } else {
      lineupList.innerHTML = '';
      lineup.forEach((num, idx) => {
        const player = roster.find(p => p.number === num);
        if (!player) return;

        const item = document.createElement('div');
        item.className = 'lineup-item';
        item.dataset.number = num;
        item.dataset.idx = idx;
        if (idx === currentBatterIdx) item.classList.add('current');
        if (currentPlayer && currentPlayer.number === num && playbackPhase) {
          item.classList.add('playing');
        }

        item.innerHTML = `
          <span class="drag-handle" aria-label="Drag to reorder">
            <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
              <circle cx="2" cy="2" r="1.5"/><circle cx="8" cy="2" r="1.5"/>
              <circle cx="2" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/>
              <circle cx="2" cy="14" r="1.5"/><circle cx="8" cy="14" r="1.5"/>
            </svg>
          </span>
          <span class="lineup-position">${idx + 1}</span>
          <span class="lineup-player-number">#${player.number}</span>
          <span class="lineup-player-name">${player.firstName} ${player.lastName}</span>
          <button class="lineup-remove" data-idx="${idx}">&times;</button>
        `;

        item.addEventListener('click', (e) => {
          if (e.target.closest('.lineup-remove') || e.target.closest('.drag-handle')) return;
          currentBatterIdx = idx;
          playPlayer(player);
          renderLineup();
        });

        const handle = item.querySelector('.drag-handle');
        handle.addEventListener('touchstart', (e) => onDragStart(e, item, idx), { passive: false });

        lineupList.appendChild(item);
      });
    }

    lineupList.querySelectorAll('.lineup-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx);
        lineup.splice(idx, 1);
        if (currentBatterIdx >= lineup.length) currentBatterIdx = lineup.length - 1;
        saveLineup();
        renderLineup();
        renderAvailable();
        updateTransportState();
      });
    });

    renderAvailable();
    updateTransportState();
  }

  // === Touch drag-to-reorder ===
  function onDragStart(e, item, idx) {
    e.preventDefault();
    const touch = e.touches[0];
    dragItem = item;
    dragIdx = idx;

    const rect = item.getBoundingClientRect();
    dragOffsetY = touch.clientY - rect.top;

    placeholder = document.createElement('div');
    placeholder.className = 'lineup-placeholder';
    placeholder.style.height = rect.height + 'px';
    item.parentNode.insertBefore(placeholder, item);

    item.classList.add('dragging');
    item.style.width = rect.width + 'px';
    item.style.top = rect.top + 'px';
    item.style.left = rect.left + 'px';
    document.body.appendChild(item);

    document.addEventListener('touchmove', onDragMove, { passive: false });
    document.addEventListener('touchend', onDragEnd);
    document.addEventListener('touchcancel', onDragEnd);
  }

  function onDragMove(e) {
    if (!dragItem) return;
    e.preventDefault();
    const touch = e.touches[0];
    dragItem.style.top = (touch.clientY - dragOffsetY) + 'px';

    const items = lineupList.querySelectorAll('.lineup-item:not(.dragging)');
    let insertBefore = null;

    for (const child of items) {
      const rect = child.getBoundingClientRect();
      if (touch.clientY < rect.top + rect.height / 2) {
        insertBefore = child;
        break;
      }
    }

    if (insertBefore) {
      lineupList.insertBefore(placeholder, insertBefore);
    } else {
      lineupList.appendChild(placeholder);
    }
  }

  function onDragEnd() {
    if (!dragItem) return;
    document.removeEventListener('touchmove', onDragMove);
    document.removeEventListener('touchend', onDragEnd);
    document.removeEventListener('touchcancel', onDragEnd);

    const allChildren = Array.from(lineupList.children);
    let newIdx = allChildren.indexOf(placeholder);

    dragItem.classList.remove('dragging');
    dragItem.style.width = '';
    dragItem.style.top = '';
    dragItem.style.left = '';

    if (placeholder.parentNode) placeholder.parentNode.removeChild(placeholder);

    if (newIdx !== dragIdx && newIdx >= 0) {
      const [moved] = lineup.splice(dragIdx, 1);
      lineup.splice(newIdx, 0, moved);

      if (currentBatterIdx === dragIdx) {
        currentBatterIdx = newIdx;
      } else {
        if (currentBatterIdx > dragIdx) currentBatterIdx--;
        if (currentBatterIdx >= newIdx) currentBatterIdx++;
      }

      saveLineup();
    }

    dragItem = null;
    dragIdx = -1;
    placeholder = null;
    renderLineup();
  }

  function renderAvailable() {
    const inLineup = new Set(lineup);
    availableList.innerHTML = '';
    roster.forEach(player => {
      const el = document.createElement('div');
      el.className = 'available-player' + (inLineup.has(player.number) ? ' in-lineup' : '');
      el.innerHTML = `
        <div class="num">#${player.number}</div>
        <div class="name">${player.firstName} ${player.lastName}</div>
      `;
      el.addEventListener('click', () => {
        if (inLineup.has(player.number)) return;
        lineup.push(player.number);
        saveLineup();
        renderLineup();
      });
      availableList.appendChild(el);
    });
  }

  function saveLineup() {
    localStorage.setItem('walkup-lineup', JSON.stringify(lineup));
  }

  // === Settings rendering ===
  function renderSettings() {
    globalDurationSlider.value = globalDuration;
    globalDurationLabel.textContent = globalDuration + 's';

    songSettingsList.innerHTML = '';
    roster.forEach(player => {
      const hasWalkup = player.walkup !== null;
      const row = document.createElement('div');
      row.className = 'song-setting-row';
      row.dataset.number = player.number;

      const startTime = hasWalkup ? (player.walkup.startTime || 0) : 0;

      row.innerHTML = `
        <div class="song-setting-header">
          <div class="song-setting-player">
            <span class="song-setting-number">#${player.number}</span>
            <span class="song-setting-name">${player.firstName} ${player.lastName}</span>
          </div>
          <div class="song-setting-control">
            ${hasWalkup ? `
              <button class="start-time-btn minus" data-number="${player.number}">-</button>
              <span class="start-time-value" data-number="${player.number}">${formatTime(startTime)}</span>
              <button class="start-time-btn plus" data-number="${player.number}">+</button>
            ` : ''}
            <button class="start-time-preview" data-number="${player.number}" title="Preview">&#9654;</button>
          </div>
        </div>
        <div class="waveform-container" data-number="${player.number}">
          ${hasWalkup
            ? `<canvas class="waveform-canvas" data-number="${player.number}"></canvas>
               <div class="waveform-marker" data-number="${player.number}"></div>
               <div class="waveform-overlay">Drop MP3 to replace</div>`
            : `<div class="waveform-empty">Drop an MP3 here to assign a walk-up song</div>`}
        </div>
      `;

      // Drop target on the waveform container
      const waveformContainer = row.querySelector('.waveform-container');
      attachDropHandlers(waveformContainer, player);

      songSettingsList.appendChild(row);
    });

    // Wire up +/- buttons
    songSettingsList.querySelectorAll('.start-time-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const num = parseInt(btn.dataset.number);
        const player = roster.find(p => p.number === num);
        if (!player || !player.walkup) return;

        const delta = btn.classList.contains('plus') ? 1 : -1;
        player.walkup.startTime = Math.max(0, (player.walkup.startTime || 0) + delta);

        const valueEl = songSettingsList.querySelector(`.start-time-value[data-number="${num}"]`);
        if (valueEl) valueEl.textContent = formatTime(player.walkup.startTime);

        updateWaveformMarker(num);
        saveStartTimes();
      });
    });

    // Wire up preview buttons (full-duration playback)
    songSettingsList.querySelectorAll('.start-time-preview').forEach(btn => {
      btn.addEventListener('click', () => {
        const num = parseInt(btn.dataset.number);
        const player = roster.find(p => p.number === num);
        if (!player) return;
        playPlayer(player);
        playbackStatus.textContent = 'Preview';
      });
    });

    // Wire up waveform clicks (set start time)
    songSettingsList.querySelectorAll('.waveform-canvas').forEach(canvas => {
      canvas.addEventListener('click', (e) => {
        const num = parseInt(canvas.dataset.number);
        const player = roster.find(p => p.number === num);
        if (!player || !player.walkup) return;
        const buf = audioBufferCache[num];
        if (!buf) return;

        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const pct = x / rect.width;
        player.walkup.startTime = Math.round(pct * buf.duration);

        const valueEl = songSettingsList.querySelector(`.start-time-value[data-number="${num}"]`);
        if (valueEl) valueEl.textContent = formatTime(player.walkup.startTime);

        updateWaveformMarker(num);
        saveStartTimes();
      });
    });
  }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds) % 60;
    return m + ':' + String(s).padStart(2, '0');
  }

  function saveStartTimes() {
    const times = {};
    roster.forEach(p => {
      if (p.walkup) times[p.number] = p.walkup.startTime || 0;
    });
    localStorage.setItem('walkup-start-times', JSON.stringify(times));
  }

  // === Waveform rendering ===
  async function renderAllWaveforms() {
    for (const player of roster) {
      if (player.walkup) {
        await renderWaveform(player);
      }
    }
  }

  async function renderWaveform(player) {
    const canvas = songSettingsList.querySelector(`.waveform-canvas[data-number="${player.number}"]`);
    if (!canvas) return;

    let buffer = audioBufferCache[player.number];
    if (!buffer) {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const arrayBuffer = await fetch(player.walkup.file).then(r => r.arrayBuffer());
        buffer = await ctx.decodeAudioData(arrayBuffer);
        audioBufferCache[player.number] = buffer;
      } catch (e) {
        console.error('Failed to decode audio for waveform', e);
        return;
      }
    }

    drawWaveform(canvas, buffer);
    updateWaveformMarker(player.number);
  }

  function drawWaveform(canvas, buffer) {
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.offsetWidth || canvas.parentElement.offsetWidth || 300;
    const cssHeight = 60;
    canvas.width = cssWidth * dpr;
    canvas.height = cssHeight * dpr;
    canvas.style.width = cssWidth + 'px';
    canvas.style.height = cssHeight + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const channelData = buffer.getChannelData(0);
    const bars = Math.floor(cssWidth / 3);
    const samplesPerBar = Math.floor(channelData.length / bars);
    const midY = cssHeight / 2;

    ctx.fillStyle = 'rgba(251, 252, 255, 0.35)';
    for (let i = 0; i < bars; i++) {
      let max = 0;
      const start = i * samplesPerBar;
      const end = start + samplesPerBar;
      for (let j = start; j < end; j++) {
        const v = Math.abs(channelData[j]);
        if (v > max) max = v;
      }
      const h = Math.max(1, max * cssHeight * 0.9);
      ctx.fillRect(i * 3, midY - h / 2, 2, h);
    }
  }

  function updateWaveformMarker(playerNumber) {
    const player = roster.find(p => p.number === playerNumber);
    if (!player || !player.walkup) return;
    const buf = audioBufferCache[playerNumber];
    if (!buf) return;

    const marker = songSettingsList.querySelector(`.waveform-marker[data-number="${playerNumber}"]`);
    if (!marker) return;

    const pct = ((player.walkup.startTime || 0) / buf.duration) * 100;
    marker.style.left = pct + '%';
  }

  // === Drag-and-drop file upload ===
  function attachDropHandlers(element, player) {
    element.addEventListener('dragover', (e) => {
      // Only show drop zone if files are being dragged
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
        e.preventDefault();
        element.classList.add('drag-over');
      }
    });

    element.addEventListener('dragleave', (e) => {
      if (!element.contains(e.relatedTarget)) {
        element.classList.remove('drag-over');
      }
    });

    element.addEventListener('drop', async (e) => {
      e.preventDefault();
      element.classList.remove('drag-over');

      const file = e.dataTransfer.files[0];
      if (!file) return;
      if (!file.type.startsWith('audio/') && !file.name.toLowerCase().endsWith('.mp3')) {
        alert('Please drop an audio file (MP3)');
        return;
      }

      try {
        await saveAudioFile(player.number, file);

        // Revoke old object URL if any
        if (objectUrlCache[player.number]) {
          URL.revokeObjectURL(objectUrlCache[player.number]);
        }

        const url = URL.createObjectURL(file);
        objectUrlCache[player.number] = url;

        if (!player.walkup) {
          player.walkup = { startTime: 0 };
        }
        player.walkup.file = url;

        // Clear waveform cache so it re-decodes
        delete audioBufferCache[player.number];

        renderRoster();
        renderSettings();
        renderAllWaveforms();
      } catch (err) {
        console.error('Failed to save audio file', err);
        alert('Failed to save audio file: ' + err.message);
      }
    });
  }

  // === Playback ===
  function getTotalDuration() {
    if (!currentPlayer) return 0;
    const annDur = (announcementAudio.duration && isFinite(announcementAudio.duration))
      ? announcementAudio.duration : 3;
    if (!currentPlayer.walkup) return annDur;
    const walkupDur = currentPlayer.walkup.duration || globalDuration;
    return Math.max(annDur, walkupDur);
  }

  function setupControls() {
    playPauseBtn.addEventListener('click', () => {
      if (!currentPlayer || !playbackPhase) {
        if (lineup.length > 0) {
          if (currentBatterIdx < 0) currentBatterIdx = 0;
          const num = lineup[currentBatterIdx];
          const player = roster.find(p => p.number === num);
          if (player) {
            playPlayer(player);
            renderLineup();
          }
        }
        return;
      }

      if (isPaused) {
        if (playbackPhase === 'announcement') {
          announcementAudio.play().catch(() => {});
          if (currentPlayer && currentPlayer.walkup) walkupAudio.play().catch(() => {});
        } else {
          walkupAudio.play().catch(() => {});
        }
        totalPausedMs += Date.now() - pausedAt;
        isPaused = false;
        acquireWakeLock();
      } else {
        announcementAudio.pause();
        walkupAudio.pause();
        pausedAt = Date.now();
        isPaused = true;
        releaseWakeLock();
      }
      updatePlayPauseIcon();
    });

    function advanceBatter() {
      if (lineup.length === 0) return;
      currentBatterIdx = (currentBatterIdx + 1) % lineup.length;
      const num = lineup[currentBatterIdx];
      const player = roster.find(p => p.number === num);
      if (player) {
        playPlayer(player);
        renderLineup();
      }
    }

    prevBtn.addEventListener('click', () => {
      if (lineup.length === 0) return;
      currentBatterIdx = (currentBatterIdx - 1 + lineup.length) % lineup.length;
      const num = lineup[currentBatterIdx];
      const player = roster.find(p => p.number === num);
      if (player) {
        playPlayer(player);
        renderLineup();
      }
    });

    nextBtn.addEventListener('click', advanceBatter);

    batterBtn.addEventListener('click', () => {
      if (playbackPhase) {
        stopPlayback(true);
      } else {
        advanceBatter();
      }
    });

    clearLineupBtn.addEventListener('click', () => {
      if (lineup.length === 0) return;
      if (!confirm('Clear the entire batting order?')) return;
      lineup = [];
      currentBatterIdx = -1;
      saveLineup();
      renderLineup();
    });

    announcementAudio.addEventListener('ended', () => {
      if (currentPlayer && currentPlayer.walkup) {
        startWalkup(currentPlayer);
      } else {
        finishPlayback();
      }
    });

    globalDurationSlider.addEventListener('input', () => {
      globalDuration = parseInt(globalDurationSlider.value);
      globalDurationLabel.textContent = globalDuration + 's';
      localStorage.setItem('walkup-global-duration', globalDuration);
    });

    // Tap progress bar to seek
    progressBar.addEventListener('click', (e) => {
      if (!currentPlayer || !playbackPhase) return;
      const rect = progressBar.getBoundingClientRect();
      const pct = (e.clientX - rect.left) / rect.width;
      const total = getTotalDuration();
      seekTo(pct * total);
    });

    // Now Playing fullscreen
    expandBtn.addEventListener('click', () => {
      nowPlaying.classList.remove('hidden');
      updateNowPlaying();
    });

    collapseBtn.addEventListener('click', () => {
      nowPlaying.classList.add('hidden');
    });

    // Mirror controls in fullscreen view
    npPlayPauseBtn.addEventListener('click', () => playPauseBtn.click());
    npPrevBtn.addEventListener('click', () => prevBtn.click());
    npNextBtn.addEventListener('click', () => nextBtn.click());
    npBatterBtn.addEventListener('click', () => batterBtn.click());

    npProgressBar.addEventListener('click', (e) => {
      if (!currentPlayer || !playbackPhase) return;
      const rect = npProgressBar.getBoundingClientRect();
      const pct = (e.clientX - rect.left) / rect.width;
      const total = getTotalDuration();
      seekTo(pct * total);
    });
  }

  function updateNowPlaying() {
    if (!currentPlayer) {
      npNumber.textContent = '--';
      npName.textContent = 'No batter';
      npNextBatter.textContent = '—';
      return;
    }
    npNumber.textContent = '#' + currentPlayer.number;
    npName.textContent = currentPlayer.firstName + ' ' + currentPlayer.lastName;

    // Up next from lineup
    if (lineup.length > 0 && currentBatterIdx >= 0) {
      const nextIdx = (currentBatterIdx + 1) % lineup.length;
      const nextNum = lineup[nextIdx];
      const nextPlayer = roster.find(p => p.number === nextNum);
      if (nextPlayer) {
        npNextBatter.textContent = `#${nextPlayer.number} ${nextPlayer.firstName} ${nextPlayer.lastName}`;
      } else {
        npNextBatter.textContent = '—';
      }
    } else {
      npNextBatter.textContent = '—';
    }
  }

  function updateTransportState() {
    const hasLineup = lineup.length > 0;
    const isPlaying = playbackPhase !== null;

    prevBtn.disabled = !hasLineup;
    nextBtn.disabled = !hasLineup;
    batterBtn.disabled = !hasLineup;
    batterBtn.textContent = isPlaying ? 'Stop Batter' : 'Next Batter';
    playPauseBtn.disabled = !hasLineup && !isPlaying;

    npPrevBtn.disabled = !hasLineup;
    npNextBtn.disabled = !hasLineup;
    npBatterBtn.disabled = !hasLineup;
    npBatterBtn.textContent = isPlaying ? 'Stop Batter' : 'Next Batter';
    npPlayPauseBtn.disabled = !hasLineup && !isPlaying;

    playbackBar.classList.toggle('active', isPlaying);
    updateNowPlaying();
  }

  function updatePlayPauseIcon() {
    const isPlaying = playbackPhase !== null && !isPaused;
    playIcon.style.display = isPlaying ? 'none' : '';
    pauseIcon.style.display = isPlaying ? '' : 'none';
    npPlayIcon.style.display = isPlaying ? 'none' : '';
    npPauseIcon.style.display = isPlaying ? '' : 'none';
  }

  // === Play a player ===
  function playPlayer(player) {
    stopPlayback(false);

    currentPlayer = player;
    playbackPhase = 'announcement';
    isPaused = false;
    playbackStartTime = Date.now();
    pausedAt = 0;
    totalPausedMs = 0;

    showPlaybackInfo(player);
    highlightPlaying(player.number);
    updatePlayPauseIcon();
    updateTransportState();

    // Boost announcement using Web Audio API gain node
    if (!announcementAudio._boosted) {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const source = ctx.createMediaElementSource(announcementAudio);
      const gain = ctx.createGain();
      gain.gain.value = 1.5;
      source.connect(gain);
      gain.connect(ctx.destination);
      announcementAudio._boosted = true;
    }
    announcementAudio.src = player.announcement;
    announcementAudio.volume = 1;
    announcementAudio.currentTime = 0;
    announcementAudio.play().catch(() => {});

    if (player.walkup) {
      const startTime = player.walkup.startTime || 0;
      walkupAudio.src = player.walkup.file;
      walkupAudio.volume = 0.15;
      walkupAudio.currentTime = startTime;
      walkupAudio.play().catch(() => {});
    }

    acquireWakeLock();
    startProgressTracking();
  }

  function startWalkup(player) {
    playbackPhase = 'walkup';
    updatePlayPauseIcon();
    fadeIn(walkupAudio, 0.15, 1, 1000);
    scheduleWalkupFadeOut(player);
  }

  function scheduleWalkupFadeOut(player) {
    if (walkupFadeTimeout) {
      clearTimeout(walkupFadeTimeout);
      walkupFadeTimeout = null;
    }
    if (!player.walkup) return;

    const startTime = player.walkup.startTime || 0;
    const duration = player.walkup.duration || globalDuration;
    const alreadyPlayed = walkupAudio.currentTime - startTime;
    const remaining = duration - alreadyPlayed;
    if (remaining <= 0) {
      finishPlayback();
      return;
    }
    const fadeStartMs = Math.max(0, (remaining - 2) * 1000);
    walkupFadeTimeout = setTimeout(() => {
      walkupFadeTimeout = null;
      if (playbackPhase === 'walkup' && currentPlayer === player && !isPaused) {
        fadeOut(walkupAudio, 2000, () => finishPlayback());
      }
    }, fadeStartMs);
  }

  function seekTo(seconds) {
    if (!currentPlayer || !playbackPhase) return;

    const annDur = (announcementAudio.duration && isFinite(announcementAudio.duration))
      ? announcementAudio.duration : 3;
    const startTime = currentPlayer.walkup ? (currentPlayer.walkup.startTime || 0) : 0;
    const total = getTotalDuration();
    seconds = Math.max(0, Math.min(total, seconds));

    // Cancel any pending fades
    if (walkupFadeTimeout) {
      clearTimeout(walkupFadeTimeout);
      walkupFadeTimeout = null;
    }
    clearInterval(fadeInterval);

    if (seconds < annDur) {
      // In announcement phase
      playbackPhase = 'announcement';
      announcementAudio.currentTime = seconds;
      if (!isPaused) announcementAudio.play().catch(() => {});

      if (currentPlayer.walkup) {
        walkupAudio.currentTime = startTime + seconds;
        walkupAudio.volume = 0.15;
        if (!isPaused) walkupAudio.play().catch(() => {});
      }
    } else {
      // Past announcement → walkup phase
      playbackPhase = 'walkup';
      announcementAudio.pause();

      if (currentPlayer.walkup) {
        walkupAudio.currentTime = startTime + seconds;
        walkupAudio.volume = 1;
        if (!isPaused) walkupAudio.play().catch(() => {});
        scheduleWalkupFadeOut(currentPlayer);
      } else {
        finishPlayback();
        return;
      }
    }

    // Reset timer baseline
    playbackStartTime = Date.now() - (seconds * 1000);
    totalPausedMs = 0;
    if (isPaused) {
      pausedAt = Date.now();
    }
    updatePlayPauseIcon();
  }

  function stopPlayback(withFade) {
    clearInterval(fadeInterval);
    clearInterval(progressInterval);
    if (walkupFadeTimeout) {
      clearTimeout(walkupFadeTimeout);
      walkupFadeTimeout = null;
    }

    if (withFade && playbackPhase) {
      const activeAudio = playbackPhase === 'walkup' ? walkupAudio : announcementAudio;
      fadeOut(activeAudio, 1000, () => {
        silenceAll();
        finishPlayback();
      });
    } else {
      silenceAll();
      finishPlayback();
    }
  }

  function silenceAll() {
    announcementAudio.pause();
    announcementAudio.currentTime = 0;
    walkupAudio.pause();
    walkupAudio.currentTime = 0;
  }

  function finishPlayback() {
    playbackPhase = null;
    currentPlayer = null;
    isPaused = false;
    clearInterval(progressInterval);
    clearHighlights();
    updatePlayPauseIcon();
    updateTransportState();
    releaseWakeLock();
    playbackNumber.textContent = '';
    playbackName.textContent = 'No player selected';
    playbackStatus.textContent = '';
    timeCurrent.textContent = '--:--';
    timeTotal.textContent = '--:--';
    progressFill.style.width = '0%';
  }

  function fadeIn(audio, fromVol, toVol, durationMs) {
    audio.volume = fromVol;
    const steps = 20;
    const stepTime = durationMs / steps;
    const volStep = (toVol - fromVol) / steps;
    let step = 0;
    const interval = setInterval(() => {
      step++;
      audio.volume = Math.min(toVol, fromVol + volStep * step);
      if (step >= steps) {
        clearInterval(interval);
        audio.volume = toVol;
      }
    }, stepTime);
  }

  function fadeOut(audio, durationMs, onComplete) {
    clearInterval(fadeInterval);
    const startVol = audio.volume;
    const steps = 20;
    const stepTime = durationMs / steps;
    const volStep = startVol / steps;
    let step = 0;

    fadeInterval = setInterval(() => {
      step++;
      audio.volume = Math.max(0, startVol - volStep * step);
      if (step >= steps) {
        clearInterval(fadeInterval);
        audio.pause();
        audio.volume = startVol;
        if (onComplete) onComplete();
      }
    }, stepTime);
  }

  // === Progress tracking ===
  function startProgressTracking() {
    clearInterval(progressInterval);
    progressInterval = setInterval(() => {
      if (!currentPlayer || !playbackPhase) {
        clearInterval(progressInterval);
        return;
      }

      const now = isPaused ? pausedAt : Date.now();
      const elapsed = (now - playbackStartTime - totalPausedMs) / 1000;
      const total = getTotalDuration();
      const percent = total > 0 ? Math.min(100, (elapsed / total) * 100) : 0;

      progressFill.style.width = percent + '%';
      timeCurrent.textContent = formatTime(Math.max(0, elapsed));
      timeTotal.textContent = formatTime(Math.max(0, total));

      // Mirror to fullscreen view
      npProgressFill.style.width = percent + '%';
      npTimeCurrent.textContent = formatTime(Math.max(0, elapsed));
      npTimeTotal.textContent = formatTime(Math.max(0, total));
    }, 100);
  }

  // === UI helpers ===
  function showPlaybackInfo(player) {
    playbackNumber.textContent = '#' + player.number;
    playbackName.textContent = player.firstName + ' ' + player.lastName;
    playbackStatus.textContent = 'Playing';
    progressFill.style.width = '0%';
    timeCurrent.textContent = '0:00';
  }

  function highlightPlaying(number) {
    clearHighlights();
    document.querySelectorAll(`[data-number="${number}"]`).forEach(el => {
      el.classList.add('playing');
    });
  }

  function clearHighlights() {
    document.querySelectorAll('.playing').forEach(el => el.classList.remove('playing'));
  }

  // === Start ===
  init();
})();
