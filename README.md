# CodeGreeks File Studio - Universal Private Converter

**CodeGreeks File Studio** is a private offline client-side & native desktop file transformation studio, engineered by [CodeGreeks Technologies](https://codegreeks.com.ng/) (*Custom Software • AI Agents • BI & Analytics • Tools & Scripts*). It converts videos, audio, images, documents, and spreadsheets completely on your computer using a dual-engine architecture:
1. **Desktop Native Engine**: Electron application powered by a local Python backend sidecar (Pillow, PyMuPDF) for fast offline file transformations and native OS integration.
2. **Web & Extension Engine**: Browser extension running 100% offline via WebAssembly, WebCodecs, PDF.js, and HTML5 Canvas.

**Zero cloud dependency. Zero telemetry. 100% private and offline.**

---

## 📦 Windows Standalone Installer (.exe)

A self-contained Windows NSIS installer has been packaged with both the Electron runtime and the Python backend engine bundled:

- **Installer Path**: [`release/CodeGreeks File Studio Setup 2.1.0.exe`]
- **Standalone Unpacked Directory**: [`release/win-unpacked/`]

### Building the Installer from Source
If you ever need to rebuild the installer from scratch:
```bash
# 1. Compile the Python engine into a standalone binary
npm run build:engine

# 2. Package into the Windows NSIS installer .exe
npx.cmd electron-builder --win nsis
```

---

## 🚀 Running the Development Desktop App (Electron + Python)

The desktop edition provides a full native window, direct disk operations, native open/save dialogs, and hardware-accelerated transcoding with Python.

### Prerequisites
- **Node.js**: v18 or higher (with `npx` / `npm`)
- **Python**: 3.9+ (pre-installed libraries like `Pillow` and `PyMuPDF` will be auto-detected and utilized)

### One-Click Launch (Windows)
Double-click `start_desktop.bat` in the root folder, or run in terminal:
```bash
start_desktop.bat
```

### Python Launcher
You can also launch via the Python orchestrator:
```bash
python desktop/launcher.py
```

### NPM Launcher
```bash
npm install
npm start
```

---

## 🌐 Running as a Browser Extension

### Google Chrome / Brave / Edge / Opera
1. Open your browser and navigate to the extensions page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Brave: `brave://extensions`
2. Enable **Developer mode** using the toggle switch (usually in the top-right corner).
3. Click **Load unpacked**.
4. Select this project directory (`gpcodchckipdhaoboeemajkaageeflhg`).
5. Pin the **CodeGreeks** icon from your browser toolbar extension menu for easy access.

### Mozilla Firefox
1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Select `manifest.json` in this directory.

---

## 🌟 Key Features & Capabilities

- **Desktop + Extension Dual Mode**: Run as a native multi-window desktop software or as a lightweight browser toolbar popup.
- **Python Acceleration Sidecar**: Automatically connects to a local, loopback-only Python engine on startup for instant native image/PDF rendering.
- **Instant Hardware Muxing**: Transcodes and container-repacks compatible video/audio streams (e.g., iPhone `.MOV` to `.MP4` or `.WEBM` to `.MKV`) in milliseconds without quality degradation via WebCodecs and Mediabunny.
- **WASM Transcoding Engine**: Single-threaded FFmpeg WebAssembly engine converts legacy and complex audio/video codecs on-device.
- **Document Processing**:
  - Full PDF rendering and text extraction via PDF.js and PyMuPDF.
  - Multi-page document generation via PDF-lib.
  - DOCX parsing via Mammoth and OpenXML DOCX assembly with full WordprocessingML compliance.
  - Bidirectional CSV, TSV, HTML, and JSON tabular transformations.
  - Markdown compilation with Marked.
- **Image Conversion & HEIC Support**:
  - Apple HEIC/HEIF photo decoding via Libheif.
  - BMP, multi-resolution ICO, WebP, PNG, and JPEG encoding.
  - Multi-page image-to-PDF compilation.
- **Modern Adaptive UI**:
  - Dark / Light / System auto-detect color modes.
  - Real-time format category filtering and quick-search chips.
  - Compression quality profiles (Balanced, Maximum Compression, Archival Quality).
  - Multi-page export handling (bundled ZIP archive or discrete sequential downloads).
  - Clean responsive dashboard with recent history ledger and OS folder reveal.

---

## 📋 Format Matrix (41 Formats Supported)

| Category | Input Formats | Available Destinations |
|---|---|---|
| **Image** | `PNG`, `JPG`, `JPEG`, `WEIC`, `HEIF`, `WEBP`, `GIF`, `SVG`, `BMP`, `TIFF`, `TIF`, `ICO`, `AVIF` | `PNG`, `JPG`, `WEBP`, `PDF`, `GIF`, `BMP`, `TIFF`, `ICO` |
| **Document** | `PDF` | `PNG`, `JPG`, `TIFF`, `DOCX`, `TXT` |
| | `DOCX` | `PDF`, `HTML`, `TXT`, `MD` |
| | `TXT` | `PDF`, `DOCX`, `HTML`, `MD` |
| | `MD` | `PDF`, `HTML`, `DOCX`, `TXT` |
| | `HTML`, `HTM` | `PDF`, `DOCX`, `TXT`, `MD` |
| | `CSV`, `TSV` | `JSON`, `HTML`, `CSV` |
| | `JSON` | `CSV`, `HTML`, `TXT` |
| **Video** | `MP4`, `WEBM`, `MOV`, `MKV`, `AVI`, `M4V`, `FLV`, `WMV`, `3GP`, `MPEG`, `MPG`, `TS`, `OGV` | `MP4`, `WEBM`, `MOV`, `MKV`, `AVI`, `GIF`, `MP3`, `WAV`, `M4A` |
| **Audio** | `MP3`, `WAV`, `M4A`, `OGG`, `OGA`, `AAC`, `FLAC`, `OPUS`, `WMA`, `AMR`, `AIFF`, `AIF`, `WEBA` | `MP3`, `WAV`, `OGG`, `M4A`, `AAC`, `FLAC`, `OPUS` |

---

## 📂 Project Structure

```text
├── desktop/                   # Electron + Python Desktop Engine
│   ├── main.js                # Electron main process & IPC coordinator
│   ├── preload.js             # Context-isolated secure API bridge
│   ├── engine.py              # High-performance Python offline backend
│   └── launcher.py            # Python launcher for Electron orchestration
├── start_desktop.bat          # 1-click Windows desktop launcher
├── package.json               # Desktop dependencies & NPM scripts
├── manifest.json              # Cross-browser extension manifest (MV3)
├── app.html                   # Unified UI layout (desktop, tab & popup modes)
├── app.css                    # CodeGreeks design system (dark/light themes)
├── icons/                     # Application icons (16, 32, 48, 128px)
├── fonts/                     # Bundled Space Grotesk fonts
├── js/
│   ├── main.js                # Core UI controller & engine coordinator
│   ├── registry.js            # Unified media format matrix & routing
│   ├── config.js              # Preferences & persistent settings manager
│   ├── queue_bridge.js        # IndexedDB tab handoff bridge
│   ├── theme_loader.js        # Flash-free theme initialization script
│   └── core/
│       ├── accelerated_video.js # WebCodecs fast muxing pipeline
│       ├── image_engine.js      # Bitmap, HEIC, and ICO processor
│       ├── media_engine.js      # FFmpeg WebAssembly transcode engine
│       └── document_engine.js   # PDF, DOCX, Markdown, CSV, and JSON engine
└── lib/                       # Bundled offline libraries (FFmpeg, PDF.js, etc.)
```

---

## 🔒 Privacy & Security

CodeGreeks File Studio is engineered with security and privacy by [CodeGreeks Technologies](https://codegreeks.com.ng/).
- The desktop Python engine binds exclusively to local loopback (`127.0.0.1`) with a dynamically generated per-session authentication token and parent-process watchdog.
- Electron context isolation is enabled with strict boundary separation.
- The web extension declares no external network permissions, preventing any data transmission outside your device.
