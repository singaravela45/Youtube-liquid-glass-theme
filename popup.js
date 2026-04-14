// ── Pause video when popup opens, resume when it closes ──────────────────────
(function () {
    function sendToActiveYouTubeTab(action) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs && tabs[0];
            if (!tab) return;
            const url = tab.url || '';
            if (!url.includes('youtube.com')) return;
            chrome.tabs.sendMessage(tab.id, { action }).catch?.(() => {});
        });
    }
    // Pause as soon as the popup DOM is ready
    document.addEventListener('DOMContentLoaded', () => sendToActiveYouTubeTab('popupOpened'), { once: true });
    // Resume when the popup window is about to close
    window.addEventListener('unload', () => sendToActiveYouTubeTab('popupClosed'), { once: true });
})();

document.addEventListener('DOMContentLoaded', () => {
    const toggles = ['theme', 'premium', 'ambient', 'speed', 'audio', 'autoscroll', 'download', 'fullscreen', 'autoResume'];
    const masterToggleBtn = document.getElementById('master-toggle');

    // ── Load all settings ───────────────────────────────────────────────────
    chrome.storage.local.get(['masterEnabled', ...toggles], (result) => {
        const isMasterEnabled = result.masterEnabled !== false;
        updateMasterUI(isMasterEnabled);

        masterToggleBtn.addEventListener('click', () => {
            const willBeEnabled = !masterToggleBtn.classList.contains('active');
            chrome.storage.local.set({ masterEnabled: willBeEnabled }, () => {
                updateMasterUI(willBeEnabled);
                chrome.runtime.sendMessage({ action: 'masterToggleChanged', state: willBeEnabled });
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { action: 'masterToggleChanged', state: willBeEnabled });
                });
            });
        });

        toggles.forEach(toggle => {
            const isEnabled = toggle === 'fullscreen'
                ? result[toggle] === true
                : result[toggle] !== false;
            document.getElementById(`toggle-${toggle}`).checked = isEnabled;
        });

        checkAudioHint(result.audio !== false);
        checkDownloadWarning(result.download !== false);
        checkFullscreenHint(result.fullscreen === true);

        if (result.audio !== false) refreshAudioStatus();
    });

    // ── Individual toggle listeners ─────────────────────────────────────────
    toggles.forEach(toggle => {
        document.getElementById(`toggle-${toggle}`).addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            chrome.storage.local.set({ [toggle]: isChecked });

            if (toggle === 'audio') {
                checkAudioHint(isChecked);
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { action: 'toggleaudio', state: isChecked });
                });
            }
            if (toggle === 'download') checkDownloadWarning(isChecked);
            if (toggle === 'fullscreen') {
                checkFullscreenHint(isChecked);
                chrome.runtime.sendMessage({ action: 'fullscreenToggleChanged', state: isChecked });
            }

            if (['premium', 'ambient', 'download', 'autoResume'].includes(toggle)) {
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { action: `toggle${toggle}`, state: isChecked });
                });
            }
        });
    });

    // ── Helpers ─────────────────────────────────────────────────────────────
    function updateMasterUI(isEnabled) {
        if (isEnabled) {
            masterToggleBtn.classList.add('active');
            document.body.classList.remove('disabled-mode');
        } else {
            masterToggleBtn.classList.remove('active');
            document.body.classList.add('disabled-mode');
        }
    }

    function checkAudioHint(isAudioEnabled) {
        document.getElementById('audio-hint').style.display = isAudioEnabled ? 'block' : 'none';
        document.getElementById('open-audio-ui').style.display = isAudioEnabled ? 'block' : 'none';
    }

    function checkDownloadWarning(isDownloadEnabled) {
        const warning = document.getElementById('download-premium-warning');
        if (warning) warning.style.display = isDownloadEnabled ? 'flex' : 'none';
    }

    function checkFullscreenHint(isFullscreenEnabled) {
        const hint = document.getElementById('fullscreen-hint');
        if (hint) hint.style.display = isFullscreenEnabled ? 'flex' : 'none';
    }

    function refreshAudioStatus() {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs[0]) return;
            chrome.tabs.sendMessage(tabs[0].id, { action: 'getStatus' }, (resp) => {
                if (chrome.runtime.lastError || !resp) return;
                const btn = document.getElementById('open-audio-ui');
                if (btn) btn.textContent = resp.visible ? '✕ Hide Audio Panel' : '🎛️ Open Audio Panel';
            });
        });
    }

    document.getElementById('open-audio-ui').addEventListener('click', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs[0]) return;
            chrome.tabs.sendMessage(tabs[0].id, { action: 'toggle' }, (resp) => {
                if (chrome.runtime.lastError || !resp) return;
                const btn = document.getElementById('open-audio-ui');
                if (btn) btn.textContent = resp.visible ? '✕ Hide Audio Panel' : '🎛️ Open Audio Panel';
            });
        });
    });

    // ── Watch History / Resume Panel ────────────────────────────────────────
    const resumePanel        = document.getElementById('resume-panel');
    const rpList             = document.getElementById('rp-list');
    const rpSearchInput      = document.getElementById('rp-search-input');
    const resumeSettingsPanel = document.getElementById('resume-settings-panel');
    const recapPanel         = document.getElementById('recap-panel');

    let allVideos = [];

    document.getElementById('open-resume-history').addEventListener('click', () => {
        resumePanel.classList.add('visible');
        loadResumeHistory();
    });

    document.getElementById('rp-close-btn').addEventListener('click', () => {
        resumePanel.classList.remove('visible');
    });

    document.getElementById('rp-settings-btn').addEventListener('click', () => {
        openResumeSettings();
    });

    document.getElementById('rp-recap-btn').addEventListener('click', () => {
        openRecapPanel();
    });

    rpSearchInput.addEventListener('input', () => {
        renderVideoList(rpSearchInput.value.trim().toLowerCase());
    });

    function loadResumeHistory() {
        chrome.storage.local.get(['ytProVideos', 'resumeSettings'], (data) => {
            const settings = data.resumeSettings || { deleteAfter: 730 };
            const now = Date.now();
            allVideos = (data.ytProVideos || []).filter(v => {
                if (!v.timestamp) return true;
                const daysDiff = Math.round((now - v.timestamp) / 86400000);
                return daysDiff <= (settings.deleteAfter || 730);
            }).reverse(); // Most recent first
            renderVideoList('');
        });
    }

    // ── Date grouping helper ──────────────────────────────────────────────
    function groupVideosByDate(videos) {
        const now   = Date.now();
        const todayStart     = new Date(); todayStart.setHours(0,0,0,0);
        const yesterdayStart = new Date(todayStart); yesterdayStart.setDate(todayStart.getDate() - 1);
        const weekStart      = new Date(todayStart); weekStart.setDate(todayStart.getDate() - 6);
        const monthStart     = new Date(todayStart); monthStart.setDate(todayStart.getDate() - 29);

        const groups = { 'Today': [], 'Yesterday': [], 'This Week': [], 'This Month': [], 'Older': [] };
        videos.forEach(v => {
            const ts = v.timestamp || 0;
            if      (ts >= todayStart.getTime())     groups['Today'].push(v);
            else if (ts >= yesterdayStart.getTime()) groups['Yesterday'].push(v);
            else if (ts >= weekStart.getTime())      groups['This Week'].push(v);
            else if (ts >= monthStart.getTime())     groups['This Month'].push(v);
            else                                     groups['Older'].push(v);
        });
        return groups;
    }

    function renderVideoList(query) {
        const filtered = query
            ? allVideos.filter(v =>
                (v.title || '').toLowerCase().includes(query) ||
                (v.channel || '').toLowerCase().includes(query))
            : allVideos;

        if (!filtered.length) {
            rpList.innerHTML = `
                <div class="rp-empty">
                    <span class="rp-empty-icon">📭</span>
                    ${query ? 'No results found.' : 'No watch history yet.<br>Start watching a YouTube video to build your history!'}
                </div>`;
            return;
        }

        rpList.innerHTML = '';

        if (query) {
            filtered.forEach(video => rpList.appendChild(buildVideoCard(video)));
        } else {
            const groups = groupVideosByDate(filtered);
            ['Today', 'Yesterday', 'This Week', 'This Month', 'Older'].forEach(groupName => {
                if (!groups[groupName].length) return;
                const hdr = document.createElement('div');
                hdr.className = 'rp-date-header';
                hdr.textContent = groupName;
                rpList.appendChild(hdr);
                groups[groupName].forEach(video => rpList.appendChild(buildVideoCard(video)));
            });
        }
    }

    function buildVideoCard(video) {
        const watchId    = extractWatchID(video.videolink);
        const thumbUrl   = `https://img.youtube.com/vi/${watchId}/mqdefault.jpg`;
        const progress   = video.duration > 0 ? Math.min(video.time / video.duration, 1) : 0;
        const timeStr    = formatTime(video.time);
        const durStr     = formatTime(video.duration);
        const isComplete = video.complete === true;

        const card = document.createElement('a');
        card.className   = 'rp-video-card';
        card.href        = video.videolink;
        card.target      = '_blank';
        card.title       = video.title || '';

        card.innerHTML = `
            <img class="rp-thumb" src="${thumbUrl}" alt="" loading="lazy">
            <div class="rp-info">
                <div class="rp-title">${escapeHtml(video.title || 'Untitled')}</div>
                <div class="rp-channel">${escapeHtml(video.channel || '')}</div>
                <div class="rp-time-row">
                    ${isComplete
                        ? `<span class="rp-complete-badge">✔ Completed</span>`
                        : `<span class="rp-time">${timeStr}</span>`
                    }
                    <span class="rp-duration">${durStr}</span>
                </div>
            </div>
            <button class="rp-delete-btn" data-id="${watchId}" title="Remove">✕</button>
            <div class="rp-progress-wrap">
                <div class="rp-progress-bar" style="width:${(progress * 100).toFixed(1)}%;${isComplete ? 'background:#4caf50;' : ''}"></div>
            </div>`;

        // Delete button
        card.querySelector('.rp-delete-btn').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            deleteVideo(watchId);
            card.remove();
            allVideos = allVideos.filter(v => extractWatchID(v.videolink) !== watchId);
            if (rpList.children.length === 0) renderVideoList('');
        });

        return card;
    }

    function deleteVideo(watchId) {
        chrome.storage.local.get('ytProVideos', (data) => {
            const videos = (data.ytProVideos || []).filter(v => extractWatchID(v.videolink) !== watchId);
            chrome.storage.local.set({ ytProVideos: videos });
        });
    }

    // ── Recap Panel ─────────────────────────────────────────────────────────
    function openRecapPanel() {
        chrome.storage.local.get('ytProVideos', (data) => {
            const videos = data.ytProVideos || [];

            // Top 5 videos by watchCount
            const topVideos = [...videos]
                .filter(v => v.title)
                .sort((a, b) => (b.watchCount || 1) - (a.watchCount || 1))
                .slice(0, 5);

            // Top 5 channels by distinct video count
            const channelMap = {};
            videos.forEach(v => {
                const ch = (v.channel || '').trim();
                if (!ch) return;
                if (!channelMap[ch]) channelMap[ch] = { count: 0, watchCount: 0 };
                channelMap[ch].count++;
                channelMap[ch].watchCount += (v.watchCount || 1);
            });
            const topChannels = Object.entries(channelMap)
                .sort((a, b) => b[1].watchCount - a[1].watchCount)
                .slice(0, 5);

            renderRecapPanel(topVideos, topChannels, videos.length);
        });
        recapPanel.classList.add('visible');
    }

    function renderRecapPanel(topVideos, topChannels, totalCount) {
        const videosEl   = document.getElementById('recap-videos-list');
        const channelsEl = document.getElementById('recap-channels-list');
        const totalEl    = document.getElementById('recap-total');

        if (totalEl) totalEl.textContent = `${totalCount} video${totalCount !== 1 ? 's' : ''} in your history`;

        // Render top videos
        if (!topVideos.length) {
            videosEl.innerHTML = '<div class="recap-empty">No data yet — start watching!</div>';
        } else {
            videosEl.innerHTML = '';
            topVideos.forEach((v, i) => {
                const watchId = extractWatchID(v.videolink);
                const thumb   = `https://img.youtube.com/vi/${watchId}/mqdefault.jpg`;
                const row     = document.createElement('a');
                row.className = 'recap-row';
                row.href      = v.videolink;
                row.target    = '_blank';
                row.innerHTML = `
                    <span class="recap-rank">#${i + 1}</span>
                    <img class="recap-thumb" src="${thumb}" alt="">
                    <div class="recap-info">
                        <div class="recap-title">${escapeHtml(v.title || 'Untitled')}</div>
                        <div class="recap-channel">${escapeHtml(v.channel || '')}</div>
                    </div>
                    <span class="recap-count">${v.watchCount || 1}×</span>`;
                videosEl.appendChild(row);
            });
        }

        // Render top channels
        if (!topChannels.length) {
            channelsEl.innerHTML = '<div class="recap-empty">No channels found yet.</div>';
        } else {
            channelsEl.innerHTML = '';
            topChannels.forEach(([ch, stats], i) => {
                const row = document.createElement('div');
                row.className = 'recap-channel-row';
                row.innerHTML = `
                    <span class="recap-rank">#${i + 1}</span>
                    <div class="recap-info">
                        <div class="recap-title">${escapeHtml(ch)}</div>
                        <div class="recap-channel">${stats.count} video${stats.count !== 1 ? 's' : ''} watched</div>
                    </div>
                    <span class="recap-count">${stats.watchCount}×</span>`;
                channelsEl.appendChild(row);
            });
        }
    }

    document.getElementById('recap-back-btn').addEventListener('click', () => {
        recapPanel.classList.remove('visible');
    });

    // ── Resume Settings Sub-panel ───────────────────────────────────────────
    function openResumeSettings() {
        chrome.storage.local.get('resumeSettings', (data) => {
            const s = data.resumeSettings || {
                pauseResume: false, minWatchTime: 60,
                minVideoLength: 120, markPlayedTime: 10, deleteAfter: 730
            };
            document.getElementById('rsp-pause-toggle').checked = !s.pauseResume;
            document.getElementById('rsp-min-length').value     = Math.round(s.minVideoLength / 60);
            document.getElementById('rsp-min-watch').value      = Math.round(s.minWatchTime / 60);
            document.getElementById('rsp-mark-played').value    = s.markPlayedTime;   // seconds, not minutes
            document.getElementById('rsp-delete-after').value   = s.deleteAfter || 730;
        });
        resumeSettingsPanel.classList.add('visible');
        document.getElementById('rsp-saved-msg').classList.remove('show');
    }

    document.getElementById('rsp-back-btn').addEventListener('click', () => {
        resumeSettingsPanel.classList.remove('visible');
    });

    document.getElementById('rsp-save-btn').addEventListener('click', () => {
        const newSettings = {
            pauseResume:    !document.getElementById('rsp-pause-toggle').checked,
            minVideoLength: parseInt(document.getElementById('rsp-min-length').value || 2) * 60,
            minWatchTime:   parseInt(document.getElementById('rsp-min-watch').value  || 1) * 60,
            markPlayedTime: parseInt(document.getElementById('rsp-mark-played').value || 10), // already in seconds
            deleteAfter:    parseInt(document.getElementById('rsp-delete-after').value || 730)
        };
        chrome.storage.local.set({ resumeSettings: newSettings }, () => {
            const msg = document.getElementById('rsp-saved-msg');
            msg.classList.add('show');
            setTimeout(() => msg.classList.remove('show'), 2000);
        });
    });

    // ── Utility functions ───────────────────────────────────────────────────
    function extractWatchID(link) {
        if (!link) return '';
        const start = link.indexOf('v=') + 2;
        const end   = link.indexOf('&', start);
        return end === -1 ? link.slice(start) : link.slice(start, end);
    }

    function formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        const s = Math.floor(seconds);
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        const pad = n => n < 10 ? '0' + n : '' + n;
        return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
    }

    function escapeHtml(str) {
        return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
});
