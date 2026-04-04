function injectCSS(file) {
    const link = document.createElement("link");
    link.href = chrome.runtime.getURL(file);
    link.type = "text/css";
    link.rel = "stylesheet";
    link.classList.add('yt-pro-injected-asset');
    document.head.appendChild(link);
}

function injectScript(file) {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL(file);
    script.classList.add('yt-pro-injected-asset');
    script.onload = function() { this.remove(); };
    (document.head || document.documentElement).appendChild(script);
}

let autoScrollInterval = null;

// ULTIMATE Shorts Auto-Scroller
function initAutoScroll() {
    if (autoScrollInterval) clearInterval(autoScrollInterval);
    autoScrollInterval = setInterval(() => {
        if (!window.location.pathname.includes('/shorts/')) return;

        const videos = Array.from(document.querySelectorAll('video'));
        const activeVideo = videos.find(v => !v.paused && v.readyState > 2);

        if (activeVideo) {
            activeVideo.loop = false;
            if (activeVideo.duration > 0 && (activeVideo.duration - activeVideo.currentTime) < 0.4) {
                const nextBtn = document.querySelector('#navigation-button-down ytd-button-renderer button') ||
                                document.querySelector('#navigation-button-down button') ||
                                document.querySelector('ytd-reel-video-renderer[is-active] #navigation-button-down button');

                if (nextBtn) {
                    activeVideo.currentTime = 0;
                    nextBtn.click();
                } else {
                    window.scrollBy({ top: window.innerHeight, behavior: 'smooth' });
                }
            }
        }
    }, 200);
}

// ─── Smart Download Button Override ──────────────────────────────────────────
// Intercepts YouTube's native download button (capture phase so we get it first)
// and redirects to vidssave.com with the current video URL pre-filled.

let downloadInterceptActive = false;

function initDownloadIntercept() {
    if (downloadInterceptActive) return;
    downloadInterceptActive = true;

    document.addEventListener('click', handleDownloadClick, true /* capture */);
}

function removeDownloadIntercept() {
    downloadInterceptActive = false;
    document.removeEventListener('click', handleDownloadClick, true);
}

function handleDownloadClick(e) {
    // Match every known YouTube download button variant
    const btn = e.target.closest([
        // Player bar download button
        '.ytp-download-button',
        // Below-video download button (Premium)
        'ytd-download-button-renderer button',
        'button[aria-label="Download video"]',
        'button[aria-label*="Download"]',
        // Generic fallback — any button whose visible text is exactly "Download"
        'yt-button-shape button',
    ].join(', '));

    if (!btn) return;

    // Extra guard: ignore buttons that are clearly not the download action
    // (e.g. "Download" in a settings menu item that says something else)
    const label = (btn.getAttribute('aria-label') || btn.innerText || '').toLowerCase();
    if (!label.includes('download')) return;

    e.preventDefault();
    e.stopImmediatePropagation();

    // Grab the cleanest possible video URL (strip playlist noise but keep ?v=)
    const videoUrl = getCleanVideoUrl();

    // Copy to clipboard as a bonus QoL action
    try {
        navigator.clipboard.writeText(videoUrl).catch(() => {});
    } catch (_) {}

    // Stash the URL in extension storage BEFORE opening the tab.
    // inject-download.js reads it from there — the ssvid.net URL stays
    // completely clean with no query params, so their bot-detection
    // won't redirect us to the Chrome Web Store.
    chrome.storage.local.set({
        ssvid_pending_url: videoUrl,
        ssvid_pending_ts:  Date.now()
    }, () => {
        window.open('https://ssvid.net/en-7', '_blank', 'noopener,noreferrer');
    });
}

function getCleanVideoUrl() {
    // Prefer the canonical ?v= param, strip tracking junk
    const url = new URL(window.location.href);
    const videoId = url.searchParams.get('v');
    if (videoId) {
        return `https://www.youtube.com/watch?v=${videoId}`;
    }
    // Shorts / live / embed — just return the pathname without extra params
    return `https://www.youtube.com${url.pathname}`;
}
// ─────────────────────────────────────────────────────────────────────────────

chrome.storage.local.get(['masterEnabled', 'theme', 'premium', 'ambient', 'speed', 'audio', 'autoscroll', 'download'], (result) => {
    if (result.masterEnabled === false) return;

    if (result.theme !== false) injectCSS('theme.css');

    if (result.premium !== false) document.body.classList.add('yt-pro-premium');
    if (result.ambient !== false) document.body.classList.add('yt-pro-ambient');

    if (result.speed !== false) injectScript('inject-speed.js');
    if (result.audio !== false) injectScript('inject-audio.js');
    if (result.autoscroll !== false) initAutoScroll();
    if (result.download !== false) initDownloadIntercept();
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'masterToggleChanged') {
        if (!request.state) {
            console.log("YouTube Pro + : Extension Disabled. Please refresh the page to fully revert changes.");
            document.body.classList.remove('yt-pro-premium', 'yt-pro-ambient');
            if (autoScrollInterval) clearInterval(autoScrollInterval);
            removeDownloadIntercept();
            document.querySelectorAll('link.yt-pro-injected-asset').forEach(el => el.remove());
        } else {
            location.reload();
        }
        return;
    }

    if (request.action === 'openAudioPanel') {
        const event = new KeyboardEvent('keydown', { key: 'q', altKey: true });
        document.dispatchEvent(event);
    } else if (request.action === 'togglepremium') {
        document.body.classList.toggle('yt-pro-premium', request.state);
    } else if (request.action === 'toggleambient') {
        document.body.classList.toggle('yt-pro-ambient', request.state);
    } else if (request.action === 'toggledownload') {
        if (request.state) {
            initDownloadIntercept();
        } else {
            removeDownloadIntercept();
        }
    }
});