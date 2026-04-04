(function () {
    'use strict';

    // ── 1. Get the YouTube URL from extension storage ─────────────────────────
    chrome.storage.local.get(['ssvid_pending_url', 'ssvid_pending_ts'], (result) => {
        const ytUrl = result.ssvid_pending_url || '';
        const ts    = result.ssvid_pending_ts  || 0;

        if (!ytUrl || (Date.now() - ts) > 30000) return;

        chrome.storage.local.remove(['ssvid_pending_url', 'ssvid_pending_ts']);

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => tryFillAndStart(ytUrl));
        } else {
            tryFillAndStart(ytUrl);
        }
    });

    // ── 2. React/Vue-safe value setter ───────────────────────────────────────
    function setNativeValue(el, value) {
        const nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value'
        ).set;
        nativeSetter.call(el, value);
        ['input', 'change', 'keyup', 'paste'].forEach(evt =>
            el.dispatchEvent(new Event(evt, { bubbles: true, cancelable: true }))
        );
        el.dispatchEvent(new InputEvent('input', {
            bubbles: true, data: value, inputType: 'insertText'
        }));
    }

    // ── 3. Find a button by exact visible text ────────────────────────────────
    function findButtonByText(text) {
        const lower = text.toLowerCase();
        return Array.from(document.querySelectorAll('button, input[type="submit"]'))
            .find(el => el.textContent.trim().toLowerCase() === lower);
    }

    // ── 4. STEP A — Fill input + click Start ─────────────────────────────────
    function tryFillAndStart(ytUrl, attempts = 0) {
        if (attempts > 50) return;

        const input = document.querySelector(
            'input[placeholder*="Paste" i], input[placeholder*="paste" i], ' +
            'input[placeholder*="Enter" i], input[type="url"], input[type="text"]'
        );
        const startBtn = findButtonByText('start') ||
                         document.querySelector('button[type="submit"], form button');

        if (!input || !startBtn) {
            setTimeout(() => tryFillAndStart(ytUrl, attempts + 1), 200);
            return;
        }

        input.focus();
        setNativeValue(input, ytUrl);

        setTimeout(() => {
            if (!input.value.includes('youtu')) setNativeValue(input, ytUrl);
            startBtn.click();
            waitForConvertButtons(ytUrl);
        }, 350);
    }

    // ── 5. STEP B — Click the best Convert button in the quality table ────────
    function waitForConvertButtons(ytUrl, attempts = 0) {
        if (attempts > 80) return;

        const convertBtns = Array.from(document.querySelectorAll('button, a'))
            .filter(el => el.textContent.trim().toLowerCase() === 'convert');

        if (!convertBtns.length) {
            setTimeout(() => waitForConvertButtons(ytUrl, attempts + 1), 200);
            return;
        }

        const QUALITY_ORDER = ['2160', '4k', '1440', '1080', '720', '480', '360'];
        let best = null;
        for (const q of QUALITY_ORDER) {
            best = convertBtns.find(btn => {
                const row = btn.closest('tr, li, [class]') || btn.parentElement;
                return row && row.textContent.toLowerCase().includes(q);
            });
            if (best) break;
        }

        (best || convertBtns[0]).click();

        // STEP C: watch for the Download modal with MutationObserver
        waitForDownloadModal();
    }

    // ── 6. STEP C — MutationObserver watches for the green Download button ────
    // Conversion time varies per video — we wait as long as it takes (up to 5 min).
    // The modal says "Your file is ready to download." and has a green Download button.
    function waitForDownloadModal() {
        // Check if the button is already in the DOM right now
        if (clickDownloadIfPresent()) return;

        let giveUpTimer = null;

        const observer = new MutationObserver(() => {
            if (clickDownloadIfPresent()) {
                observer.disconnect();
                clearTimeout(giveUpTimer);
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });

        // Safety net: stop watching after 5 minutes (extremely long conversion)
        giveUpTimer = setTimeout(() => observer.disconnect(), 5 * 60 * 1000);
    }

    // Returns true and clicks the button if the modal Download button is found
    function clickDownloadIfPresent() {
        // The green Download button lives inside the modal/popup that appears
        // after conversion. We identify it by:
        //   1. Button text is exactly "Download"
        //   2. It is NOT the "DOWNLOAD Chrome Extension" ad banner (bottom-right corner)
        //   3. Prefer a button that is a descendant of a modal/dialog/overlay container

        const allBtns = Array.from(document.querySelectorAll('button, a'));
        const downloadBtns = allBtns.filter(el => {
            const text = el.textContent.trim().toLowerCase();
            // Exact match "download" OR "download video" — skip the extension ad
            return (text === 'download' || text === 'download video') &&
                   !el.closest('[class*="extension"], [id*="extension"], [class*="banner"], [class*="ads"]');
        });

        if (!downloadBtns.length) return false;

        // Prefer a button inside a visible modal/dialog/popup
        const modalBtn = downloadBtns.find(btn =>
            btn.closest(
                '[class*="modal"], [class*="popup"], [class*="dialog"], ' +
                '[class*="overlay"], [class*="result"], [role="dialog"]'
            )
        );

        const target = modalBtn || downloadBtns[0];

        // Make sure the element is actually visible before clicking
        const rect = target.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false;

        if (target.tagName === 'A' && target.href && !target.href.startsWith('javascript')) {
            window.location.href = target.href;
        } else {
            target.click();
        }
        return true;
    }

})();