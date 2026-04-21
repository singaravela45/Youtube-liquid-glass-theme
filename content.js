// ─── Extension context guard ─────────────────────────────────────────────────
// Prevents "Extension context invalidated" crashes when the extension is
// reloaded/updated while a YouTube tab is still open with the old script.
function isCtxValid() {
    try { return !!chrome.runtime?.id; } catch(e) { return false; }
}

// ─── YT Pro Plus: Asset Injectors ────────────────────────────────────────────
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

// Always block the interruption toast, regardless of master toggle
injectCSS('block-popups.css');
// Always inject premium logo + ambient styles so they work independently of the theme toggle
injectCSS('features.css');

// ─── Shorts Auto-Scroller ─────────────────────────────────────────────────────
let autoScrollInterval = null;

function getShortsActiveVideo() {
    // Prefer the video inside the active reel renderer — avoids picking up
    // lingering regular-video elements left in the DOM during SPA transitions.
    const activeRenderer = document.querySelector('ytd-reel-video-renderer[is-active]');
    if (activeRenderer) {
        const v = activeRenderer.querySelector('video');
        if (v && v.readyState > 2) return v;
    }
    // Fallback: any playing video while on a shorts URL
    return Array.from(document.querySelectorAll('video'))
        .find(v => !v.paused && v.readyState > 2) || null;
}

function forceDisableLoop(video) {
    if (!video || !video.loop) return;
    video.loop = false;
}

function initAutoScroll() {
    if (autoScrollInterval) clearInterval(autoScrollInterval);

    // ── When YouTube SPA-navigates TO a shorts page, immediately seize the
    // video and kill loop — before YouTube's own init can re-enable it.
    document.addEventListener('yt-navigate-finish', () => {
        if (!window.location.pathname.includes('/shorts/')) return;

        // Try immediately, then retry a few times to win the race against
        // YouTube's late loop-setter that runs after yt-navigate-finish.
        [0, 100, 300, 600, 1000].forEach(delay => {
            setTimeout(() => {
                const v = getShortsActiveVideo() ||
                    document.querySelector('ytd-reel-video-renderer[is-active] video') ||
                    document.querySelector('ytd-shorts video');
                if (v) forceDisableLoop(v);
            }, delay);
        });
    });

    autoScrollInterval = setInterval(() => {
        if (!window.location.pathname.includes('/shorts/')) return;

        const activeVideo = getShortsActiveVideo();
        if (!activeVideo) return;

        forceDisableLoop(activeVideo);

        if (activeVideo.duration > 0 && (activeVideo.duration - activeVideo.currentTime) < 0.4) {
            const nextBtn =
                document.querySelector('ytd-reel-video-renderer[is-active] #navigation-button-down button') ||
                document.querySelector('#navigation-button-down ytd-button-renderer button') ||
                document.querySelector('#navigation-button-down button');

            if (nextBtn) {
                activeVideo.currentTime = 0;
                nextBtn.click();
            } else {
                window.scrollBy({ top: window.innerHeight, behavior: 'smooth' });
            }
        }
    }, 200);
}

// ─── Smart Download Button Override ──────────────────────────────────────────
let downloadInterceptActive = false;

function initDownloadIntercept() {
    if (downloadInterceptActive) return;
    downloadInterceptActive = true;
    document.addEventListener('click', handleDownloadClick, true);
}

function removeDownloadIntercept() {
    downloadInterceptActive = false;
    document.removeEventListener('click', handleDownloadClick, true);
}

function handleDownloadClick(e) {
    const btn = e.target.closest([
        '.ytp-download-button',
        'ytd-download-button-renderer button',
        'button[aria-label="Download video"]',
        'button[aria-label*="Download"]',
        'yt-button-shape button',
    ].join(', '));

    if (!btn) return;

    const label = (btn.getAttribute('aria-label') || btn.innerText || '').toLowerCase();
    if (!label.includes('download')) return;

    e.preventDefault();
    e.stopImmediatePropagation();

    const videoUrl = getCleanVideoUrl();

    try {
        navigator.clipboard.writeText(videoUrl).catch(() => {});
    } catch (_) {}

    chrome.storage.local.set({
        ssvid_pending_url: videoUrl,
        ssvid_pending_ts:  Date.now()
    }, () => {
        window.open('https://vidssave.com/en/yt', '_blank', 'noopener,noreferrer');
    });
}

function getCleanVideoUrl() {
    const url = new URL(window.location.href);
    const videoId = url.searchParams.get('v');
    if (videoId) {
        return `https://www.youtube.com/watch?v=${videoId}`;
    }
    return `https://www.youtube.com${url.pathname}`;
}

// ─── Resume Duration Badge on Thumbnails ─────────────────────────────────────
let badgeVideoData = {};
let badgeObserverActive = false;

function extractWatchIDForBadge(link) {
    if (!link) return null;
    const m = link.match(/[?&]v=([^&#]+)/);
    return m ? m[1] : null;
}

function formatTimeForBadge(sec) {
    if (!sec || isNaN(sec) || sec < 5) return null;
    const s = Math.floor(sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    const pad = n => n < 10 ? '0' + n : '' + n;
    return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
}

// ── Thumbnail targets: covers every surface YouTube renders thumbnails on ──────
const THUMB_LINK_SELECTORS = [
    // Standard watch page / homepage / search
    'ytd-thumbnail a#thumbnail[href]',
    // Playlist panel (the queue panel shown in screenshot)
    'ytd-playlist-panel-video-renderer a#thumbnail[href]',
    // Mini playlist / mix panel items
    'ytd-compact-video-renderer a#thumbnail[href]',
    // Related / sidebar
    'ytd-compact-radio-renderer a#thumbnail[href]',
    // Channel page grid
    'ytd-grid-video-renderer a#thumbnail[href]',
    // Search results
    'ytd-video-renderer a#thumbnail[href]',
    // Shorts shelf items
    'ytd-reel-item-renderer a#thumbnail[href]',
    // Watch later / saved playlists
    'ytd-playlist-video-renderer a#thumbnail[href]',
].join(', ');

function getThumbContainer(thumbLink) {
    // Walk up to find the real image host (ytd-thumbnail or the link itself)
    return (
        thumbLink.querySelector('ytd-animated-thumbnail') ||
        thumbLink.querySelector('#img') ||
        thumbLink.querySelector('yt-image') ||
        thumbLink.querySelector('img') ||
        thumbLink
    );
}

function injectBadgesOnPage() {
    if (!Object.keys(badgeVideoData).length) return;

    document.querySelectorAll(THUMB_LINK_SELECTORS).forEach(thumb => {
        const href    = thumb.getAttribute('href') || '';
        const fullUrl = href.startsWith('http') ? href : 'https://www.youtube.com' + href;
        const videoId = extractWatchIDForBadge(fullUrl);
        if (!videoId) return;

        const stored = badgeVideoData[videoId];
        if (!stored || stored.doNotResume) return;

        const pct      = stored.duration > 0 ? Math.min(stored.time / stored.duration, 1) : 0;
        const timeStr  = formatTimeForBadge(stored.time);
        if (pct < 0.01 || !timeStr) return;   // skip if barely watched

        const container = getThumbContainer(thumb);
        container.style.position = 'relative';

        // ── 1. Progress bar at the very bottom (like YouTube's red line) ─────
        let bar = container.querySelector('.yt-pro-pbar-wrap');
        if (!bar) {
            bar = document.createElement('div');
            bar.className = 'yt-pro-pbar-wrap';
            bar.style.cssText = [
                'position:absolute', 'bottom:0', 'left:0', 'right:0',
                'height:5px',                          // bolder than before (was 3px)
                'background:rgba(255,255,255,0.12)',
                'pointer-events:none', 'z-index:200',  // higher z-index to sit above YT bar
                'border-radius:0 0 2px 2px'
            ].join(';');
            const fill = document.createElement('div');
            fill.className = 'yt-pro-pbar-fill';
            fill.style.cssText = [
                'height:100%', 'background:#00d2ff',
                'border-radius:0 0 0 2px', 'transition:width 0.4s ease',
                'box-shadow:0 0 4px rgba(0,210,255,0.6)'   // subtle glow so it pops
            ].join(';');
            bar.appendChild(fill);
            container.appendChild(bar);
        }
        // Always update width so it refreshes as you watch
        bar.querySelector('.yt-pro-pbar-fill').style.width = (pct * 100).toFixed(2) + '%';

        // ── 2. Time badge (bottom-left corner) ───────────────────────────────
        let badge = container.querySelector('.yt-pro-resume-badge');
        if (!badge) {
            badge = document.createElement('div');
            badge.className = 'yt-pro-resume-badge';
            badge.style.cssText = [
                'position:absolute', 'bottom:6px', 'left:4px',
                'background:rgba(0,0,0,0.82)', 'color:#00d2ff',
                'font-size:10px', 'font-weight:700', 'padding:2px 6px',
                'border-radius:3px', 'pointer-events:none',
                'font-family:Roboto,Arial,sans-serif', 'letter-spacing:0.3px',
                'border:1px solid rgba(0,210,255,0.45)', 'z-index:102',
                'line-height:14px'
            ].join(';');
            container.appendChild(badge);
        }
        badge.textContent = '▶ ' + timeStr;
    });
}

function loadBadgeData(cb) {
    if (!isCtxValid()) return;
    chrome.storage.local.get('ytProVideos', (data) => {
        badgeVideoData = {};
        (data.ytProVideos || []).forEach(v => {
            const id = extractWatchIDForBadge(v.videolink);
            if (id) badgeVideoData[id] = v;
        });
        injectBadgesOnPage();
        if (cb) cb();
    });
}

function initBadgeInjection() {
    // Suppress YouTube's native red resume-playback bar so only our blue one shows
    if (!document.getElementById('yt-pro-hide-native-bar')) {
        const style = document.createElement('style');
        style.id = 'yt-pro-hide-native-bar';
        style.textContent = `
            ytd-thumbnail-overlay-resume-playback-renderer,
            ytd-thumbnail-overlay-resume-playback-renderer * {
                display: none !important;
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    loadBadgeData();
    if (!badgeObserverActive) {
        badgeObserverActive = true;
        let badgeTimer = null;
        new MutationObserver(() => {
            clearTimeout(badgeTimer);
            badgeTimer = setTimeout(injectBadgesOnPage, 250);
        }).observe(document.body, { childList: true, subtree: true });
        // Refresh stored data every 5 s so progress bars stay in sync while watching
        setInterval(() => loadBadgeData(), 5000);
    }
}

// ─── Auto Resume Feature ──────────────────────────────────────────────────────
const RESUME_CHANNEL_SELECTOR = "ytd-video-owner-renderer ytd-channel-name a";
const RESUME_ICON_ACTIVE   = chrome.runtime.getURL("imgs/playericon.svg");
const RESUME_ICON_INACTIVE = chrome.runtime.getURL("imgs/playericon_inactive.svg");

let resumeInitialLinkIsVideo = false;
let resumeNavLoop = false;
let resumeUserSettings = {};
let resumeBlacklist = false;
let resumeActive = false;
let resumeTimeUpdateAbort = null; // AbortController for timeupdate listener cleanup
const sessionTrackedVideos = new Set(); // DEPRECATED — kept to avoid reference errors, no longer used
let currentNavVideoId      = null;  // video ID active in the current navigation
let currentNavIncremented  = false; // whether watchCount was already incremented this navigation

class YTProAutoResume {
    constructor() {
        window.addEventListener('load', this.initialize.bind(this));
    }

    async initialize() {
        await this.initStorage();
        resumeUserSettings = await this.getUserSettings();

        // Check master enable + feature toggle
        const result = await new Promise(r => chrome.storage.local.get(['masterEnabled', 'autoResume'], r));
        if (result.masterEnabled === false) return;
        if (result.autoResume === false) return;

        resumeActive = true;
        this.start();
    }

    start() {
        if (resumeUserSettings.pauseResume) return;

        resumeInitialLinkIsVideo = this.checkWatchable(window.location.href);
        if (resumeInitialLinkIsVideo) this.injectPlayerButton();

        this.setupEventListeners();

        if (resumeInitialLinkIsVideo && !resumeNavLoop) {
            this.runMainVideoProcess();
        }
    }

    setupEventListeners() {
        document.addEventListener('yt-navigate-finish', async () => {
            // ── Kill the previous timeupdate listener IMMEDIATELY on navigation ──
            // Without this, the old listener fires with the old video's currentTime
            // but the new URL, causing the new video to be saved with a wrong timestamp.
            if (resumeTimeUpdateAbort) {
                resumeTimeUpdateAbort.abort();
                resumeTimeUpdateAbort = null;
            }

            // Reset per-navigation watch-count tracking so the new video
            // (or a revisited video) gets its count incremented fresh.
            currentNavVideoId     = null;
            currentNavIncremented = false;

            if (resumeInitialLinkIsVideo) {
                resumeInitialLinkIsVideo = false;
                await this.resetButton();
                this.runMainVideoProcess();
            } else {
                await this.resetButton();
                this.runMainVideoProcess();
                resumeNavLoop = true;
            }
        });
        window.addEventListener('yt-pro-title-change', this.handleTitleChange.bind(this));
    }

    handleTitleChange(event) {
        this.runMainVideoProcess(event.detail.title);
    }

    dispatchTitleChangeEvent(newTitle) {
        window.dispatchEvent(new CustomEvent('yt-pro-title-change', { detail: { title: newTitle } }));
    }

    async injectPlayerButton() {
        const blacklisted = await this.checkBlacklist(window.location.href);
        const imgSrc   = blacklisted ? RESUME_ICON_INACTIVE : RESUME_ICON_ACTIVE;
        const tooltip  = blacklisted ? "Video will not auto-resume" : "Video will auto-resume";
        const button   = this.createPlayerButton(imgSrc, tooltip);
        document.querySelector("div.ytp-right-controls")?.prepend(button);
    }

    createPlayerButton(imgSrc, tooltip) {
        const button = document.createElement("div");
        button.classList.add("ytp-button", "yt-pro-resume-btn");
        button.id    = "yt-pro-resume-switch";
        button.title = tooltip;
        button.ariaLabel = tooltip;
        button.style.verticalAlign = "top";
        button.onclick = this.onPlayerButtonClick.bind(this);

        const img    = document.createElement("img");
        img.id       = "yt-pro-resume-icon";
        img.src      = imgSrc;
        img.style.height  = "90%";
        img.style.display = "block";
        img.style.margin  = "auto";
        button.appendChild(img);
        return button;
    }

    async onPlayerButtonClick() {
        await this.grabTitle();
        const video     = document.querySelector("video");
        const markPlayed = video.duration - video.currentTime < resumeUserSettings.markPlayedTime;
        resumeBlacklist  = document.querySelector("#yt-pro-resume-switch").checked;
        this.togglePlayerButtonState(resumeBlacklist, markPlayed, video);
    }

    async togglePlayerButtonState(blacklist, markPlayed, video) {
        const switchIcon = document.querySelector("#yt-pro-resume-icon");
        const switchBtn  = document.querySelector("#yt-pro-resume-switch");

        switchIcon.src   = blacklist ? RESUME_ICON_INACTIVE : RESUME_ICON_ACTIVE;
        switchBtn.title  = blacklist ? "Video will not auto-resume" : "Video will auto-resume";
        switchBtn.checked = !blacklist;

        await this.setTime({
            videolink: window.location.href,
            time:      video.currentTime,
            duration:  video.duration,
            title:     document.querySelector("h1.title.style-scope.ytd-video-primary-info-renderer")?.textContent || document.title,
            channel:   document.querySelector(RESUME_CHANNEL_SELECTOR)?.textContent || "",
            complete:  markPlayed,
            doNotResume: blacklist,
            timestamp: Date.now()
        });
    }

    async resetButton() {
        const button = document.querySelector("#yt-pro-resume-switch");
        if (button) {
            const blacklisted = await this.checkBlacklist(window.location.href);
            const imgSrc  = blacklisted ? RESUME_ICON_INACTIVE : RESUME_ICON_ACTIVE;
            const tooltip = blacklisted ? "Video will not auto-resume" : "Video will auto-resume";
            button.title     = tooltip;
            button.ariaLabel = tooltip;
            button.checked   = !blacklisted;
            document.querySelector("#yt-pro-resume-icon").src = imgSrc;
        } else {
            await this.injectPlayerButton();
        }
    }

    getUserSettings() {
        return new Promise(resolve => {
            chrome.storage.local.get("resumeSettings", data => {
                resolve(data.resumeSettings || {
                    pauseResume: false,
                    minWatchTime: 60,
                    minVideoLength: 120,
                    markPlayedTime: 10,
                    deleteAfter: 0
                });
            });
        });
    }

    initStorage() {
        return Promise.all([this.initDB(), this.initSettings()]);
    }

    initDB() {
        return new Promise(resolve => {
            chrome.storage.local.getBytesInUse("ytProVideos", bytes => {
                if (bytes === 0 || bytes === undefined) {
                    chrome.storage.local.set({ ytProVideos: [] }, resolve);
                } else {
                    resolve();
                }
            });
        });
    }

    initSettings() {
        return new Promise(resolve => {
            chrome.storage.local.getBytesInUse("resumeSettings", bytes => {
                if (bytes === 0 || bytes === undefined) {
                    chrome.storage.local.set({
                        resumeSettings: {
                            pauseResume: false,
                            minWatchTime: 60,
                            minVideoLength: 120,
                            markPlayedTime: 10,
                            deleteAfter: 0
                        }
                    }, resolve);
                } else {
                    resolve();
                }
            });
        });
    }

    extractWatchID(link) {
        if (!link) return '';
        const m = link.match(/[?&]v=([^&#]+)/);
        return m ? m[1] : '';
    }

    grabTitle() {
        return new Promise(resolve => {
            let el = document.querySelector("h1.title.style-scope.ytd-video-primary-info-renderer");
            if (el) return resolve(el.textContent);
            const interval = setInterval(() => {
                el = document.querySelector("h1.title.style-scope.ytd-video-primary-info-renderer");
                if (el) { clearInterval(interval); resolve(el.textContent); }
            }, 2000);
        });
    }

    checkWatchable(link) {
        return link.includes("watch?") && !link.includes("?t=");
    }

    checkBlacklist(link) {
        return new Promise(resolve => {
            chrome.storage.local.get("ytProVideos", data => {
                const bl = (data.ytProVideos || []).some(v =>
                    this.extractWatchID(v.videolink) === this.extractWatchID(link) && v.doNotResume
                );
                resolve(bl);
            });
        });
    }

    setTime(video, incrementCount = false) {
        return new Promise(resolve => {
            chrome.storage.local.get("ytProVideos", data => {
                const existing = (data.ytProVideos || []).find(v =>
                    this.extractWatchID(v.videolink) === this.extractWatchID(video.videolink)
                );

                const currentCount = existing?.watchCount ?? 0;
                const watchCount = incrementCount ? currentCount + 1 : currentCount;

                const videos = (data.ytProVideos || []).filter(v =>
                    this.extractWatchID(v.videolink) !== this.extractWatchID(video.videolink)
                );
                videos.push({ ...video, watchCount });
                chrome.storage.local.set({ ytProVideos: videos }, () => {
                    // Immediately refresh badge/progress data so in-page bars stay current
                    loadBadgeData();
                    resolve();
                });
            });
        });
    }

    async runMainVideoProcess(newTitle = null) {
        await this.mainVideoProcess(newTitle);
        resumeNavLoop = true;
    }

    async mainVideoProcess(newTitle = null) {
        return new Promise(async resolve => {
            if (!this.checkWatchable(window.location.href)) {
                resolve();
                return;
            }
            const durationOk = await this.checkDuration();
            if (!durationOk) {
                resolve();
                return;
            }

            const videoTitle = newTitle || await this.grabTitle();
            if (!resumeInitialLinkIsVideo && !resumeNavLoop) { resolve(); return; }

            try {
                const storedVideo = await this.checkStoredLinks(window.location.href);
                if (storedVideo.time > resumeUserSettings.minWatchTime &&
                    !storedVideo.complete && !storedVideo.doNotResume) {
                    document.querySelector("video").currentTime = storedVideo.time;
                }
                resumeBlacklist = storedVideo.doNotResume;
            } catch {
                resumeBlacklist = false;
            }

            this.monitorVideoTime(resolve);
        });
    }

    checkDuration() {
        return new Promise(resolve => {
            const video = document.querySelector("video");
            if (!video) return resolve(false);

            // Duration already available
            if (video.duration && !isNaN(video.duration) && video.duration > 0) {
                return resolve(video.duration >= resumeUserSettings.minVideoLength);
            }

            // Wait for metadata to load (max 8 seconds)
            const timeout = setTimeout(() => {
                video.removeEventListener('loadedmetadata', onMeta);
                video.removeEventListener('durationchange', onMeta);
                resolve(false);
            }, 8000);

            function onMeta() {
                if (!video.duration || isNaN(video.duration) || video.duration <= 0) return;
                clearTimeout(timeout);
                video.removeEventListener('loadedmetadata', onMeta);
                video.removeEventListener('durationchange', onMeta);
                resolve(video.duration >= resumeUserSettings.minVideoLength);
            }

            video.addEventListener('loadedmetadata', onMeta);
            video.addEventListener('durationchange', onMeta);
        });
    }

    checkStoredLinks(link) {
        return new Promise((resolve, reject) => {
            chrome.storage.local.get("ytProVideos", data => {
                const found = (data.ytProVideos || []).find(v =>
                    this.extractWatchID(v.videolink) === this.extractWatchID(link)
                );
                if (found) {
                    if (found.timestamp && resumeUserSettings.deleteAfter && this.daysSince(found.timestamp) > resumeUserSettings.deleteAfter) {
                        this.deleteVideo(found).then(() => reject(-1));
                    } else {
                        resolve(found);
                    }
                } else {
                    reject(-1);
                }
            });
        });
    }

    deleteVideo(video) {
        return new Promise(resolve => {
            chrome.storage.local.get("ytProVideos", data => {
                const videos = (data.ytProVideos || []).filter(v =>
                    this.extractWatchID(v.videolink) !== this.extractWatchID(video.videolink)
                );
                chrome.storage.local.set({ ytProVideos: videos }, resolve);
            });
        });
    }

    daysSince(time1) {
        return Math.round((Date.now() - time1) / 86400000);
    }

    monitorVideoTime(resolve) {
        const video = document.querySelector("video");
        if (!video) return resolve();

        // Cancel any previous timeupdate listener to prevent stacking duplicates
        if (resumeTimeUpdateAbort) resumeTimeUpdateAbort.abort();
        resumeTimeUpdateAbort = new AbortController();
        const signal = resumeTimeUpdateAbort.signal;

        // ── Capture the video ID NOW so the listener can self-validate ──────
        // If YouTube navigates away mid-playback the URL changes before the
        // listener is aborted; this guard stops it saving stale data.
        const guardedVideoId = this.extractWatchID(window.location.href);

        // Support both old and new YouTube title DOM structures
        const getTitleEl = () =>
            document.querySelector("h1.ytd-watch-metadata yt-formatted-string") ||
            document.querySelector("ytd-watch-metadata h1 yt-formatted-string") ||
            document.querySelector("h1.title.style-scope.ytd-video-primary-info-renderer") ||
            document.querySelector("h1[class*='title']");

        let lastTitle = getTitleEl()?.textContent?.trim() || "";

        video.addEventListener('timeupdate', () => {
            // ── Guard: bail out if the page has already moved to a new video ──
            if (this.extractWatchID(window.location.href) !== guardedVideoId) return;

            // Small grace period: skip the very first instant (avoids saving 0.0s)
            if (video.currentTime < 3) return;

            const currentTitle = getTitleEl()?.textContent?.trim() || "";

            if (currentTitle && currentTitle !== lastTitle) {
                lastTitle = currentTitle;
                this.dispatchTitleChangeEvent(currentTitle);
            }

            if (!resumeBlacklist) {
                // ── Smart complete detection ──────────────────────────────────
                // Default markPlayedTime (120s) is too aggressive for short music videos
                // (a 3:41 song would be "complete" after watching past 1:41).
                // Use 10% of video duration as the minimum threshold so short videos
                // only count as complete when within the last ~20 seconds.
                const completionWindow = Math.min(
                    resumeUserSettings.markPlayedTime || 10,
                    video.duration * 0.10
                );
                const markPlayed = (video.duration - video.currentTime) < completionWindow;

                const videoId = guardedVideoId;

                // ── Per-navigation watch-count increment ──────────────────────
                // Reset tracking whenever we're looking at a different video ID
                // (handles title-change re-calls of monitorVideoTime for same video).
                if (videoId !== currentNavVideoId) {
                    currentNavVideoId     = videoId;
                    currentNavIncremented = false;
                }

                const pastMinWatch    = video.currentTime >= (resumeUserSettings.minWatchTime || 60);
                const shouldIncrement = pastMinWatch && !currentNavIncremented;
                if (shouldIncrement) currentNavIncremented = true;

                this.setTime({
                    videolink:   window.location.href,
                    time:        video.currentTime,
                    duration:    video.duration,
                    title:       currentTitle || document.title,
                    channel:     document.querySelector(RESUME_CHANNEL_SELECTOR)?.textContent?.trim() || "",
                    complete:    markPlayed,
                    doNotResume: false,
                    timestamp:   Date.now()
                }, shouldIncrement);
            }
        }, { signal });
    }
}

// ─── Initialise everything ────────────────────────────────────────────────────
// ─── Masthead Glass Guard ─────────────────────────────────────────────────────
// YouTube sets the masthead background via requestAnimationFrame on every scroll
// tick, so MutationObserver alone always loses the last-frame race.
// We fight back with our OWN rAF loop running at the same cadence — every frame
// we force the exact glass styles, so the browser never paints the black state.
let _mastheadRAFId   = null;
let _mastheadActive  = false;

const GLASS_SF     = '#00000022';
const GLASS_BLUR   = '10px';
const GLASS_SHADOW = '0 4px 24px #00000030, 2px 2px 1px #ffffff20 inset, -2px -2px 1px #ffffff10 inset';

function _enforceGlass() {
    // ── ALL CSS variables YouTube uses for masthead background ──────────────
    // YouTube has added new variables on the watch page — cover every known one.
    const VARS = [
        '--yt-masthead-background-color',
        '--ytd-masthead-color',
        '--yt-masthead-custom-background-color',
        '--ytd-masthead-background',
        '--yt-spec-base-background',
        '--yt-masthead-scrolled-background-color',
    ];

    // ── Clear variables on EVERY ancestor YouTube might target ───────────────
    // On the watch page YouTube now also sets vars on ytd-watch-flexy, body, html
    [
        document.documentElement,
        document.body,
        document.querySelector('ytd-app'),
        document.querySelector('ytd-watch-flexy'),
        document.querySelector('ytd-page-manager'),
    ].forEach(el => {
        if (!el) return;
        VARS.forEach(v => el.style.setProperty(v, 'transparent', 'important'));
    });

    // ── Enforce on the masthead elements directly ────────────────────────────
    const outer     = document.getElementById('masthead-container');
    const mast      = document.querySelector('ytd-masthead');
    // Exact inner Polymer element YouTube targets on the watch page
    // (found via uBlock Origin: #masthead > .ytd-masthead.style-scope)
    const mastInner = document.querySelector('#masthead > .ytd-masthead.style-scope')
                   || document.querySelector('#masthead > ytd-masthead');
    const pill      = document.querySelector('ytd-masthead #container');

    if (outer) {
        outer.style.setProperty('background',       'transparent', 'important');
        outer.style.setProperty('background-color', 'transparent', 'important');
        outer.style.setProperty('box-shadow',       'none',        'important');
        VARS.forEach(v => outer.style.setProperty(v, 'transparent', 'important'));
    }
    if (mast) {
        mast.style.setProperty('background',       'transparent', 'important');
        mast.style.setProperty('background-color', 'transparent', 'important');
        mast.style.setProperty('box-shadow',       'none',        'important');
        VARS.forEach(v => mast.style.setProperty(v, 'transparent', 'important'));
    }
    // Force the inner Polymer-scoped element — this is where YouTube writes
    // the solid background on the watch page, overriding everything else
    if (mastInner) {
        mastInner.style.setProperty('background',       'transparent', 'important');
        mastInner.style.setProperty('background-color', 'transparent', 'important');
        mastInner.style.setProperty('box-shadow',       'none',        'important');
        VARS.forEach(v => mastInner.style.setProperty(v, 'transparent', 'important'));
    }
    if (pill) {
        pill.style.setProperty('background',              GLASS_SF,              'important');
        pill.style.setProperty('background-color',        GLASS_SF,              'important');
        pill.style.setProperty('backdrop-filter',         `blur(${GLASS_BLUR})`, 'important');
        pill.style.setProperty('-webkit-backdrop-filter', `blur(${GLASS_BLUR})`, 'important');
        pill.style.setProperty('border-radius',           '3000px',              'important');
        pill.style.setProperty('box-shadow',              GLASS_SHADOW,          'important');
        pill.style.setProperty('border',                  'none',                'important');
        pill.style.setProperty('margin',                  '1px',                 'important');
        VARS.forEach(v => pill.style.setProperty(v, 'transparent', 'important'));
    }

    if (_mastheadActive) _mastheadRAFId = requestAnimationFrame(_enforceGlass);
}

// ── Inject a hard CSS fallback so even non-JS-set backgrounds are overridden ─
// This catches cases where YouTube sets background via a stylesheet rule rather
// than inline JS, which the rAF loop alone cannot override.
function _injectMastheadCSS() {
    const id = 'yt-pro-masthead-override';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
        #masthead-container,
        ytd-masthead,
        #masthead-container.ytd-app,
        ytd-masthead.ytd-app,
        #masthead > .ytd-masthead.style-scope,
        #masthead > ytd-masthead {
            background: transparent !important;
            background-color: transparent !important;
            box-shadow: none !important;
            --yt-masthead-background-color: transparent !important;
            --ytd-masthead-color: transparent !important;
            --yt-masthead-custom-background-color: transparent !important;
            --ytd-masthead-background: transparent !important;
            --yt-masthead-scrolled-background-color: transparent !important;
        }
        ytd-masthead #container {
            background: ${GLASS_SF} !important;
            background-color: ${GLASS_SF} !important;
            backdrop-filter: blur(${GLASS_BLUR}) !important;
            -webkit-backdrop-filter: blur(${GLASS_BLUR}) !important;
            border-radius: 3000px !important;
            box-shadow: ${GLASS_SHADOW} !important;
            border: none !important;
        }
    `;
    document.head.appendChild(style);
}

function initMastheadGuard() {
    if (_mastheadActive) return;
    _mastheadActive = true;
    _injectMastheadCSS();
    _mastheadRAFId  = requestAnimationFrame(_enforceGlass);
}

function destroyMastheadGuard() {
    _mastheadActive = false;
    if (_mastheadRAFId) { cancelAnimationFrame(_mastheadRAFId); _mastheadRAFId = null; }
    document.getElementById('yt-pro-masthead-override')?.remove();
    const props = [
        'background','background-color','backdrop-filter','-webkit-backdrop-filter',
        'border-radius','box-shadow','border','margin',
        '--ytd-masthead-color','--yt-masthead-background-color',
        '--yt-masthead-custom-background-color','--ytd-masthead-background',
        '--yt-spec-base-background','--yt-masthead-scrolled-background-color',
    ];
    [
        document.documentElement, document.body,
        document.querySelector('ytd-app'),
        document.querySelector('ytd-watch-flexy'),
        document.querySelector('ytd-page-manager'),
        document.getElementById('masthead-container'),
        document.querySelector('ytd-masthead'),
        document.querySelector('ytd-masthead #container'),
    ].forEach(el => { if (el) props.forEach(p => el.style.removeProperty(p)); });
}

if (isCtxValid()) chrome.storage.local.get(['masterEnabled', 'theme', 'premium', 'ambient', 'speed', 'autoscroll', 'download', 'autoResume'], (result) => {
    if (result.masterEnabled === false) return;

    if (result.theme    !== false) {
        injectCSS('theme.css');
        initMastheadGuard();
    }
    if (result.premium  !== false) document.body.classList.add('yt-pro-premium');
    if (result.ambient  !== false) document.body.classList.add('yt-pro-ambient');
    if (result.speed    !== false) injectScript('inject-speed.js');
    if (result.autoscroll !== false) initAutoScroll();
    if (result.download !== false) initDownloadIntercept();
    if (result.autoResume !== false) initBadgeInjection();
});

// Auto Resume is initialised inside the class (checks its own toggle)
new YTProAutoResume();

// ─── Message Listener ─────────────────────────────────────────────────────────
if (isCtxValid()) chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'masterToggleChanged') {
        if (!request.state) {
            document.body.classList.remove('yt-pro-premium', 'yt-pro-ambient');
            if (autoScrollInterval) clearInterval(autoScrollInterval);
            removeDownloadIntercept();
            document.querySelectorAll('link.yt-pro-injected-asset').forEach(el => el.remove());
            destroyMastheadGuard();
            // Remove resume button from player if present
            document.querySelector('#yt-pro-resume-switch')?.remove();
        } else {
            location.reload();
        }
        return;
    }

    if (request.action === 'togglepremium') {
        document.body.classList.toggle('yt-pro-premium', request.state);
    } else if (request.action === 'toggleambient') {
        document.body.classList.toggle('yt-pro-ambient', request.state);
    } else if (request.action === 'toggledownload') {
        request.state ? initDownloadIntercept() : removeDownloadIntercept();
    } else if (request.action === 'toggleautoResume') {
        if (!request.state) {
            document.querySelector('#yt-pro-resume-switch')?.remove();
        } else {
            location.reload();
        }

    // ── Popup open → pause; popup close → resume ─────────────────────────
    // Only pauses if the video is actually playing; only resumes if WE paused it
    // (so user-paused videos are never accidentally restarted).
    } else if (request.action === 'pauseForPopup') {
        const video = document.querySelector('video');
        if (video && !video.paused) {
            video._pausedByPopup = true;
            video.pause();
        }
    } else if (request.action === 'resumeAfterPopup') {
        const video = document.querySelector('video');
        if (video && video._pausedByPopup) {
            video._pausedByPopup = false;
            video.play().catch(() => {});  // .catch so autoplay-policy errors are silent
        }
    }
});
