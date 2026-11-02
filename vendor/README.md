# Vendored libraries

All third-party code is committed here so PDF Studio works offline and never contacts a CDN.
Each file keeps its original license header.

| File | Library | Version | License | Used for |
| --- | --- | --- | --- | --- |
| `pdf.min.js`, `pdf.worker.min.js` | [pdf.js](https://github.com/mozilla/pdf.js) | 3.11.174 | Apache-2.0 | Rendering pages, thumbnails, text extraction |
| `pdf-lib.min.js` | [pdf-lib](https://github.com/Hopding/pdf-lib) | 1.17.x | MIT | Creating and modifying PDFs |
| `fflate.min.js` | [fflate](https://github.com/101arrowz/fflate) | 0.8.2 | MIT | Zipping multi-file outputs |
| `mammoth.browser.min.js` | [mammoth.js](https://github.com/mwilliamson/mammoth.js) | 1.x | BSD-2-Clause | DOCX → HTML (lazy-loaded) |
| `jspdf.umd.min.js` | [jsPDF](https://github.com/parallax/jsPDF) | 2.5.1 | MIT | HTML → PDF for Word conversion (lazy-loaded) |
| `html2canvas.min.js` | [html2canvas](https://github.com/niklasvh/html2canvas) | 1.4.1 | MIT | Required by jsPDF's `html()` (lazy-loaded) |
| `pdf-lib-cantoo.min.js` | [@cantoo/pdf-lib](https://github.com/cantoo-scribe/pdf-lib) | 2.11.1 | MIT (`LICENSE-cantoo-pdf-lib.md`) | Password protection (AES-256) and unlocking — lazy-loaded by Protect / Unlock only |
| `marked.umd.js` | [marked](https://github.com/markedjs/marked) | 18.1.3 | MIT | Markdown → HTML for "HTML / Markdown to PDF" (lazy-loaded) |
| `tesseract/tesseract.min.js`, `tesseract/worker.min.js` | [tesseract.js](https://github.com/naptha/tesseract.js) | 7.0.0 | Apache-2.0 (see `tesseract/LICENSE-tesseract.js.md`) | OCR (lazy-loaded, http(s) only) |
| `tesseract/tesseract-core-simd-lstm.wasm.js` | [tesseract.js-core](https://github.com/naptha/tesseract.js-core) | 7.0.0 | Apache-2.0 | Tesseract OCR engine compiled to WebAssembly (LSTM, SIMD build) |
| `tesseract/eng.traineddata.gz` | [tessdata_best (int)](https://github.com/naptha/tessdata) via `@tesseract.js-data/eng` | 4.0.0_best_int | Apache-2.0 | English recognition model |

The OCR files (~7 MB) are **not** precached by the service worker; they are downloaded from this same
site the first time OCR runs, then cached. Nothing is ever fetched from a third-party host.
