(function() {
    'use strict';
    if (window.top !== window.self) return;

    let audioCtx, source, gainNode, lowFilter, midFilter, highFilter, analyser;
    let isInitialized = false;

    const styles = `
        @keyframes gm-bounce-down { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(10px); } }
        .gm-bounce-arrow { animation: gm-bounce-down 1.5s infinite; font-size: 24px; color: #ff4757; margin-top: 15px; }
    `;
    const styleSheet = document.createElement("style");
    styleSheet.type = "text/css";
    styleSheet.innerText = styles;
    document.head.appendChild(styleSheet);

    function toggleUI() {
        let container = document.getElementById('gm-audio-enhancer');
        if (container) {
            container.style.display = container.style.display === 'none' ? 'block' : 'none';
            return;
        }

        container = document.createElement('div');
        container.id = 'gm-audio-enhancer';
        container.style.position = 'fixed';
        container.style.bottom = '20px';
        container.style.right = '20px';
        container.style.backgroundColor = 'rgba(25, 25, 30, 0.85)';
        container.style.backdropFilter = 'blur(16px)';
        container.style.WebkitBackdropFilter = 'blur(16px)';
        container.style.border = '1px solid rgba(255, 255, 255, 0.2)';
        container.style.color = '#fff';
        container.style.padding = '15px';
        container.style.borderRadius = '12px';
        container.style.zIndex = '9999999';
        container.style.fontFamily = 'Arial, sans-serif';
        container.style.boxShadow = '0 10px 40px rgba(0,0,0,0.6)';
        container.style.width = '240px';

        const contentWrapper = document.createElement('div');
        contentWrapper.style.position = 'relative';

        const closeBtn = document.createElement('span');
        closeBtn.innerText = '✖';
        closeBtn.style.position = 'absolute';
        closeBtn.style.top = '10px';
        closeBtn.style.right = '12px';
        closeBtn.style.cursor = 'pointer';
        closeBtn.style.fontSize = '12px';
        closeBtn.style.opacity = '0.7';
        closeBtn.style.zIndex = '100';
        closeBtn.onclick = () => container.style.display = 'none';
        closeBtn.onmouseover = () => closeBtn.style.opacity = '1';
        closeBtn.onmouseout = () => closeBtn.style.opacity = '0.7';

        const title = document.createElement('div');
        title.innerText = '🎵 Audio Enhancer';
        title.style.fontWeight = 'bold';
        title.style.marginBottom = '15px';
        title.style.fontSize = '14px';
        title.style.textAlign = 'center';
        container.appendChild(closeBtn);
        container.appendChild(title);
        container.appendChild(contentWrapper);

        const controlsDiv = document.createElement('div');
        const volLabel = document.createElement('label');
        volLabel.innerText = 'Master Volume (100% - 300%): ';
        volLabel.style.fontSize = '12px';
        volLabel.style.display = 'block';

        const volSlider = document.createElement('input');
        volSlider.type = 'range'; volSlider.min = '1'; volSlider.max = '3'; volSlider.step = '0.1'; volSlider.value = '1';
        volSlider.style.width = '100%'; volSlider.style.marginBottom = '15px';
        volSlider.addEventListener('input', (e) => { if (gainNode) gainNode.gain.value = e.target.value; });

        const modeLabel = document.createElement('label');
        modeLabel.innerText = 'Presets: ';
        modeLabel.style.fontSize = '12px';
        modeLabel.style.display = 'block';

        const modeSelect = document.createElement('select');
        modeSelect.style.width = '100%'; modeSelect.style.marginBottom = '15px'; modeSelect.style.padding = '5px';
        modeSelect.style.backgroundColor = 'rgba(0, 0, 0, 0.4)'; modeSelect.style.color = 'white';
        modeSelect.style.border = '1px solid rgba(255, 255, 255, 0.2)'; modeSelect.style.borderRadius = '5px'; modeSelect.style.outline = 'none';

        ['Original Sound', 'Bass Boost', 'Clear Vocals', 'Custom EQ'].forEach(mode => {
            const opt = document.createElement('option'); opt.value = mode; opt.innerText = mode; modeSelect.appendChild(opt);
        });

        const eqContainer = document.createElement('div');
        eqContainer.style.marginBottom = '10px'; eqContainer.style.backgroundColor = 'rgba(0,0,0,0.3)';
        eqContainer.style.padding = '10px'; eqContainer.style.borderRadius = '8px'; eqContainer.style.border = '1px inset rgba(255,255,255,0.05)';

        const eqTitle = document.createElement('div');
        eqTitle.innerText = 'Custom Equalizer (dB)'; eqTitle.style.fontSize = '11px'; eqTitle.style.textAlign = 'center'; eqTitle.style.marginBottom = '10px'; eqTitle.style.color = '#ccc';
        eqContainer.appendChild(eqTitle);

        function createEQSlider(labelText) {
            const wrapper = document.createElement('div');
            wrapper.style.display = 'flex'; wrapper.style.alignItems = 'center'; wrapper.style.justifyContent = 'space-between'; wrapper.style.marginBottom = '5px';
            const label = document.createElement('span'); label.innerText = labelText; label.style.fontSize = '11px'; label.style.width = '40px';
            const slider = document.createElement('input'); slider.type = 'range'; slider.min = '-15'; slider.max = '15'; slider.step = '1'; slider.value = '0'; slider.style.width = '140px';
            const valDisplay = document.createElement('span'); valDisplay.innerText = '0'; valDisplay.style.fontSize = '11px'; valDisplay.style.width = '20px'; valDisplay.style.textAlign = 'right';

            slider.addEventListener('input', (e) => {
                valDisplay.innerText = e.target.value > 0 ? '+' + e.target.value : e.target.value;
                modeSelect.value = 'Custom EQ'; applyCustomEQ(); toggleGifDisplay();
            });
            wrapper.appendChild(label); wrapper.appendChild(slider); wrapper.appendChild(valDisplay);
            return { wrapper, slider, valDisplay };
        }

        const lowBand = createEQSlider('Lows'); const midBand = createEQSlider('Mids'); const highBand = createEQSlider('Highs');
        eqContainer.appendChild(lowBand.wrapper); eqContainer.appendChild(midBand.wrapper); eqContainer.appendChild(highBand.wrapper);

        function applyCustomEQ() {
            if (!lowFilter || !midFilter || !highFilter) return;
            lowFilter.gain.value = parseFloat(lowBand.slider.value);
            midFilter.gain.value = parseFloat(midBand.slider.value);
            highFilter.gain.value = parseFloat(highBand.slider.value);
        }

        function setPreset(mode) {
            let l = 0, m = 0, h = 0;
            if (mode === 'Original Sound') { l = 0; m = 0; h = 0; } else if (mode === 'Bass Boost') { l = 15; m = -2; h = 0; } else if (mode === 'Clear Vocals') { l = -3; m = 10; h = 5; }
            if (mode !== 'Custom EQ') {
                lowBand.slider.value = l; midBand.slider.value = m; highBand.slider.value = h;
                lowBand.valDisplay.innerText = l > 0 ? '+' + l : l; midBand.valDisplay.innerText = m > 0 ? '+' + m : m; highBand.valDisplay.innerText = h > 0 ? '+' + h : h;
            }
            applyCustomEQ(); toggleGifDisplay();
        }

        modeSelect.addEventListener('change', (e) => setPreset(e.target.value));

        const warningText = document.createElement('div');
        warningText.innerText = '⚠️ Tip: Keep volume at 100% when heavily boosting lows to prevent distortion.';
        warningText.style.fontSize = '10px'; warningText.style.color = '#ffcc00'; warningText.style.marginBottom = '15px'; warningText.style.textAlign = 'center'; warningText.style.lineHeight = '1.3';

        controlsDiv.appendChild(volLabel); controlsDiv.appendChild(volSlider); controlsDiv.appendChild(modeLabel); controlsDiv.appendChild(modeSelect); controlsDiv.appendChild(eqContainer); controlsDiv.appendChild(warningText);
        contentWrapper.appendChild(controlsDiv);

        const visContainer = document.createElement('div');
        visContainer.style.display = 'flex'; visContainer.style.justifyContent = 'space-between'; visContainer.style.alignItems = 'center'; visContainer.style.marginBottom = '15px'; visContainer.style.width = '100%';

        const canvas = document.createElement('canvas');
        canvas.id = 'gm-audio-visualizer'; canvas.width = 240; canvas.height = 40; canvas.style.width = '100%'; canvas.style.height = '40px'; canvas.style.backgroundColor = 'rgba(0,0,0,0.5)'; canvas.style.borderRadius = '5px'; canvas.style.border = '1px solid rgba(255,255,255,0.1)'; canvas.style.transition = 'width 0.3s ease';

        const dancingGif = document.createElement('img');
        dancingGif.src = 'https://i.pinimg.com/originals/f5/63/0d/f5630ddc114edca5dfec76ae5996b152.gif';
        dancingGif.style.width = '40px'; dancingGif.style.height = '40px'; dancingGif.style.borderRadius = '5px'; dancingGif.style.display = 'none'; dancingGif.style.marginLeft = '10px'; dancingGif.style.objectFit = 'cover';

        visContainer.appendChild(canvas); visContainer.appendChild(dancingGif); contentWrapper.appendChild(visContainer);

        function toggleGifDisplay() {
            const isEQActive = modeSelect.value !== 'Original Sound' || parseFloat(lowBand.slider.value) !== 0 || parseFloat(midBand.slider.value) !== 0 || parseFloat(highBand.slider.value) !== 0;
            if (isEQActive) { dancingGif.style.display = 'block'; canvas.style.width = 'calc(100% - 50px)'; } else { dancingGif.style.display = 'none'; canvas.style.width = '100%'; }
        }

        const lockOverlay = document.createElement('div');
        lockOverlay.style.position = 'absolute'; lockOverlay.style.top = '0'; lockOverlay.style.left = '-10px'; lockOverlay.style.right = '-10px'; lockOverlay.style.bottom = '55px'; lockOverlay.style.backgroundColor = 'rgba(25, 25, 30, 0.7)'; lockOverlay.style.backdropFilter = 'blur(4px)'; lockOverlay.style.WebkitBackdropFilter = 'blur(4px)'; lockOverlay.style.zIndex = '10'; lockOverlay.style.display = 'flex'; lockOverlay.style.flexDirection = 'column'; lockOverlay.style.alignItems = 'center'; lockOverlay.style.justifyContent = 'center'; lockOverlay.style.borderRadius = '8px'; lockOverlay.style.transition = 'opacity 0.4s ease';

        const lockText = document.createElement('div'); lockText.innerText = 'Controls Locked'; lockText.style.fontWeight = 'bold'; lockText.style.color = '#fff'; lockText.style.marginBottom = '5px';
        const lockSubText = document.createElement('div'); lockSubText.innerText = 'Click connect below to start!'; lockSubText.style.fontSize = '11px'; lockSubText.style.color = '#ddd';
        const bounceArrow = document.createElement('div'); bounceArrow.innerText = '⬇️'; bounceArrow.className = 'gm-bounce-arrow';

        lockOverlay.appendChild(lockText); lockOverlay.appendChild(lockSubText); lockOverlay.appendChild(bounceArrow); contentWrapper.appendChild(lockOverlay);

        const initBtn = document.createElement('button');
        initBtn.innerText = '🔌 Connect Audio First'; initBtn.style.width = '100%'; initBtn.style.padding = '10px'; initBtn.style.cursor = 'pointer'; initBtn.style.backgroundColor = '#4CAF50'; initBtn.style.color = 'white'; initBtn.style.border = 'none'; initBtn.style.borderRadius = '5px'; initBtn.style.fontWeight = 'bold'; initBtn.style.boxShadow = '0 0 15px rgba(76, 175, 80, 0.6)'; initBtn.style.position = 'relative'; initBtn.style.zIndex = '11';

        initBtn.onclick = () => initAudio(initBtn, canvas, lockOverlay);
        contentWrapper.appendChild(initBtn); document.body.appendChild(container);
    }

    function initAudio(btnElement, canvasElement, lockOverlay) {
        if (isInitialized) return;
        const mediaElement = document.querySelector('video, audio');
        if (!mediaElement) { alert('No playing video or audio found on this page! Play some music first.'); return; }
        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            source = audioCtx.createMediaElementSource(mediaElement);
            gainNode = audioCtx.createGain(); gainNode.gain.value = 1;
            lowFilter = audioCtx.createBiquadFilter(); lowFilter.type = 'lowshelf'; lowFilter.frequency.value = 250; lowFilter.gain.value = 0;
            midFilter = audioCtx.createBiquadFilter(); midFilter.type = 'peaking'; midFilter.frequency.value = 1000; midFilter.Q.value = 1; midFilter.gain.value = 0;
            highFilter = audioCtx.createBiquadFilter(); highFilter.type = 'highshelf'; highFilter.frequency.value = 4000; highFilter.gain.value = 0;
            analyser = audioCtx.createAnalyser(); analyser.fftSize = 64;

            source.connect(lowFilter); lowFilter.connect(midFilter); midFilter.connect(highFilter); highFilter.connect(gainNode); gainNode.connect(analyser); analyser.connect(audioCtx.destination);
            isInitialized = true;

            lockOverlay.style.opacity = '0'; setTimeout(() => lockOverlay.style.display = 'none', 400);
            btnElement.innerText = 'Audio Connected ✅'; btnElement.style.backgroundColor = 'rgba(85, 85, 85, 0.8)'; btnElement.style.boxShadow = 'none'; btnElement.style.cursor = 'default';
            startVisualizer(canvasElement, analyser);
        } catch (e) { console.error("Audio Enhancer Error: ", e); alert("Could not connect audio. This is usually due to strict site CORS policies."); }
    }

    function startVisualizer(canvas, analyserNode) {
        const canvasCtx = canvas.getContext('2d');
        const bufferLength = analyserNode.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        function draw() {
            requestAnimationFrame(draw);
            if (document.getElementById('gm-audio-enhancer') && document.getElementById('gm-audio-enhancer').style.display === 'none') return;
            analyserNode.getByteFrequencyData(dataArray);
            canvasCtx.fillStyle = 'rgba(25, 25, 30, 0.5)'; canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
            const barWidth = (canvas.width / bufferLength); let x = 0;
            for(let i = 0; i < bufferLength; i++) {
                const barHeight = (dataArray[i] / 255) * canvas.height; const hue = (i / bufferLength) * 280;
                canvasCtx.fillStyle = `hsl(${hue}, 100%, 50%)`; canvasCtx.fillRect(x, canvas.height - barHeight, barWidth - 1, barHeight); x += barWidth;
            }
        }
        draw();
    }

    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (e.altKey && (e.key === 'q' || e.key === 'Q')) { e.preventDefault(); toggleUI(); }
    });
})();