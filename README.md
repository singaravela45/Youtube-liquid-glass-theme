<div align="center">
  <img src="imgs/logo.png" alt="YouTube Pro Plus Logo" width="150"/>
  <h1> YouTube Pro Plus</h1>

  ![Version](https://img.shields.io/badge/version-1.0-blue.svg)
  ![Platform](https://img.shields.io/badge/platform-Firefox%20(Chromium%20Deprecated)-green.svg)
  ![License](https://img.shields.io/badge/license-MIT-yellow.svg)
</div>

**YouTube Pro +** is an all-in-one, highly optimized extension designed to completely overhaul your YouTube experience. It makes your life so smooth with useful features and a stylish theme all into one centralized, lightweight extension with a beautiful **Liquid Glass** UI.

<div align="center">
  <img src="imgs/interface.png" alt="YouTube Pro Plus Interface" width="300"/>
</div>

---

> ⚠️ **IMPORTANT BROWSER SUPPORT NOTICE** ⚠️
> As this project will become increasingly complex in the future, maintaining both Firefox and Chrome/Chromium versions simultaneously is no longer possible. **Moving forward, only the Firefox version will receive new features and bug fixes.**
> 
> For the best performance and continued support, we strongly recommend switching to **Firefox** or Firefox-based browsers (such as **Floorp**, **Waterfox**,**Zen** or **LibreWolf**).

---

## 📥 Download

<a href="https://addons.mozilla.org/en-US/firefox/addon/youtube-pro-plus/">
  <img src="https://blog.mozilla.org/addons/files/2020/04/get-the-addon-fx-apr-2020.svg" alt="Get the Add-on for Firefox" height="56">
</a>
<a href="https://github.com/Archimetrix/Youtube-Pro-Plus/archive/refs/heads/main.zip">
  <img src="https://img.shields.io/badge/Download_ZIP-101010?style=for-the-badge&logo=github&logoColor=white" alt="Download ZIP" height="56">
</a>

> **Note:** Currently available officially on the Firefox Add-ons store. For legacy Chrome, Edge, and Opera users, please use the **Download ZIP** button above and follow the quick **Local Installation** guide below (Note: Chromium versions are no longer actively updated).

---

## 🎥 Watch it in Action
Click the image below to watch the full showcase and installation guide on YouTube:

[![YouTube Pro Plus Showcase](https://img.youtube.com/vi/cHCqhWl-Dwk/maxresdefault.jpg)](https://www.youtube.com/watch?v=cHCqhWl-Dwk)

---

## ✨ Key Features

* **🎨 Liquid Glass Theme:** A gorgeous, system-wide glassmorphism redesign of YouTube. Features beautifully rounded corners, blurred dynamic backgrounds, and custom "Capsule" hover effects for Shorts.
* **👑 Premium Logo Toggle:** Instantly replaces the standard YouTube logo with the clean YouTube Premium logo.
* **🌌 Super Ambient Mode:** Enhances YouTube's native ambient mode with a wider, more vibrant glow around the video player.
* **⚡ 10x Speed Booster:** Bypasses YouTube's native 2x speed limit, allowing you to seamlessly increase playback speed up to 10x directly from the native player settings.
* **🎛️ Audio Enhancer & EQ:** A built-in audio engine featuring:
    * Up to **300% Volume Boost**.
    * Custom **3-Band Equalizer** (Lows, Mids, Highs).
    * Built-in presets (Bass Boost, Clear Vocals).
    * Live audio visualizer with an anime dancing GIF.
    * *Quick Access:* Press `Alt + Q` while watching a video to instantly open the audio panel.
* **🔁 Shorts Auto-Scroller:** A robust background script that intelligently detects when a YouTube Short finishes and automatically scrolls to the next one—completely hands-free.
* **⬇️ Smart Download:** A smart third-party download support added replacing the default download button (if you want to use the normal download then just turn off the setting in the extension).

---

## 🛠️ Local Installation (Chrome, Edge, Opera)

Since the extension is currently pending store approvals for Chromium browsers (and is now considered legacy), you can install the latest stable Chromium build locally in Developer Mode in just a few seconds:

1.  **Download the Extension:** Click the **Download ZIP** button in the downloads section above and extract the folder to your computer.
2.  **Open Extensions:** Open your browser and type `chrome://extensions/` (or `edge://extensions/` / `opera://extensions/`) in the URL bar.
3.  **Enable Developer Mode:** Toggle the **"Developer mode"** switch in the top right corner of the page.
4.  **Load the Extension:** Click the **"Load unpacked"** button in the top left and select the extracted `Youtube-Pro-Plus-main` folder.
5.  *Important:* Make sure to disable any conflicting Tampermonkey scripts or Stylus themes! 
6.  **Refresh YouTube** and enjoy!

---

## 🖥️ Usage

* **Main Settings:** Click the `YouTube Pro +` extension icon in your toolbar to open the Liquid Glass settings popup. From here, you can toggle every single feature on or off in real-time.
* **Audio Enhancer:** Click the "Open Audio Panel" button in the extension popup, or simply press **`Alt + Q`** on your keyboard to bring up the equalizer overlay.

---

## 📁 File Structure

* `manifest.json` - Chrome extension configuration.
* `popup.html` / `popup.js` - The Liquid Glass settings UI.
* `content.js` - The master script that manages injections and the Shorts Auto-Scroller logic.
* `theme.css` - The master stylesheet for the Liquid Glass UI.
* `inject-speed.js` - Bypasses the YouTube player to unlock 10x speed.
* `inject-audio.js` - Hooks into the Web Audio API for the volume booster and custom EQ.
* `inject-download.js` - Third-party downloader website support and automation of the process.
* `/imgs/` - Contains the custom extension icons and README graphics.

---

## ⚠️ Disclaimer

This extension modifies YouTube's native DOM and playback variables. If YouTube updates their interface, some features (like the Shorts Scroller or Speed Booster) may temporarily stop working until the selectors are updated in the code.

**Note on Audio Boosting:** Heavily boosting the "Lows" on the equalizer while at 300% volume may cause audio distortion depending on your hardware. It is recommended to keep the master volume at 100% when heavily boosting bass.

---

## ⚖️ License & Copyright

**Copyright © 2026 Archimetrix. All Rights Reserved.**

> This repository and its contents are proprietary. You may not copy, reproduce, distribute, publish, display, perform, modify, create derivative works, transmit, or in any way exploit any such content, nor may you distribute any part of this content over any network, including a local area network, sell or offer it for sale, or use such content to construct any kind of database.
