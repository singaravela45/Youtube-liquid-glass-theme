/* ================================================================
   Music Enhancer v3.5 — Integrated into YouTube Pro +
   Runs as a content script on www.youtube.com only.
   ================================================================ */
(function () {
  'use strict';
  if (window.top !== window.self) return;
  if (document.getElementById('me-root')) return;

  const EXT_URL   = k => browser.runtime.getURL(k);
  const LOGO_URL  = EXT_URL('imgs/me-logo48.png');
  const VIDEO_URL = EXT_URL('dancing.mp4');

  const FREQ_BANDS = [32,64,125,250,500,1000,2000,4000,8000,16000];

  const PRESETS = {
    'Normal':     [ 0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    'Bass Boost': [10,  9,  7,  3,  0, -1, -2,  0,  0,  0],
    'Soft Bass':  [ 5,  7,  6,  3,  1,  0,  0, -1,  0,  0],
    'Electronic': [ 8,  6,  0, -3,  4,  1,  2,  5,  7,  8],
    'Rock':       [ 6,  5,  4,  2, -1,  2,  5,  6,  5,  4],
    'Pop':        [-2,  1,  4,  5,  3,  0, -1,  1,  2,  3],
    'Jazz':       [ 4,  3,  1,  4,  4,  1,  2,  3,  4,  5],
    'Voice':      [-4, -3,  0,  3,  6,  6,  4,  3,  2,  1],
  };
  const BASS_IDX=[0,1,2], MID_IDX=[3,4,5], TREBLE_IDX=[6,7,8,9];

  const AUDIOMODS = {
    'Sped Up':         { rate: 1.25, reverb: false, reverbType: null },
    'Empty Hall':      { rate: 1.00, reverb: true,  reverbType: 'hall' },
    'Slowed':          { rate: 0.80, reverb: false, reverbType: null },
    'Slowed + Reverb': { rate: 0.75, reverb: true,  reverbType: 'room' },
  };

  const CUSTOM_STORAGE_KEY = 'me_custom_presets';

  let audioCtx=null, sourceNode=null, gainNode=null, eqFilters=[];
  let pannerNode=null, hrtfPanner=null, analyserNode=null;
  let convolverNode=null, reverbGainNode=null, dryGainNode=null;
  let isConnected=false, mediaEl=null;
  let panelVisible=false, currentPreset='Normal', volume=1.0, balance=0, monoOn=false;
  let audio3DOn=false, audio3DRaf=null, audio3DStart=null;
  let activeAudioMod=null;
  let advBands=new Array(10).fill(0);
  let radarGains={bass:0,mid:0,treble:0};
  let customPresets=[];
  let addingCustom=false;

  const CSS = `
    #me-root*{box-sizing:border-box;margin:0;padding:0}
    #me-root{position:fixed;bottom:22px;right:22px;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',sans-serif;user-select:none}
    #me-panel{position:absolute;bottom:16px;right:0;width:320px;border-radius:22px;overflow:hidden;background:rgba(9,11,26,0.88);backdrop-filter:blur(32px) saturate(200%);-webkit-backdrop-filter:blur(32px) saturate(200%);border:1px solid rgba(255,255,255,.13);box-shadow:0 32px 80px rgba(0,0,0,.65),0 0 0 1px rgba(255,255,255,.04) inset,0 1px 0 rgba(255,255,255,.12) inset;color:#fff;transform-origin:bottom right;transition:opacity .22s,transform .22s}
    #me-panel.hidden{opacity:0;transform:scale(.9) translateY(8px);pointer-events:none}
    #me-panel::before{content:'';position:absolute;inset:0;z-index:0;pointer-events:none;background:linear-gradient(135deg,rgba(0,212,255,.05) 0%,transparent 45%,rgba(124,58,237,.06) 100%)}
    .me-hdr{position:relative;z-index:1;display:flex;align-items:center;justify-content:space-between;padding:9px 12px 8px;border-bottom:1px solid rgba(255,255,255,.07)}
    .me-hl{display:flex;align-items:center;gap:9px}
    .me-logo{width:30px;height:30px;border-radius:9px;object-fit:cover;box-shadow:0 0 14px rgba(0,212,255,.4)}
    .me-ttl{font-size:14px;font-weight:800;letter-spacing:.3px;background:linear-gradient(90deg,#fff 0%,#00d4ff 30%,#c084fc 55%,#fff 80%,#00d4ff 100%);background-size:200% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:me-shimmer 3.5s linear infinite}
    @keyframes me-shimmer{0%{background-position:200% center}100%{background-position:-200% center}}
    .me-pill{font-size:9px;padding:2px 8px;border-radius:20px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.4);transition:all .3s;letter-spacing:.3px}
    .me-pill.live{background:rgba(0,212,255,.12);border-color:rgba(0,212,255,.35);color:#00d4ff}
    .me-x{width:26px;height:26px;border-radius:50%;border:none;background:rgba(255,255,255,.07);color:rgba(255,255,255,.5);cursor:pointer;font-size:11px;display:flex;align-items:center;justify-content:center;transition:background .2s,color .2s}
    .me-x:hover{background:rgba(255,60,60,.25);color:#ff5050}
    .me-body{position:relative;z-index:1;padding:9px 12px 10px}
    .me-vol-row{display:flex;align-items:center;gap:10px;margin-bottom:7px}
    .me-vl{font-size:10px;color:rgba(255,255,255,.4);min-width:52px}
    .me-vl b{color:#00d4ff;font-size:11px;font-weight:700}
    .me-sw{flex:1}
    .me-sl{-webkit-appearance:none;appearance:none;width:100%;height:5px;border-radius:5px;outline:none;cursor:pointer;background:rgba(255,255,255,.1)}
    .me-sl::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:linear-gradient(135deg,#00d4ff,#7c3aed);border:2px solid rgba(255,255,255,.85);box-shadow:0 0 10px rgba(0,212,255,.65);cursor:grab;transition:transform .15s}
    .me-sl::-webkit-slider-thumb:active{cursor:grabbing;transform:scale(1.3)}
    .me-sl::-moz-range-thumb{width:16px;height:16px;border-radius:50%;background:linear-gradient(135deg,#00d4ff,#7c3aed);border:2px solid rgba(255,255,255,.85);cursor:grab}
    #me-radar-wrap{display:flex;justify-content:center;margin-bottom:6px}
    #me-svg{overflow:visible}
    .r-ring{fill:none;stroke:rgba(255,255,255,.09);stroke-width:1;stroke-dasharray:3 3}
    .r-axis{stroke:rgba(255,255,255,.13);stroke-width:1}
    .r-poly{fill:rgba(0,212,255,.12);stroke:rgba(0,212,255,.75);stroke-width:1.8;filter:drop-shadow(0 0 8px rgba(0,212,255,.38))}
    .r-dot{fill:#fff;stroke:#00d4ff;stroke-width:2.2;cursor:grab;filter:drop-shadow(0 0 7px rgba(0,212,255,.95));transition:r .12s}
    .r-dot:active{cursor:grabbing}
    .r-lbl{font-size:10px;fill:rgba(255,255,255,.55);font-family:-apple-system,sans-serif}
    .r-val{font-size:9.5px;fill:#00d4ff;font-family:-apple-system,sans-serif;font-weight:700}
    .me-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin-bottom:8px}
    .me-pb{padding:6px 3px;border:none;border-radius:9px;cursor:pointer;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:rgba(255,255,255,0.6);font-size:10px;font-weight:700;letter-spacing:.2px;transition:all .18s cubic-bezier(.4,0,.2,1);backdrop-filter:blur(8px);position:relative;overflow:hidden;text-align:center}
    .me-pb::after{content:'';position:absolute;inset:0;border-radius:10px;opacity:0;background:radial-gradient(circle at 50% 50%,rgba(0,212,255,.25),transparent 70%);transition:opacity .2s}
    .me-pb:hover{background:rgba(0,212,255,0.1);border-color:rgba(0,212,255,0.4);color:#fff;transform:translateY(-2px);box-shadow:0 6px 20px rgba(0,212,255,.25)}
    .me-pb:hover::after{opacity:1}
    .me-pb:active{transform:translateY(0) scale(.97)}
    .me-pb.active{background:linear-gradient(135deg,rgba(0,212,255,.22),rgba(124,58,237,.22));border-color:rgba(0,212,255,.55);color:#00d4ff;box-shadow:0 0 18px rgba(0,212,255,.2)}
    .me-pb.active::after{opacity:1}
    .me-pb[data-preset="Normal"]{color:rgba(255,255,255,0.45);font-size:10px}
    .me-pb[data-preset="Normal"].active{background:rgba(255,255,255,0.06);border-color:rgba(255,255,255,0.3);color:rgba(255,255,255,0.7);box-shadow:none}
    .me-pb[data-preset="Normal"].active::after{opacity:0}
    .me-custom-hdr{font-size:9px;font-weight:700;color:rgba(255,255,255,.28);letter-spacing:.8px;text-transform:uppercase;margin-bottom:5px;display:flex;align-items:center;justify-content:space-between}
    .me-custom-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin-bottom:6px}
    .me-cpb{padding:6px 3px;border:none;border-radius:9px;cursor:pointer;background:rgba(124,58,237,0.07);border:1px solid rgba(124,58,237,0.2);color:rgba(255,255,255,0.5);font-size:9px;font-weight:700;letter-spacing:.1px;transition:all .18s;text-align:center;position:relative;overflow:hidden;padding-right:14px;white-space:nowrap;text-overflow:ellipsis}
    .me-cpb:hover{background:rgba(124,58,237,0.15);border-color:rgba(124,58,237,0.45);color:#fff;transform:translateY(-1px)}
    .me-cpb.active{background:linear-gradient(135deg,rgba(124,58,237,.28),rgba(0,212,255,.12));border-color:rgba(124,58,237,.65);color:#c084fc;box-shadow:0 0 14px rgba(124,58,237,.22)}
    .me-cpb-del{position:absolute;top:50%;right:4px;transform:translateY(-50%);font-size:9px;color:rgba(255,255,255,.25);line-height:1;cursor:pointer;padding:2px 3px;border-radius:3px;transition:all .15s;z-index:2}
    .me-cpb-del:hover{color:#ff5050;background:rgba(255,60,60,.15)}
    .me-cadd-btn{padding:5px 10px;border:none;border-radius:9px;cursor:pointer;background:rgba(124,58,237,0.06);border:1px dashed rgba(124,58,237,0.3);color:rgba(124,58,237,0.65);font-size:9.5px;font-weight:700;letter-spacing:.3px;transition:all .18s;display:flex;align-items:center;justify-content:center;gap:5px;width:100%}
    .me-cadd-btn:hover{background:rgba(124,58,237,0.14);border-color:rgba(124,58,237,0.55);color:#c084fc}
    #me-custom-form{background:rgba(124,58,237,0.07);border:1px solid rgba(124,58,237,0.22);border-radius:12px;padding:10px;margin-bottom:8px;display:none}
    #me-custom-form.show{display:block}
    .me-cform-row{display:flex;gap:7px;align-items:center}
    #me-custom-name{flex:1;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.15);border-radius:8px;color:#fff;font-size:11px;font-weight:600;padding:6px 10px;outline:none;font-family:inherit;transition:border-color .18s}
    #me-custom-name:focus{border-color:rgba(124,58,237,0.7)}
    #me-custom-name::placeholder{color:rgba(255,255,255,0.22)}
    .me-cform-hint{font-size:9px;color:rgba(255,255,255,.28);margin-top:6px;line-height:1.4}
    .me-csave-btn{padding:6px 12px;border:none;border-radius:8px;cursor:pointer;background:linear-gradient(135deg,rgba(124,58,237,.5),rgba(0,212,255,.3));color:#fff;font-size:10px;font-weight:700;letter-spacing:.3px;transition:all .18s;white-space:nowrap}
    .me-csave-btn:hover{background:linear-gradient(135deg,rgba(124,58,237,.7),rgba(0,212,255,.5));box-shadow:0 0 12px rgba(124,58,237,.3)}
    .me-ccancel-btn{padding:6px 8px;border:none;border-radius:8px;cursor:pointer;background:rgba(255,255,255,.06);color:rgba(255,255,255,.4);font-size:10px;font-weight:700;transition:all .18s}
    .me-ccancel-btn:hover{background:rgba(255,60,60,.15);color:#ff5050}
    .me-div{height:1px;background:rgba(255,255,255,.06);margin:7px 0}
    .me-cr{display:flex;align-items:center;gap:8px;margin-bottom:6px}
    .me-cl{font-size:10px;color:rgba(255,255,255,.4);min-width:52px}
    .me-cl b{color:rgba(255,255,255,.65)}
    .me-tb{padding:5px 13px;border-radius:20px;border:none;cursor:pointer;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);color:rgba(255,255,255,.5);font-size:10px;font-weight:700;letter-spacing:.3px;transition:all .2s;display:flex;align-items:center;gap:5px}
    .me-tb:hover{background:rgba(0,212,255,.1);border-color:rgba(0,212,255,.3);color:#fff}
    .me-tb.on{background:linear-gradient(135deg,rgba(0,212,255,.2),rgba(124,58,237,.2));border-color:rgba(0,212,255,.5);color:#00d4ff;box-shadow:0 0 12px rgba(0,212,255,.2)}
    .me-3dp{width:6px;height:6px;border-radius:50%;background:#00d4ff;animation:me3dp 1.6s ease-in-out infinite;display:none}
    .me-tb.on .me-3dp{display:inline-block}
    @keyframes me3dp{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.6);opacity:.5}}
    .me-amod-hdr{font-size:9.5px;font-weight:700;color:rgba(255,165,0,.8);letter-spacing:.8px;text-transform:uppercase;margin-bottom:5px;display:flex;align-items:center;gap:6px}
    .me-amod-hdr span{white-space:nowrap}
    .me-amod-hdr::before,.me-amod-hdr::after{content:'';flex:1;height:1px;background:rgba(255,165,0,.2)}
    .me-amod-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:5px;margin-bottom:8px}
    .me-amb{padding:7px 6px;border:none;border-radius:9px;cursor:pointer;background:rgba(255,165,0,0.05);border:1px solid rgba(255,165,0,0.15);color:rgba(255,255,255,0.5);font-size:10px;font-weight:700;letter-spacing:.2px;transition:all .18s;text-align:center}
    .me-amb:hover{background:rgba(255,165,0,0.12);border-color:rgba(255,165,0,0.4);color:#fff;transform:translateY(-2px)}
    .me-amb.active{background:linear-gradient(135deg,rgba(255,140,0,.25),rgba(200,60,0,.2));border-color:rgba(255,165,0,.75);color:#ffa500;box-shadow:0 0 16px rgba(255,140,0,.25)}
    .me-vr{display:flex;gap:6px;align-items:stretch;margin-top:3px}
    #me-vc{flex:1;height:42px;border-radius:8px;background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.07);display:block}
    #me-dv{width:42px;height:42px;border-radius:8px;object-fit:cover;border:1px solid rgba(255,165,0,.5);box-shadow:0 0 14px rgba(255,140,0,.35);flex-shrink:0;display:none;transition:opacity .3s}
    #me-dv.show{display:block}
    .me-tip{font-size:8.5px;color:rgba(255,193,7,.55);text-align:center;margin-top:5px;line-height:1.3}
    .me-conn-wrap{padding:0 0 8px}
    #me-gate{position:relative;z-index:1;padding:18px 16px 20px;display:flex;flex-direction:column;align-items:center;gap:0}
    #me-gate.hidden{display:none}
    .me-gate-star-icon{font-size:38px;line-height:1;margin-bottom:10px;filter:drop-shadow(0 0 14px rgba(255,193,7,.7));animation:me-star-pulse 2s ease-in-out infinite}
    @keyframes me-star-pulse{0%,100%{transform:scale(1) rotate(-4deg)}50%{transform:scale(1.12) rotate(4deg)}}
    .me-gate-title{font-size:14px;font-weight:800;letter-spacing:.3px;background:linear-gradient(90deg,#fff 0%,#ffd700 40%,#ffaa00 70%,#fff 100%);background-size:200% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:me-shimmer 3.5s linear infinite;margin-bottom:6px;text-align:center}
    .me-gate-sub{font-size:10.5px;color:rgba(255,255,255,.45);text-align:center;line-height:1.55;margin-bottom:16px;padding:0 4px}
    .me-gate-sub b{color:rgba(255,215,0,.75)}
    .me-gate-repo{display:flex;align-items:center;gap:7px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:7px 12px;margin-bottom:14px;width:100%}
    .me-gate-repo-icon{font-size:16px}
    .me-gate-repo-name{font-size:10px;color:rgba(255,255,255,.5);line-height:1.3}
    .me-gate-repo-name b{color:rgba(255,255,255,.8);font-size:11px;display:block}
    .me-gate-star-btn{width:100%;padding:11px 0;border:none;border-radius:13px;cursor:pointer;background:linear-gradient(135deg,#f6c90e,#f59500);color:#1a0e00;font-size:12px;font-weight:800;letter-spacing:.5px;transition:all .22s;box-shadow:0 4px 20px rgba(246,201,14,.35);margin-bottom:8px;display:flex;align-items:center;justify-content:center;gap:8px}
    .me-gate-star-btn:hover{transform:translateY(-2px);box-shadow:0 8px 28px rgba(246,201,14,.55);filter:brightness(1.08)}
    .me-gate-star-btn:active{transform:translateY(0) scale(.97)}
    .me-gate-done-btn{width:100%;padding:9px 0;border:none;border-radius:13px;cursor:pointer;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:rgba(255,255,255,.45);font-size:10.5px;font-weight:700;letter-spacing:.3px;transition:all .22s;display:none}
    .me-gate-done-btn.visible{display:block}
    .me-gate-done-btn:disabled{opacity:.4;cursor:not-allowed}
    .me-gate-done-btn:not(:disabled):hover{background:rgba(0,212,255,.1);border-color:rgba(0,212,255,.35);color:#00d4ff}
    .me-gate-note{font-size:8px;color:rgba(255,255,255,.2);text-align:center;margin-top:10px;line-height:1.4}
    .me-footer{position:relative;z-index:1;text-align:center;padding:7px 12px 10px;border-top:1px solid rgba(255,255,255,.06);font-size:9px;color:rgba(255,255,255,.28);letter-spacing:.2px}
    .me-footer span{color:rgba(255,100,100,.65)}
    .me-footer b{color:rgba(255,255,255,.4);font-weight:700}
    .me-conn-btn{width:100%;padding:9px;border:none;border-radius:11px;cursor:pointer;background:linear-gradient(135deg,rgba(0,212,255,.22),rgba(124,58,237,.18));border:1px solid rgba(0,212,255,.45);color:#fff;font-size:11px;font-weight:700;letter-spacing:.4px;transition:all .22s;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 0 20px rgba(0,212,255,.2)}
    .me-conn-btn:hover{background:linear-gradient(135deg,rgba(0,212,255,.38),rgba(124,58,237,.32));box-shadow:0 0 28px rgba(0,212,255,.38);transform:translateY(-1px)}
    .me-conn-btn:active{transform:translateY(0) scale(.98)}
    .me-conn-btn.me-connected{background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.1);color:rgba(255,255,255,.3);cursor:default;box-shadow:none;font-size:10px}
    .me-conn-btn.me-connected:hover{transform:none;background:rgba(255,255,255,.05);box-shadow:none}
    #me-conn-pulse{width:8px;height:8px;border-radius:50%;background:#00d4ff;flex-shrink:0;box-shadow:0 0 8px rgba(0,212,255,.9);animation:me-pulse 1.5s ease-in-out infinite}
    @keyframes me-pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.6);opacity:.5}}
  `;

  function buildUI() {
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);

    const root = document.createElement('div');
    root.id = 'me-root';

    const panel = document.createElement('div');
    panel.id = 'me-panel';
    panel.className = 'hidden';

    panel.innerHTML = `
      <div class="me-hdr">
        <div class="me-hl">
          <img src="${LOGO_URL}" class="me-logo" alt="">
          <span class="me-ttl">Music Enhancer</span>
          <span class="me-pill" id="me-pill">Waiting\u2026</span>
        </div>
        <button class="me-x" id="me-x">\u2715</button>
      </div>`;

    // ── Star Gate ────────────────────────────────────────────────────────────
    const gate = document.createElement('div');
    gate.id = 'me-gate';
    gate.className = 'hidden';
    gate.innerHTML = `
      <div class="me-gate-star-icon">\u2B50</div>
      <div class="me-gate-title">Unlock Music Enhancer</div>
      <div class="me-gate-sub">This feature is <b>free forever</b> \u2014 all we ask is a quick \u2b50 on GitHub to help others discover it!</div>
      <div class="me-gate-repo">
        <span class="me-gate-repo-icon">\uD83D\uDCE6</span>
        <div class="me-gate-repo-name"><b>Archimetrix / Youtube-Pro-Plus</b>github.com</div>
      </div>
      <button class="me-gate-star-btn" id="me-gate-star-btn">\u2B50 Star the Repository</button>
      <button class="me-gate-done-btn" id="me-gate-done-btn">I\u2019ve Starred it! \u2192 Open Music Enhancer</button>
      <div class="me-gate-note">Your star is checked once and stored locally. You won\u2019t be asked again.</div>`;
    panel.appendChild(gate);

    const body = document.createElement('div');
    body.className = 'me-body';
    body.id = 'me-body';

    // Volume
    const volDiv = document.createElement('div');
    volDiv.innerHTML = `
      <div class="me-vol-row">
        <div class="me-vl">Vol <b id="me-vv">100%</b></div>
        <div class="me-sw"><input type="range" class="me-sl" id="me-vol" min="0" max="3" step="0.05" value="1"></div>
      </div>`;
    body.appendChild(volDiv);

    // Radar
    const rw = document.createElement('div');
    rw.id = 'me-radar-wrap';
    rw.innerHTML = buildRadarSVG();
    body.appendChild(rw);

    // EQ Preset grid
    const grid = document.createElement('div');
    grid.className = 'me-grid';
    Object.keys(PRESETS).forEach(name => {
      const b = document.createElement('button');
      b.className = 'me-pb' + (name==='Normal'?' active':'');
      b.dataset.preset = name;
      b.textContent = name === 'Normal' ? '\u2715  Normal' : name;
      grid.appendChild(b);
    });
    body.appendChild(grid);

    // Custom EQ section
    const customWrap = document.createElement('div');
    customWrap.id = 'me-custom-wrap';

    const customHdr = document.createElement('div');
    customHdr.className = 'me-custom-hdr';
    customHdr.innerHTML = `<span>Custom EQ</span><span style="color:rgba(255,255,255,.18);font-size:9px;font-weight:400">max 4</span>`;
    customWrap.appendChild(customHdr);

    const customGrid = document.createElement('div');
    customGrid.className = 'me-custom-grid';
    customGrid.id = 'me-custom-grid';
    customWrap.appendChild(customGrid);

    const addForm = document.createElement('div');
    addForm.id = 'me-custom-form';
    addForm.innerHTML = `
      <div class="me-cform-row">
        <input id="me-custom-name" type="text" placeholder="Preset name\u2026" maxlength="14" autocomplete="off" spellcheck="false">
        <button class="me-csave-btn" id="me-csave-btn">Save EQ</button>
        <button class="me-ccancel-btn" id="me-ccancel-btn">\u2715</button>
      </div>
      <div class="me-cform-hint">Saves your current radar EQ settings as a preset</div>`;
    customWrap.appendChild(addForm);

    const addBtn = document.createElement('button');
    addBtn.className = 'me-cadd-btn';
    addBtn.id = 'me-cadd-btn';
    addBtn.innerHTML = `<span style="font-size:14px;line-height:1">+</span> Add Custom Preset`;
    customWrap.appendChild(addBtn);

    body.appendChild(customWrap);

    // Divider + Balance + Effects
    const effects = document.createElement('div');
    effects.innerHTML = `
      <div class="me-div"></div>
      <div class="me-cr">
        <div class="me-cl">Balance <b id="me-bv">C</b></div>
        <div class="me-sw"><input type="range" class="me-sl" id="me-bal" min="-1" max="1" step="0.05" value="0"></div>
      </div>
      <div class="me-cr" style="margin-bottom:6px">
        <div class="me-cl">Effects</div>
        <button class="me-tb" id="me-3d">\uD83C\uDFA7 3D Audio <span class="me-3dp"></span></button>
        <button class="me-tb" id="me-mono">\u2295 Mono</button>
      </div>`;
    body.appendChild(effects);

    // AudioMod section
    const amodWrap = document.createElement('div');
    amodWrap.innerHTML = `<div class="me-amod-hdr"><span>AudioMod</span></div>`;
    const amodGrid = document.createElement('div');
    amodGrid.className = 'me-amod-grid';
    Object.keys(AUDIOMODS).forEach(name => {
      const b = document.createElement('button');
      b.className = 'me-amb';
      b.dataset.mod = name;
      b.textContent = name;
      amodGrid.appendChild(b);
    });
    amodWrap.appendChild(amodGrid);
    body.appendChild(amodWrap);

    // Connect button — visible when not connected, muted when connected
    const connWrap = document.createElement('div');
    connWrap.className = 'me-conn-wrap';
    const connBtn = document.createElement('button');
    connBtn.className = 'me-conn-btn';
    connBtn.id = 'me-conn-btn';
    connBtn.innerHTML = '<span id="me-conn-pulse"></span> \uD83D\uDD0C Connect Audio';
    connBtn.onclick = () => manualConnect();
    connWrap.appendChild(connBtn);
    body.appendChild(connWrap);

        // Visualizer + dancing video
    const vis = document.createElement('div');
    vis.innerHTML = `
      <div class="me-vr">
        <canvas id="me-vc" width="222" height="54"></canvas>
        <video id="me-dv" autoplay loop muted playsinline></video>
      </div>
      <div class="me-tip">\u26A0 High bass boost at max volume may cause distortion</div>`;
    body.appendChild(vis);

    panel.appendChild(body);

    // ── Footer ───────────────────────────────────────────────────────────────
    const footer = document.createElement('div');
    footer.className = 'me-footer';
    footer.innerHTML = 'Made with <span>\u2764\uFE0F</span> by <b>archimetrix</b>';
    panel.appendChild(footer);

    root.appendChild(panel);
    document.body.appendChild(root);

    document.getElementById('me-dv').src = VIDEO_URL;

    // Events
    document.getElementById('me-x').onclick = () => togglePanel(false);

    // ── Gate wiring ──────────────────────────────────────────────────────────
    const GATE_KEY = 'me_github_starred';
    const GITHUB_URL = 'https://github.com/Archimetrix/Youtube-Pro-Plus';

    function showGate() {
      const g = document.getElementById('me-gate');
      const b = document.getElementById('me-body');
      if (g) g.classList.remove('hidden');
      if (b) b.style.display = 'none';
    }

    function unlockAndShow() {
      browser.storage.local.set({ [GATE_KEY]: true });
      const g = document.getElementById('me-gate');
      const b = document.getElementById('me-body');
      if (g) g.classList.add('hidden');
      if (b) b.style.display = '';
    }

    document.getElementById('me-gate-star-btn').onclick = () => {
      window.open(GITHUB_URL, '_blank');

      // Show the done button and start a 5-second countdown
      const doneBtn = document.getElementById('me-gate-done-btn');
      doneBtn.classList.add('visible');
      doneBtn.disabled = true;

      let secs = 5;
      const originalText = "I\u2019ve Starred it! \u2192 Open Music Enhancer";
      doneBtn.textContent = `Please wait ${secs}s\u2026`;

      const tick = setInterval(() => {
        secs--;
        if (secs > 0) {
          doneBtn.textContent = `Please wait ${secs}s\u2026`;
        } else {
          clearInterval(tick);
          doneBtn.disabled = false;
          doneBtn.textContent = originalText;
        }
      }, 1000);
    };

    document.getElementById('me-gate-done-btn').onclick = () => {
      unlockAndShow();
    };

    // Check on each panel open whether the gate has been passed
    window._meCheckGate = () => {
      browser.storage.local.get([GATE_KEY], (res) => {
        if (res[GATE_KEY]) {
          unlockAndShow();
        } else {
          showGate();
        }
      });
    };
    window._meCheckGate();

    const volSl = document.getElementById('me-vol');
    volSl.oninput = () => {
      volume = parseFloat(volSl.value);
      document.getElementById('me-vv').textContent = Math.round(volume*100)+'%';
      if (gainNode) gainNode.gain.value = volume;
      fill(volSl);
    };
    fill(volSl);

    const balSl = document.getElementById('me-bal');
    balSl.oninput = () => {
      balance = parseFloat(balSl.value);
      const ab = Math.abs(balance);
      document.getElementById('me-bv').textContent = ab<.04?'C':balance<0?'L'+Math.round(ab*100):'R'+Math.round(ab*100);
      if (!audio3DOn) applyBalance(balance);
      fill(balSl);
    };
    fill(balSl);

    // EQ preset buttons - toggle behaviour (like AudioMods)
    document.querySelectorAll('#me-root .me-pb').forEach(b =>
      b.onclick = () => applyPreset(b.dataset.preset));

    // AudioMod buttons
    document.querySelectorAll('#me-root .me-amb').forEach(b =>
      b.onclick = () => toggleAudioMod(b.dataset.mod));

    document.getElementById('me-3d').onclick = () => {
      audio3DOn = !audio3DOn;
      document.getElementById('me-3d').classList.toggle('on', audio3DOn);
      audio3DOn ? start3D() : stop3D();
    };

    document.getElementById('me-mono').onclick = () => {
      monoOn = !monoOn;
      document.getElementById('me-mono').classList.toggle('on', monoOn);
      applyMono();
    };

    // Custom EQ events
    document.getElementById('me-cadd-btn').onclick = () => openAddForm();
    document.getElementById('me-csave-btn').onclick = () => saveCustomPreset();
    document.getElementById('me-ccancel-btn').onclick = () => closeAddForm();
    document.getElementById('me-custom-name').onkeydown = (e) => {
      if (e.key === 'Enter') saveCustomPreset();
      if (e.key === 'Escape') closeAddForm();
    };

    wireRadar();
    startVis();
    loadCustomPresets();
  }

  // Radar
  const CX=120, CY=112, R=76;
  const AXES = {
    mid:    {dx:0,     dy:-1,   lx:CX,     ly:CY-R-16, vx:CX,     vy:CY-R-5 },
    bass:   {dx:.866,  dy:.5,   lx:CX+R+14,ly:CY+R*.5+2,vx:CX+R+12,vy:CY+R*.5+13},
    treble: {dx:-.866, dy:.5,   lx:CX-R-20,ly:CY+R*.5+2,vx:CX-R-22,vy:CY+R*.5+13},
  };

  function dotPos(k) {
    const a=AXES[k], t=radarGains[k]/15;
    return {x:CX+t*R*a.dx, y:CY+t*R*a.dy};
  }

  function buildRadarSVG() {
    const rings=[R*.33,R*.67,R];
    const rs=rings.map(r=>`<circle cx="${CX}" cy="${CY}" r="${r}" class="r-ring"/>`).join('');
    const as=Object.values(AXES).map(a=>`<line x1="${CX}" y1="${CY}" x2="${CX+a.dx*R}" y2="${CY+a.dy*R}" class="r-axis"/>`).join('');
    return `<svg id="me-svg" viewBox="0 0 240 240" width="190" height="190">
      ${rs}${as}
      <polygon id="me-poly" class="r-poly" points="${CX},${CY} ${CX},${CY} ${CX},${CY}"/>
      <text class="r-lbl" text-anchor="middle" x="${AXES.mid.lx}"    y="${AXES.mid.ly}">Mid</text>
      <text class="r-lbl" text-anchor="middle" x="${AXES.bass.lx}"   y="${AXES.bass.ly}">Bass</text>
      <text class="r-lbl" text-anchor="middle" x="${AXES.treble.lx}" y="${AXES.treble.ly}">Treble</text>
      <text class="r-val" id="rv-mid"    text-anchor="middle" x="${AXES.mid.vx}"    y="${AXES.mid.vy}">+0</text>
      <text class="r-val" id="rv-bass"   text-anchor="middle" x="${AXES.bass.vx}"   y="${AXES.bass.vy}">+0</text>
      <text class="r-val" id="rv-treble" text-anchor="middle" x="${AXES.treble.vx}" y="${AXES.treble.vy}">+0</text>
      <circle id="rd-mid"    class="r-dot" cx="${CX}" cy="${CY}" r="6.5"/>
      <circle id="rd-bass"   class="r-dot" cx="${CX}" cy="${CY}" r="6.5"/>
      <circle id="rd-treble" class="r-dot" cx="${CX}" cy="${CY}" r="6.5"/>
    </svg>`;
  }

  function updateRadar() {
    const poly=document.getElementById('me-poly'); if(!poly)return;
    const keys=['mid','bass','treble'];
    poly.setAttribute('points', keys.map(k=>{const p=dotPos(k);return`${p.x},${p.y}`;}).join(' '));
    keys.forEach(k=>{
      const p=dotPos(k);
      const d=document.getElementById(`rd-${k}`), v=document.getElementById(`rv-${k}`);
      if(d){d.setAttribute('cx',p.x);d.setAttribute('cy',p.y);}
      if(v)v.textContent=(radarGains[k]>=0?'+':'')+radarGains[k];
    });
  }

  function wireRadar() {
    let drag=null;
    const svg=document.getElementById('me-svg'); if(!svg)return;
    const sp=e=>{
      const r=svg.getBoundingClientRect();
      const cx=e.touches?e.touches[0].clientX:e.clientX;
      const cy=e.touches?e.touches[0].clientY:e.clientY;
      return{x:(cx-r.left)*(240/r.width),y:(cy-r.top)*(240/r.height)};
    };
    const proj=(px,py,k)=>{
      const a=AXES[k],p=(px-CX)*a.dx+(py-CY)*a.dy;
      return Math.round(Math.max(-15,Math.min(15,(p/R)*15)));
    };
    ['mid','bass','treble'].forEach(k=>{
      const d=document.getElementById(`rd-${k}`); if(!d)return;
      const dn=e=>{e.preventDefault();drag=k;d.setAttribute('r','9');};
      d.addEventListener('mousedown',dn);
      d.addEventListener('touchstart',dn,{passive:false});
    });
    const mv=e=>{
      if(!drag)return; e.preventDefault();
      const {x,y}=sp(e);
      radarGains[drag]=proj(x,y,drag);
      updateRadar(); applyRadarGains();
      // Keep advBands in sync so "Save EQ" captures the live radar values
      BASS_IDX.forEach(i => advBands[i] = radarGains.bass);
      MID_IDX.forEach(i  => advBands[i] = radarGains.mid);
      TREBLE_IDX.forEach(i => advBands[i] = radarGains.treble);
      document.querySelectorAll('#me-root .me-pb').forEach(b=>b.classList.remove('active'));
      document.querySelectorAll('#me-root .me-cpb').forEach(b=>b.classList.remove('active'));
      currentPreset = null;
    };
    const up=()=>{
      if(drag){const d=document.getElementById(`rd-${drag}`);if(d)d.setAttribute('r','6.5');drag=null;}
    };
    document.addEventListener('mousemove',mv);
    document.addEventListener('mouseup',up);
    document.addEventListener('touchmove',mv,{passive:false});
    document.addEventListener('touchend',up);
  }

  function applyRadarGains() {
    if(!eqFilters.length)return;
    BASS_IDX.forEach(i=>eqFilters[i].gain.value=radarGains.bass);
    MID_IDX.forEach(i=>eqFilters[i].gain.value=radarGains.mid);
    TREBLE_IDX.forEach(i=>eqFilters[i].gain.value=radarGains.treble);
  }

  // EQ Presets - toggle on/off like AudioMods
  function applyPreset(name) {
    // Toggle off: clicking the already-active preset turns it off (go back to Normal)
    if (currentPreset === name && name !== 'Normal') {
      _applyFlatEQ();
      currentPreset = 'Normal';
      _syncPresetButtons('Normal');
      setDancingVideo(false);
      return;
    }
    const vals = PRESETS[name]; if (!vals) return;
    currentPreset = name;
    advBands = [...vals];
    eqFilters.forEach((f,i)=>{ if(f) f.gain.value = advBands[i]; });
    radarGains.bass   = Math.round((advBands[0]+advBands[1]+advBands[2])/3);
    radarGains.mid    = Math.round((advBands[3]+advBands[4]+advBands[5])/3);
    radarGains.treble = Math.round((advBands[6]+advBands[7]+advBands[8]+advBands[9])/4);
    updateRadar();
    _syncPresetButtons(name);
    setDancingVideo(name !== 'Normal');
  }

  // Custom preset - toggle on/off
  function applyCustomPreset(idx) {
    const cp = customPresets[idx]; if (!cp) return;
    const name = '__custom__' + idx;

    if (currentPreset === name) {
      _applyFlatEQ();
      currentPreset = 'Normal';
      _syncPresetButtons('Normal');
      setDancingVideo(false);
      return;
    }

    currentPreset = name;
    advBands = [...cp.gains];
    eqFilters.forEach((f,i)=>{ if(f) f.gain.value = advBands[i]; });
    radarGains.bass   = Math.round((advBands[0]+advBands[1]+advBands[2])/3);
    radarGains.mid    = Math.round((advBands[3]+advBands[4]+advBands[5])/3);
    radarGains.treble = Math.round((advBands[6]+advBands[7]+advBands[8]+advBands[9])/4);
    updateRadar();
    document.querySelectorAll('#me-root .me-pb').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('#me-root .me-cpb').forEach((b,i)=>{
      b.classList.toggle('active', i === idx);
    });
    setDancingVideo(true);
  }

  function _applyFlatEQ() {
    advBands = new Array(10).fill(0);
    radarGains = {bass:0, mid:0, treble:0};
    eqFilters.forEach(f=>{ if(f) f.gain.value=0; });
    updateRadar();
  }

  function _syncPresetButtons(activeName) {
    document.querySelectorAll('#me-root .me-pb').forEach(b=>{
      b.classList.toggle('active', b.dataset.preset === activeName);
    });
    document.querySelectorAll('#me-root .me-cpb').forEach(b=>b.classList.remove('active'));
  }

  // Custom EQ - localStorage
  function loadCustomPresets() {
    try {
      const raw = localStorage.getItem(CUSTOM_STORAGE_KEY);
      customPresets = raw ? JSON.parse(raw) : [];
    } catch(e) { customPresets = []; }
    renderCustomPresets();
  }

  function persistCustomPresets() {
    try { localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(customPresets)); } catch(e) {}
  }

  function renderCustomPresets() {
    const grid = document.getElementById('me-custom-grid'); if (!grid) return;
    grid.innerHTML = '';
    customPresets.forEach((cp, idx) => {
      const btn = document.createElement('button');
      btn.className = 'me-cpb' + (currentPreset === '__custom__'+idx ? ' active' : '');
      btn.dataset.idx = idx;

      const label = document.createElement('span');
      label.textContent = cp.name;
      btn.appendChild(label);

      const del = document.createElement('span');
      del.className = 'me-cpb-del';
      del.textContent = '\u2715';
      del.title = 'Delete preset';
      del.onclick = (e) => { e.stopPropagation(); deleteCustomPreset(idx); };
      btn.appendChild(del);

      btn.onclick = () => applyCustomPreset(idx);
      grid.appendChild(btn);
    });

    const addBtn = document.getElementById('me-cadd-btn');
    if (addBtn) addBtn.style.display = customPresets.length >= 4 ? 'none' : 'flex';
  }

  function openAddForm() {
    const form = document.getElementById('me-custom-form');
    const addBtn = document.getElementById('me-cadd-btn');
    if (form) form.classList.add('show');
    if (addBtn) addBtn.style.display = 'none';
    const inp = document.getElementById('me-custom-name');
    if (inp) { inp.value = ''; setTimeout(()=>inp.focus(), 80); }
    addingCustom = true;
  }

  function closeAddForm() {
    const form = document.getElementById('me-custom-form');
    if (form) form.classList.remove('show');
    const addBtn = document.getElementById('me-cadd-btn');
    if (addBtn && customPresets.length < 3) addBtn.style.display = 'flex';
    addingCustom = false;
  }

  function saveCustomPreset() {
    if (customPresets.length >= 4) return;
    const inp = document.getElementById('me-custom-name');
    const name = (inp ? inp.value.trim() : '') || ('Custom ' + (customPresets.length + 1));
    customPresets.push({ name, gains: [...advBands] });
    persistCustomPresets();
    closeAddForm();
    renderCustomPresets();
  }

  function deleteCustomPreset(idx) {
    if (currentPreset === '__custom__'+idx) {
      _applyFlatEQ();
      currentPreset = 'Normal';
      _syncPresetButtons('Normal');
      setDancingVideo(false);
    }
    customPresets.splice(idx, 1);
    if (currentPreset && currentPreset.startsWith('__custom__')) {
      const ci = parseInt(currentPreset.replace('__custom__',''));
      if (ci > idx) currentPreset = '__custom__'+(ci-1);
    }
    persistCustomPresets();
    renderCustomPresets();
  }

  // AudioMod
  function toggleAudioMod(name) {
    if (activeAudioMod === name) {
      activeAudioMod = null;
      if (mediaEl) mediaEl.playbackRate = 1.0;
      setReverbWet(0);
      document.querySelectorAll('#me-root .me-amb').forEach(b=>b.classList.remove('active'));
      setDancingVideo(currentPreset && currentPreset !== 'Normal');
      return;
    }
    activeAudioMod = name;
    const mod = AUDIOMODS[name];
    if (mediaEl) mediaEl.playbackRate = mod.rate;
    if (mod.reverb) {
      if (convolverNode && audioCtx) convolverNode.buffer = createImpulseResponse(audioCtx, mod.reverbType);
      setReverbWet(mod.reverbType === 'hall' ? 0.55 : 0.45);
    } else {
      setReverbWet(0);
    }
    document.querySelectorAll('#me-root .me-amb').forEach(b=>b.classList.toggle('active', b.dataset.mod===name));
    setDancingVideo(true);
  }

  function setDancingVideo(show) {
    const vid = document.getElementById('me-dv');
    if (!vid) return;
    if (show) { vid.classList.add('show'); vid.play().catch(()=>{}); }
    else { vid.classList.remove('show'); vid.pause(); }
  }

  function setReverbWet(wet) {
    if (!audioCtx) return;
    if (reverbGainNode) reverbGainNode.gain.setTargetAtTime(wet, audioCtx.currentTime, 0.05);
    if (dryGainNode) dryGainNode.gain.setTargetAtTime(wet > 0 ? (1 - wet * 0.5) : 1.0, audioCtx.currentTime, 0.05);
  }

  // 3D Audio
  const HRTF_RADIUS = 4;
  const HRTF_PERIOD = 5000;

  function start3D() {
    if (audio3DRaf) return;
    if (!audioCtx || !hrtfPanner) return;
    audioCtx.listener.setPosition(0, 0, 0);
    if (audioCtx.listener.forwardX) {
      audioCtx.listener.forwardX.value = 0; audioCtx.listener.forwardY.value = 0; audioCtx.listener.forwardZ.value = -1;
      audioCtx.listener.upX.value = 0; audioCtx.listener.upY.value = 1; audioCtx.listener.upZ.value = 0;
    } else { audioCtx.listener.setOrientation(0, 0, -1, 0, 1, 0); }
    audio3DStart = performance.now();
    const tick = now => {
      if (!audio3DOn) return;
      const t = (now - audio3DStart) / HRTF_PERIOD;
      const angle = 2 * Math.PI * t;
      const x = HRTF_RADIUS * Math.sin(angle);
      const y = HRTF_RADIUS * Math.sin(angle * 0.5) * 0.3;
      const z = HRTF_RADIUS * Math.cos(angle);
      if (hrtfPanner.positionX) {
        hrtfPanner.positionX.value = x; hrtfPanner.positionY.value = y; hrtfPanner.positionZ.value = z;
      } else { hrtfPanner.setPosition(x, y, z); }
      audio3DRaf = requestAnimationFrame(tick);
    };
    audio3DRaf = requestAnimationFrame(tick);
  }

  function stop3D() {
    if (audio3DRaf) { cancelAnimationFrame(audio3DRaf); audio3DRaf = null; }
    if (hrtfPanner) {
      if (hrtfPanner.positionX) {
        hrtfPanner.positionX.value = 0; hrtfPanner.positionY.value = 0; hrtfPanner.positionZ.value = -HRTF_RADIUS;
      } else { hrtfPanner.setPosition(0, 0, -HRTF_RADIUS); }
    }
    applyBalance(balance);
  }

  function applyBalance(val) { if (!pannerNode) return; pannerNode.pan.value = monoOn ? 0 : val; }
  function applyMono() {
    if (monoOn) { if (audio3DOn) stop3D(); applyBalance(0); }
    else { applyBalance(balance); if (audio3DOn) start3D(); }
  }

  // Reverb impulse response
  function createImpulseResponse(ctx, type) {
    const sr = ctx.sampleRate;
    let duration, decay, preDelay;
    if (type === 'hall') { duration=5.0; decay=1.6; preDelay=Math.floor(sr*0.04); }
    else { duration=3.2; decay=2.5; preDelay=Math.floor(sr*0.01); }
    const len = Math.floor(sr * duration) + preDelay;
    const buf = ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const data = buf.getChannelData(c);
      for (let i = 0; i < preDelay; i++) data[i] = 0;
      if (type === 'hall') {
        // Low-pass filtered noise: running average kills high-freq hiss
        // giving a warm, smooth hall tail instead of white-noise hiss
        let runAvg = 0;
        const lpCoeff = 0.08; // lower = more LP filtering = less hiss
        for (let i = preDelay; i < len; i++) {
          const t = i - preDelay;
          const env = Math.pow(1 - t / (len - preDelay), decay);
          runAvg = runAvg * (1 - lpCoeff) + (Math.random() * 2 - 1) * lpCoeff;
          data[i] = runAvg * env;
        }
        // Subtle early reflections
        [0.017,0.023,0.031,0.041,0.055].map(t=>Math.floor(t*sr)+preDelay).forEach(tap=>{
          if (tap<len) data[tap] += (Math.random()*0.4+0.2)*(c===0?1:-0.7);
        });
      } else {
        for (let i = preDelay; i < len; i++) {
          const t = i - preDelay;
          data[i] = (Math.random()*2-1) * Math.pow(1-t/(len-preDelay), decay);
        }
      }
    }
    return buf;
  }

  // Update the connect button to reflect current connection state
  function syncConnBtn() {
    const btn = document.getElementById('me-conn-btn');
    if (!btn) return;
    if (isConnected) {
      btn.className = 'me-conn-btn me-connected';
      btn.innerHTML = '\u2705 Audio Connected';
    } else {
      btn.className = 'me-conn-btn';
      btn.innerHTML = '<span id="me-conn-pulse"></span> \uD83D\uDD0C Connect Audio';
    }
  }

  // Pick the real YouTube player <video>, not thumbnail/preview elements
  function getPlayerVideo() {
    // YouTube's actual player video element
    const ytVideo = document.querySelector('#movie_player video, .html5-main-video');
    if (ytVideo) return ytVideo;
    // Fallback: any video that has a src and isn't tiny (thumbnail previews are hidden/small)
    const videos = Array.from(document.querySelectorAll('video'));
    const playing = videos.find(v => !v.paused && v.readyState >= 2);
    if (playing) return playing;
    const hasSrc = videos.find(v => (v.src || v.currentSrc) && v.offsetWidth > 100);
    if (hasSrc) return hasSrc;
    return videos[0] || document.querySelector('audio') || null;
  }

  let _pendingConnectObserver = null;

  // Manual connect — invoked by the button; handles suspended AudioContext
  function manualConnect() {
    if (isConnected) {
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
      syncConnBtn();
      return;
    }

    // Clear any previous pending observer
    if (_pendingConnectObserver) { _pendingConnectObserver.disconnect(); _pendingConnectObserver = null; }

    tryConnect();

    if (isConnected && audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }

    if (!isConnected) {
      // No video playing yet — set up a watcher so we auto-connect the moment one starts
      const btn = document.getElementById('me-conn-btn');
      if (btn) {
        btn.style.borderColor = 'rgba(255,165,0,.7)';
        btn.innerHTML = '\u23F3 Waiting for video\u2026';
      }

      const onPlay = (e) => {
        const el = e.target;
        if (!el || (el.tagName !== 'VIDEO' && el.tagName !== 'AUDIO')) return;
        // Only care about the real player, not tiny thumbnail videos
        if (el.tagName === 'VIDEO' && el.offsetWidth > 0 && el.offsetWidth < 80) return;
        document.removeEventListener('play', onPlay, true);
        if (_pendingConnectObserver) { _pendingConnectObserver.disconnect(); _pendingConnectObserver = null; }
        tryConnect();
        if (isConnected && audioCtx && audioCtx.state === 'suspended') {
          audioCtx.resume().catch(() => {});
        }
        if (!isConnected && btn) {
          btn.style.borderColor = 'rgba(255,60,60,.7)';
          btn.innerHTML = '<span id="me-conn-pulse"></span> \uD83D\uDD0C Connect Audio';
          btn.style.borderColor = '';
        }
      };
      // Capture phase so we catch the play event before YouTube can swallow it
      document.addEventListener('play', onPlay, true);

      // Safety timeout — stop waiting after 60 s and reset the button
      setTimeout(() => {
        document.removeEventListener('play', onPlay, true);
        if (!isConnected && btn) {
          btn.innerHTML = '<span id="me-conn-pulse"></span> \uD83D\uDD0C Connect Audio';
          btn.style.borderColor = '';
        }
      }, 60000);
    }
  }

  // Audio init
  function tryConnect() {
    if (isConnected) return;
    const el = getPlayerVideo(); if (!el) return;
    mediaEl = el;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      sourceNode = audioCtx.createMediaElementSource(mediaEl);

      eqFilters = FREQ_BANDS.map((freq, i) => {
        const f = audioCtx.createBiquadFilter();
        f.type = i===0 ? 'lowshelf' : i===9 ? 'highshelf' : 'peaking';
        f.frequency.value = freq;
        if (f.type === 'peaking') f.Q.value = 1.4;
        f.gain.value = 0;
        return f;
      });

      gainNode = audioCtx.createGain(); gainNode.gain.value = volume;

      hrtfPanner = audioCtx.createPanner();
      hrtfPanner.panningModel='HRTF'; hrtfPanner.distanceModel='inverse';
      hrtfPanner.refDistance=HRTF_RADIUS; hrtfPanner.maxDistance=10000; hrtfPanner.rolloffFactor=0;
      hrtfPanner.coneInnerAngle=360; hrtfPanner.coneOuterAngle=0; hrtfPanner.coneOuterGain=0;
      if (hrtfPanner.positionX) {
        hrtfPanner.positionX.value=0; hrtfPanner.positionY.value=0; hrtfPanner.positionZ.value=-HRTF_RADIUS;
      } else { hrtfPanner.setPosition(0, 0, -HRTF_RADIUS); }

      pannerNode = audioCtx.createStereoPanner(); pannerNode.pan.value = balance;
      dryGainNode = audioCtx.createGain(); dryGainNode.gain.value = 1.0;
      convolverNode = audioCtx.createConvolver(); convolverNode.buffer = createImpulseResponse(audioCtx, 'room');
      reverbGainNode = audioCtx.createGain(); reverbGainNode.gain.value = 0;
      analyserNode = audioCtx.createAnalyser(); analyserNode.fftSize = 256;

      let prev = sourceNode;
      eqFilters.forEach(f => { prev.connect(f); prev = f; });
      prev.connect(gainNode);
      gainNode.connect(hrtfPanner);
      hrtfPanner.connect(pannerNode);
      pannerNode.connect(dryGainNode);
      dryGainNode.connect(analyserNode);
      pannerNode.connect(convolverNode);
      convolverNode.connect(reverbGainNode);
      reverbGainNode.connect(analyserNode);
      analyserNode.connect(audioCtx.destination);

      isConnected = true;
      syncConnBtn();
      audioCtx.resume().catch(() => {});

      // Auto-resume the AudioContext whenever the media element starts playing.
      // This is the key fix for Scenario 1: connecting before a video plays leaves
      // the AudioContext suspended; the 'play' event brings it back to life.
      mediaEl.addEventListener('play', () => {
        if (audioCtx && audioCtx.state === 'suspended') {
          audioCtx.resume().catch(() => {});
        }
      });

      const pill = document.getElementById('me-pill');
      if (pill) { pill.textContent='Live \u25CF'; pill.classList.add('live'); }

      applyPreset(currentPreset || 'Normal');
      if (activeAudioMod) {
        const mod = AUDIOMODS[activeAudioMod];
        mediaEl.playbackRate = mod.rate;
        if (mod.reverb) {
          convolverNode.buffer = createImpulseResponse(audioCtx, mod.reverbType);
          setReverbWet(mod.reverbType === 'hall' ? 0.70 : 0.45);
        }
      }
    } catch(e) { console.warn('[Music Enhancer]', e); }
  }

  // Visualizer
  function startVis() {
    const cv = document.getElementById('me-vc'); if (!cv) return;
    const ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
    let last = new Uint8Array(128).fill(0);
    const draw = () => {
      requestAnimationFrame(draw);
      ctx.clearRect(0,0,W,H);
      if (analyserNode && panelVisible) analyserNode.getByteFrequencyData(last);
      else for (let i=0;i<last.length;i++) last[i]=Math.max(0,last[i]-6);
      const bw = W/last.length;
      for (let i=0;i<last.length;i++) {
        const h=(last[i]/255)*H, hue=(i/last.length)*200+180;
        const g=ctx.createLinearGradient(0,H-h,0,H);
        g.addColorStop(0,`hsla(${hue},100%,70%,.95)`);
        g.addColorStop(1,`hsla(${hue},100%,40%,.2)`);
        ctx.fillStyle=g;
        ctx.beginPath();
        ctx.roundRect(i*bw+.5,H-h,Math.max(bw-1,1),h,1.5);
        ctx.fill();
      }
    };
    draw();
  }

  function fill(sl) {
    const mn=parseFloat(sl.min),mx=parseFloat(sl.max),v=parseFloat(sl.value);
    const p=((v-mn)/(mx-mn))*100;
    sl.style.background=`linear-gradient(to right,#00d4ff 0%,#7c3aed ${p}%,rgba(255,255,255,.1) ${p}%)`;
  }

  function togglePanel(force) {
    panelVisible = force!==undefined ? force : !panelVisible;
    const p = document.getElementById('me-panel');
    if (p) p.classList.toggle('hidden', !panelVisible);
    if (panelVisible) {
      updateRadar();
      syncConnBtn();
      // Re-check gate every time panel opens (in case they just starred it)
      if (typeof window._meCheckGate === 'function') window._meCheckGate();
    }
    return panelVisible;
  }

  // ── Boot ───────────────────────────────────────────────────────────────────

  // Respect YT Pro+ audio toggle: if it's off, don't build the UI at all
  browser.storage.local.get(['masterEnabled', 'audio'], (result) => {
    if (result.masterEnabled === false) return;
    if (result.audio === false) return;

    buildUI();
    updateRadar();
  });

  // Alt+M shortcut — capture phase so YouTube's handler doesn't steal it
  document.addEventListener('keydown', e => {
    if (e.target.tagName==='INPUT' || e.target.tagName==='TEXTAREA') return;
    if (e.altKey && (e.key==='m' || e.key==='M')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      togglePanel();
    }
  }, true);

  // Messages from the YT Pro+ popup and content.js
  browser.runtime.onMessage.addListener((msg, _s, reply) => {
    if (msg.action === 'toggle') {
      reply({ visible: togglePanel() });
    } else if (msg.action === 'getStatus') {
      reply({ connected: isConnected, visible: panelVisible });
    } else if (msg.action === 'masterToggleChanged' && !msg.state) {
      togglePanel(false);
    } else if (msg.action === 'toggleaudio') {
      if (!msg.state) {
        togglePanel(false);
      } else if (!document.getElementById('me-root')) {
        buildUI();
        updateRadar();
      }
    }
    return true;
  });
})();
