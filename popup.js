document.addEventListener('DOMContentLoaded', () => {
    const toggles = ['theme', 'premium', 'ambient', 'speed', 'audio', 'autoscroll', 'download'];
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
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { action: 'masterToggleChanged', state: willBeEnabled });
                });
            });
        });

        // --- Setup Individual Toggles ---
        toggles.forEach(toggle => {
            const isEnabled = result[toggle] !== false; // Default true
            document.getElementById(`toggle-${toggle}`).checked = isEnabled;
        });

        // Show contextual hints based on initial state
        checkAudioHint(result.audio !== false);
        checkDownloadWarning(result.download !== false);
    });

    // --- Individual Toggle Listeners ---
    toggles.forEach(toggle => {
        document.getElementById(`toggle-${toggle}`).addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            chrome.storage.local.set({ [toggle]: isChecked });

            if (toggle === 'audio') checkAudioHint(isChecked);
            if (toggle === 'download') checkDownloadWarning(isChecked);

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
        document.getElementById('alt-q-hint').style.display = isAudioEnabled ? 'block' : 'none';
        document.getElementById('open-audio-ui').style.display = isAudioEnabled ? 'block' : 'none';
    }

    function checkDownloadWarning(isDownloadEnabled) {
        const warning = document.getElementById('download-premium-warning');
        if (!warning) return;
        warning.style.display = isDownloadEnabled ? 'flex' : 'none';
    }

    document.getElementById('open-audio-ui').addEventListener('click', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { action: 'openAudioPanel' });
        });
    });
});
