# PDF Studio

**A private, offline PDF editor and converter that runs entirely in your browser.**
Merge, organize, split, convert, compress, watermark, number and sign PDFs — no installation, no account, no uploads.
Your files are processed on your own device and never leave it.

> Open `index.html` and start working. That's it.

---

## Features

### Organize
- **Merge PDFs** — combine any number of files; drag to reorder (or use ↑/↓, Alt+↑/↓); optionally take only certain pages from each file (e.g. `1-3, 7`).
- **Organize pages** — visual thumbnail editor: drag pages to reorder, rotate, duplicate or delete individual pages, insert blank pages, pull in pages from other PDFs, full **undo/redo**.
- **Split & extract** — click thumbnails or type ranges; extract selected pages into one PDF, or split into one file per page, every *N* pages, or by custom ranges (multi-file results download as a `.zip`).
- **Rotate pages** — rotate all or selected pages by 90°/180°/270° with a live thumbnail preview.

### Convert
- **Images → PDF** — JPG, PNG, WebP, GIF, BMP… one image per page; page size (A4, Letter, Legal, A5 or same-as-image), orientation and margins. PNG/JPEG are embedded losslessly and phone photos are auto-straightened (EXIF orientation).
- **PDF → images** — export pages as PNG or JPG at 72–300 DPI (zip for multiple pages).
- **Word (DOCX) → PDF** — headings, lists, tables, links and images; download directly or use *Print / Save as PDF* for selectable text and full Unicode.
- **Text → PDF** — type, paste or open a `.txt`; choice of font, size, page size and line spacing, paragraphs preserved, optional page numbers.

### Edit & sign
- **Sign & annotate** — draw (mouse, pen or finger), type or upload a signature; add text boxes, dates, check marks and images; drag to place, resize with the handle, nudge with arrow keys.
- **Watermark & stamp** — text (e.g. *CONFIDENTIAL*, *DRAFT*) or an image/logo; position, tiling, angle, size, colour and opacity with a live preview.
- **Page numbers** — `1`, `Page 1`, `Page 1 of N`, `1 / N`…; header/footer position, size, colour, starting number, which pages.
- **Edit metadata** — change title, author, subject, keywords, creator, producer — or strip **all** metadata (including XMP) before sharing.

### Optimize & inspect
- **Compress PDF** — *Lossless* (rewrites the file structure, keeps text) or *Strong* (re-renders pages as JPEG at a chosen resolution/quality, optional grayscale). Before/after sizes are shown, and the trade-off is explained in the UI.
- **Info & extract text** — page size, PDF version, producer, dates, form/encryption flags, page previews, and full text extraction (copy or save as `.txt`).

All tools work with rotated pages (stamps, numbers and signatures are placed relative to the page as you see it).

## Privacy

- **Nothing is uploaded.** All processing uses JavaScript libraries bundled in this repository (`vendor/`).
- **No network access at all**: a strict Content-Security-Policy (`default-src 'self'`) stops the page from contacting any other server — no CDNs, analytics, fonts or tracking.
- Files are held in memory only while a tool is open; nothing is written to storage. The only thing saved locally is your theme preference.
- Signatures you create are kept for the current session only so you can reuse them, and are never persisted.

## How to use

**Option 1 — open the file.** Download or clone the repo and double-click `index.html`. It works straight from disk (`file://`) in Chrome, Edge, Firefox and Safari.

**Option 2 — host it.** Serve the folder with any static host (GitHub Pages, Netlify, `python -m http.server`). Over http(s) PDF Studio additionally:
- renders PDFs in a **Web Worker** (smoother UI with large files), and
- installs a **service worker + web app manifest**, so it works fully offline and can be installed as an app.

Then pick a tool, drop your files onto the drop zone (or click it / press Enter to browse), adjust options, and download the result.

### Keyboard shortcuts
| Where | Keys |
| --- | --- |
| Home | `/` focus tool search · `Enter` open first match |
| Page grids | Arrows move focus · `Space` select · `Shift+click` range · `Ctrl/⌘+A` select all |
| Organize | `Alt+←/→` move page · `R` / `Shift+R` rotate · `Delete` remove · `Ctrl/⌘+Z` / `Ctrl/⌘+Y` undo / redo |
| Merge / Images | `Alt+↑/↓` move file |
| Sign | Arrows nudge (Shift = faster) · `Alt+Arrows` resize · `Delete` remove |

## Browser support

Current versions of Chrome, Edge, Firefox and Safari (desktop and mobile). The layout is responsive and touch-friendly (long-press to drag thumbnails on touch screens). Light and dark themes follow your system setting, or choose one with the header toggle.

## Limitations

- Password-protected/encrypted PDFs can be viewed but not modified (no reliable client-side decryption library is bundled). Remove the password first.
- Signatures are visual (an image of your signature), not certificate-based digital signatures.
- *Strong* compression turns pages into images: text is no longer selectable or searchable.
- Word conversion simplifies complex layouts (headers/footers, text boxes, exact fonts). The standard PDF fonts used by Text → PDF and stamps cover Western European characters; other scripts are replaced with `?` (use Word → PDF › *Print / Save as PDF* for full Unicode).
- Very large files are limited by your device's memory; pages are rendered progressively to keep the UI responsive.

## Project structure

```
index.html              App shell, icon sprite, CSP, script loading order
manifest.webmanifest    PWA manifest (linked only over http/https)
sw.js                   Service worker — offline cache (registered only over http/https)
css/app.css             Design tokens (light/dark), layout and components
icons/                  App icons (SVG + PNG)
js/
  theme-init.js         Applies the saved/system theme before first paint
  core/
    util.js             DOM builder, ranges parser, downloads, zip, helpers
    ui.js               Toasts, busy/progress overlay, dropzone, modal, form controls
    engine.js           pdf.js / pdf-lib wrapper: worker setup, render queue, rotation-aware drawing
    sortable.js         Pointer-based drag-to-reorder (mouse, pen, touch)
    page-grid.js        Accessible, lazily-rendered thumbnail grid with selection & actions
    kit.js              Shared "open a PDF → options → export" tool scaffold
    stamp.js            Shared layout/preview helpers for watermark & page numbers
  app.js                Tool registry, hash router, home screen, sidebar, theme, PWA
  main.js               Boot
  tools/*.js            One file per tool; each registers itself with PS.tools
vendor/                 Third-party libraries (see vendor/README.md)
```

No build step: every file is plain, commented JavaScript loaded with classic `<script>` tags (ES modules are avoided because browsers block them on `file://`). Adding a tool means adding one file in `js/tools/` that calls `PS.tools.register({...})` and a `<script>` tag (plus an entry in `sw.js`).

## Credits

Built on [pdf.js](https://github.com/mozilla/pdf.js), [pdf-lib](https://github.com/Hopding/pdf-lib), [mammoth.js](https://github.com/mwilliamson/mammoth.js), [jsPDF](https://github.com/parallax/jsPDF), [html2canvas](https://github.com/niklasvh/html2canvas) and [fflate](https://github.com/101arrowz/fflate). See `vendor/README.md` for versions and licenses.
