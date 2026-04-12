document.addEventListener('DOMContentLoaded', () => {
    const toggles = ['theme', 'premium', 'ambient', 'speed', 'audio', 'autoscroll', 'download', 'fullscreen'];
    const masterToggleBtn = document.getElementById('master-toggle');

    // Retrieve ALL statuses including master switch and new download toggle
    chrome.storage.local.get(['masterEnabled', ...toggles], (result) => {

        // --- Setup Master Toggle ---
        const isMasterEnabled = result.masterEnabled !== false; // Default true
        updateMasterUI(isMasterEnabled);

        masterToggleBtn.addEventListener('click', () => {
            const willBeEnabled = !masterToggleBtn.classList.contains('active');
            chrome.storage.local.set({ masterEnabled: willBeEnabled }, () => {
                updateMasterUI(willBeEnabled);
                // Notify background worker (handles fullscreen exit)
                chrome.runtime.sendMessage({ action: 'masterToggleChanged', state: willBeEnabled });
                // Notify the active tab's content scripts
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { action: 'masterToggleChanged', state: willBeEnabled });
                });
            });
        });

        // --- Setup Individual Toggles ---
        toggles.forEach(toggle => {
            // fullscreen defaults OFF, all others default ON
            const isEnabled = toggle === 'fullscreen' ? result[toggle] === true : result[toggle] !== false;
            document.getElementById(`toggle-${toggle}`).checked = isEnabled;
        });

        // Show contextual hints based on initial state
        checkAudioHint(result.audio !== false);
        checkDownloadWarning(result.download !== false);
        checkFullscreenHint(result.fullscreen === true);

        // Poll music enhancer status if audio is enabled
        if (result.audio !== false) {
            refreshAudioStatus();
        }
    });

    // --- Individual Toggle Listeners ---
    toggles.forEach(toggle => {
        document.getElementById(`toggle-${toggle}`).addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            chrome.storage.local.set({ [toggle]: isChecked });

            if (toggle === 'audio') {
                checkAudioHint(isChecked);
                // Notify music-enhancer.js of the audio toggle change
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { action: 'toggleaudio', state: isChecked });
                });
            }
            if (toggle === 'download') checkDownloadWarning(isChecked);
            if (toggle === 'fullscreen') {
                checkFullscreenHint(isChecked);
                chrome.runtime.sendMessage({ action: 'fullscreenToggleChanged', state: isChecked });
            }

            // Send live updates to the tab for toggles that can be applied without a reload
            if (['premium', 'ambient', 'download'].includes(toggle)) {
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { action: `toggle${toggle}`, state: isChecked });
                });
            }
        });
    });

    // --- Helpers ---
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
        if (!warning) return;
        warning.style.display = isDownloadEnabled ? 'flex' : 'none';
    }

    function checkFullscreenHint(isFullscreenEnabled) {
        const hint = document.getElementById('fullscreen-hint');
        if (!hint) return;
        hint.style.display = isFullscreenEnabled ? 'flex' : 'none';
    }

    // --- Music Enhancer status + toggle ---
    function refreshAudioStatus() {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs[0]) return;
            chrome.tabs.sendMessage(tabs[0].id, { action: 'getStatus' }, (resp) => {
                if (chrome.runtime.lastError || !resp) return;
                const btn = document.getElementById('open-audio-ui');
                if (!btn) return;
                if (resp.connected) {
                    btn.textContent = resp.visible ? '✕ Hide Audio Panel' : '🎛️ Open Audio Panel';
                } else {
                    btn.textContent = resp.visible ? '✕ Hide Audio Panel' : '🎛️ Open Audio Panel';
                }
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
});
