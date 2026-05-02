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

// ─── Cinematic Mode — preset value maps ──────────────────────────────────────
const CINE_PRESETS = {
    blur: { low: '50px',  med: '90px',  high: '130px' },
    sat:  { low: '120%',  med: '160%',  high: '210%'  },
    dim:  { low: '0.35',  med: '0.55',  high: '0.78'  },
};
function buildCineFilter(s) {
    const blur = CINE_PRESETS.blur[(s && s.blur) || 'med'];
    const sat  = CINE_PRESETS.sat [(s && s.sat)  || 'med'];
    return `blur(${blur}) saturate(${sat}) brightness(0.95)`;
}
function getCineDim(s) {
    return CINE_PRESETS.dim[(s && s.dim) || 'med'];
}

// ─── Cinematic Mode — ultra-efficient GPU-composited background glow ───────────
//
// Full rendering pipeline (zero CPU pixel work, zero decoder contention):
//
//  1. requestVideoFrameCallback (rVFC) — fires once per decoded video frame,
//     IN SYNC with the video's own presentation. No rAF cadence mismatch,
//     no main/decoder-thread synchronization pressure on any browser.
//     Chrome 83+, Firefox 132+. Falls back to setInterval at 20fps.
//
//  2. createImageBitmap(video, {resizeWidth, resizeHeight, resizeQuality:'low'})
//     — GPU-accelerated snapshot + downscale in a single async call. The resize
//     happens on the GPU at capture time, so the ImageBitmap we receive is
//     already the target size. CPU never touches a pixel.
//
//  3. ImageBitmapRenderingContext.transferFromImageBitmap(bmp)
//     — ZERO-COPY canvas update: transfers ownership of the GPU-side bitmap
//     to the canvas backing store by swapping a pointer. No memcpy, no
//     drawImage overhead, no pixel format conversion. The canvas texture is
//     updated entirely on the GPU side. Chrome 66+, Firefox 65+.
//
//  4. CSS filter (blur/saturate/brightness) on the canvas element
//     — Applied by the GPU compositor, never involves JS or CPU.
//     The canvas lives on its own compositor layer (will-change: transform).
//
//  5. Throttle to 20fps max — the ambient glow is blurred 50-130px. At that
//     radius, frame rate above 15fps is visually imperceptible. Throttling
//     cuts GPU texture upload work by 3x on 60fps content.
//
//  6. Skip when paused, tab hidden, video stalled, or a bitmap is already
//     in-flight — zero wasted GPU work in every idle/background state.
//
//  7. 64x36 internal canvas — 1/4 the GPU texture memory of the previous 128x72.
//     At blur(90px) there is literally zero visible difference.
//
// Net result: video decoder, JS main thread, and GPU compositor operate
// completely independently with no synchronization stalls anywhere.
(function () {
    let canvas      = null;
    let ctx         = null;   // ImageBitmapRenderingContext — zero-copy path
    let raf         = null;
    let retryTimer  = null;
    let lastUrl     = location.href;
    let cineSettings = { blur: 'med', sat: 'med', dim: 'med' };

    // 64x36 — 1/4 the GPU cost of 128x72, visually identical at any blur preset.
    const DRAW_W = 64;
    const DRAW_H = 36;

    // Glow update cap: 20fps. Imperceptible on a 50-130px blurred canvas.
    // At 60fps content this cuts GPU bitmap uploads from 60/s down to 20/s.
    const FRAME_MS = 50;

    let lastDrawTime  = 0;
    let lastVideoTime = -1; // stall detection — skip if currentTime hasn't moved
    let drawPending   = false; // guard against overlapping createImageBitmap calls

    function isWatchPage() { return location.pathname === '/watch'; }

    // Hide the canvas immediately on navigation / source change.
    // With bitmaprenderer we don't need to clearRect — just fade out.
    function clearCanvas() {
        if (!canvas) return;
        canvas.style.transition = 'opacity 0.3s ease';
        canvas.style.opacity    = '0';
        lastVideoTime = -1;
    }

    function attach() {
        if (canvas) return;
        const video = document.querySelector('video.html5-main-video');
        if (!video) { retryTimer = setTimeout(attach, 600); return; }
        if (!isCtxValid()) return;
        chrome.storage.local.get('cinematicSettings', (r) => {
            cineSettings = r.cinematicSettings || { blur: 'med', sat: 'med', dim: 'med' };
            _doAttach(video);
        });
    }

    function _doAttach(video) {
        if (canvas) return; // guard against double-call

        // Tiny canvas — CSS scales it to 100vw x 100vh
        canvas = document.createElement('canvas');
        canvas.id     = 'yt-pro-cinematic-canvas';
        canvas.width  = DRAW_W;
        canvas.height = DRAW_H;
        Object.assign(canvas.style, {
            position:        'fixed',
            top:             '0',
            left:            '0',
            width:           '100vw',
            height:          '100vh',
            zIndex:          '0',
            pointerEvents:   'none',
            filter:          buildCineFilter(cineSettings),
            opacity:         '0',             // fades in on first 'playing' event
            transform:       'scale(1.08)',
            transformOrigin: 'center center',
            // Own compositor layer — canvas repaints never trigger page repaints.
            // Prevents opacity animations from forcing layer promotions later.
            willChange:      'transform, opacity',
        });

        document.body.insertBefore(canvas, document.body.firstChild);

        // ImageBitmapRenderingContext: transferFromImageBitmap() swaps the
        // canvas backing texture by pointer — zero pixel copy, zero CPU work.
        ctx = canvas.getContext('bitmaprenderer');

        // Fade in only once the new video actually starts playing
        function onPlaying() {
            if (!canvas) return;
            canvas.style.transition = 'opacity 0.6s ease';
            canvas.style.opacity    = getCineDim(cineSettings);
        }
        video.addEventListener('playing', onPlaying);
        canvas._onPlaying = () => { video.removeEventListener('playing', onPlaying); };

        // Wipe canvas instantly when YouTube swaps the video source
        function onSourceChange() { clearCanvas(); }
        video.addEventListener('emptied',   onSourceChange);
        video.addEventListener('loadstart', onSourceChange);
        canvas._removeSourceListeners = () => {
            video.removeEventListener('emptied',   onSourceChange);
            video.removeEventListener('loadstart', onSourceChange);
        };

        // Core draw function
        function drawFrame(now) {
            if (!canvas || !document.body.classList.contains('yt-pro-cinematic')) return;
            if (!isWatchPage()) return;

            // Skip when tab is hidden — no visual benefit, pure waste
            if (document.hidden) return;

            // Skip when video is paused — glow doesn't need updating
            if (video.paused) return;

            // Skip if video hasn't buffered enough to have a renderable frame
            if (video.readyState < 2) return;

            // Throttle: cap glow updates at 20fps regardless of video frame rate
            if (now - lastDrawTime < FRAME_MS) return;

            // Skip if the video is stalled (currentTime not advancing)
            // Prevents hammering the GPU during buffering events
            const vt = video.currentTime;
            if (vt === lastVideoTime) return;
            lastVideoTime = vt;

            // Guard: don't start a new capture while the previous one is still
            // in-flight. Protects against slow GPU or throttled tabs.
            if (drawPending) return;
            drawPending   = true;
            lastDrawTime  = now;

            // createImageBitmap with resize options:
            //   - The browser/GPU performs the downscale during capture,
            //     so the returned ImageBitmap is already DRAW_W x DRAW_H.
            //   - resizeQuality:'low' = nearest-neighbor, fastest possible,
            //     quality is irrelevant at 50-130px CSS blur.
            //   - The Promise resolves off the critical path — video decoder
            //     and main thread are both free the moment this fires.
            createImageBitmap(video, {
                resizeWidth:   DRAW_W,
                resizeHeight:  DRAW_H,
                resizeQuality: 'low',
            }).then(bmp => {
                drawPending = false;
                if (!ctx || !canvas) { bmp.close(); return; }
                // transferFromImageBitmap: GPU pointer swap — the fastest
                // possible canvas update. After this call bmp is neutered
                // (ownership transferred), so we must NOT call bmp.close().
                ctx.transferFromImageBitmap(bmp);
            }).catch(() => {
                // createImageBitmap can fail if the video is in a tainted/
                // cross-origin state. Silently skip this frame.
                drawPending = false;
            });
        }

        // Draw scheduling: rVFC > setInterval fallback
        if (typeof video.requestVideoFrameCallback === 'function') {
            // rVFC fires once per decoded frame, in sync with the video's own
            // presentation pipeline. No rAF mismatch, no decoder contention.
            // Chrome 83+, Firefox 132+.
            function onVideoFrame(now) {
                if (!canvas || !document.body.classList.contains('yt-pro-cinematic')) return;
                drawFrame(now);
                raf = video.requestVideoFrameCallback(onVideoFrame);
            }
            raf = video.requestVideoFrameCallback(onVideoFrame);
            canvas._cancelDraw = () => {
                if (raf != null) { video.cancelVideoFrameCallback(raf); raf = null; }
            };
        } else {
            // Fallback for Firefox < 132: setInterval at 20fps.
            // Does not trigger main/decoder thread synchronization the way rAF
            // does, so it avoids stutter on older Firefox.
            raf = setInterval(() => drawFrame(performance.now()), FRAME_MS);
            canvas._cancelDraw = () => {
                if (raf != null) { clearInterval(raf); raf = null; }
            };
        }
    }

    function stop() {
        drawPending  = false;
        lastDrawTime = 0;
        if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
        if (canvas) {
            if (canvas._cancelDraw)            canvas._cancelDraw();
            if (canvas._onPlaying)             canvas._onPlaying();
            if (canvas._removeSourceListeners) canvas._removeSourceListeners();
            canvas.remove();
            canvas = null;
            ctx    = null;
            raf    = null;
        }
    }

    // Primary nav signal: yt-navigate-finish
    document.addEventListener('yt-navigate-finish', () => {
        lastUrl = location.href;
        if (!document.body.classList.contains('yt-pro-cinematic')) return;
        clearCanvas();
        stop();
        if (isWatchPage()) retryTimer = setTimeout(attach, 600);
    });

    // Fallback URL poll (handles cases where yt-navigate-finish misfires)
    setInterval(() => {
        const currentUrl = location.href;
        if (currentUrl === lastUrl) return;
        lastUrl = currentUrl;
        if (!document.body.classList.contains('yt-pro-cinematic')) return;
        clearCanvas();
        stop();
        if (isWatchPage()) retryTimer = setTimeout(attach, 600);
    }, 300);

    // Re-attach if YouTube's SPA removes our canvas from the DOM
    const navObserver = new MutationObserver(() => {
        if (!document.body.classList.contains('yt-pro-cinematic')) return;
        if (!document.getElementById('yt-pro-cinematic-canvas') && isWatchPage() && !retryTimer && !canvas) {
            retryTimer = setTimeout(attach, 300);
        }
    });
    navObserver.observe(document.body, { childList: true, subtree: false });

    // Pause drawing when tab goes into background, resume on return
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            // Reset stall detection so the first visible frame is drawn immediately
            lastVideoTime = -1;
            lastDrawTime  = 0;
        }
    });

    // Expose so the message listener can call start/stop/applySettings
    window._ytProCinematic = {
        attach,
        stop,
        applySettings(s) {
            cineSettings = s;
            if (!canvas) return;
            canvas.style.filter = buildCineFilter(s);
            if (parseFloat(canvas.style.opacity) > 0) {
                canvas.style.opacity = getCineDim(s);
            }
        }
    };
})();


if (isCtxValid()) chrome.storage.local.get(['masterEnabled', 'theme', 'premium', 'ambient', 'cinematic', 'speed', 'autoscroll', 'download', 'autoResume'], (result) => {
    if (result.masterEnabled === false) return;

    if (result.theme    !== false) {
        injectCSS('theme.css');
        initMastheadGuard();
    }
    if (result.premium  !== false) document.body.classList.add('yt-pro-premium');
    if (result.ambient  !== false) {
        document.body.classList.add('yt-pro-ambient');
    }
    if (result.cinematic === true) {
        document.body.classList.add('yt-pro-cinematic');
        setTimeout(() => window._ytProCinematic?.attach(), 800);
    }
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
            document.body.classList.remove('yt-pro-premium', 'yt-pro-ambient', 'yt-pro-cinematic');
            window._ytProCinematic?.stop();
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
    } else if (request.action === 'togglecinematic') {
        document.body.classList.toggle('yt-pro-cinematic', request.state);
        if (request.state) { window._ytProCinematic?.attach(); } else { window._ytProCinematic?.stop(); }
    } else if (request.action === 'cinematicSettingsChanged') {
        window._ytProCinematic?.applySettings(request.settings);
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
