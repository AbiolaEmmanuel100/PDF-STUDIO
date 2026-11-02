/**
 * PDF Studio — PDF engine (PS.engine)
 *
 * Wraps the two vendored PDF libraries:
 *   - pdf.js  (rendering, text extraction) — runs in a Web Worker when served over http(s).
 *             Browsers refuse to start Workers from file:// pages, so in that case the worker
 *             script is loaded on the main thread instead (pdf.js "fake worker" mode).
 *   - pdf-lib (writing / modifying PDFs)
 *
 * Also provides a render queue (limits concurrent page renders so big documents
 * don't freeze the tab) and coordinate helpers that place content correctly on
 * rotated pages.
 */
(function (global) {
  'use strict';
  const PS = global.PS;
  const { readAsArrayBuffer, isPdf } = PS.util;

  const WORKER_SRC = 'vendor/pdf.worker.min.js';
  const isFileProtocol = location.protocol === 'file:';
  const MAX_CANVAS_PIXELS = 16_000_000; // ~ 4000×4000; Safari/iOS fail above ~16.7M
  const MAX_CANVAS_SIDE = 8000;

  let workerReady = null;

  /** Configure pdf.js once; returns a promise that resolves when it's ready to use. */
  function ensurePdfJs() {
    if (workerReady) return workerReady;
    if (!global.pdfjsLib) return Promise.reject(new Error('pdf.js failed to load.'));
    global.pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_SRC;
    if (!isFileProtocol && typeof Worker !== 'undefined') {
      workerReady = Promise.resolve();
    } else {
      // file:// — load the worker code as a classic script; pdf.js detects
      // window.pdfjsWorker and runs it on the main thread.
      workerReady = new Promise((resolve, reject) => {
        if (global.pdfjsWorker) return resolve();
        const s = document.createElement('script');
        s.src = WORKER_SRC;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('Could not load the PDF engine (vendor/pdf.worker.min.js).'));
        document.head.appendChild(s);
      });
    }
    return workerReady;
  }

  /** Quick sniff for an /Encrypt entry near the start or end of the file (where trailers live). */
  function looksEncrypted(bytes) {
    const u8 = new Uint8Array(bytes);
    const chunk = 65536;
    const dec = new TextDecoder('latin1');
    const head = dec.decode(u8.subarray(0, Math.min(chunk, u8.length)));
    const tail = dec.decode(u8.subarray(Math.max(0, u8.length - chunk)));
    return /\/Encrypt\s*\d+\s+\d+\s+R/.test(head + tail) || /\/Encrypt\s*<</.test(head + tail);
  }

  function hasPdfHeader(bytes) {
    const u8 = new Uint8Array(bytes, 0, Math.min(1024, bytes.byteLength));
    const s = new TextDecoder('latin1').decode(u8);
    return s.includes('%PDF-');
  }

  /** Open a pdf.js document from bytes. A copy is passed because pdf.js transfers (detaches) the buffer. */
  async function openPdfJs(bytes, password) {
    await ensurePdfJs();
    const task = global.pdfjsLib.getDocument({
      data: new Uint8Array(bytes).slice(),
      password: password || undefined,
      isEvalSupported: false, // keep a strict CSP possible
      verbosity: 0,           // errors only
    });
    return task.promise;
  }

  /**
   * Load a user's PDF file. Returns a handle:
   *  { id, file, name, size, bytes, pageCount, encrypted, pdfjs, destroy() }
   * `bytes` is kept so pdf-lib can create fresh documents for each operation.
   */
  async function openFile(file, { password } = {}) {
    if (!isPdf(file)) throw new Error(`"${file.name}" is not a PDF.`);
    const bytes = await readAsArrayBuffer(file);
    if (!hasPdfHeader(bytes)) throw Object.assign(new Error(`"${file.name}" is not a valid PDF.`), { name: 'InvalidPDFException' });
    const pdfjs = await openPdfJs(bytes, password);
    const handle = {
      password: password || null,
      id: PS.util.uid('pdf'),
      file,
      name: file.name,
      size: file.size,
      bytes,
      pageCount: pdfjs.numPages,
      encrypted: looksEncrypted(bytes),
      pdfjs,
      destroy() { try { pdfjs.destroy(); } catch (_) { /* already gone */ } },
    };
    return handle;
  }

  /** Fresh, mutable pdf-lib document from bytes. */
  async function loadPdfLib(bytes, opts) {
    return global.PDFLib.PDFDocument.load(bytes, Object.assign({ updateMetadata: false }, opts));
  }

  /** Create an empty pdf-lib document tagged with our producer. */
  async function createPdfLib() {
    const doc = await global.PDFLib.PDFDocument.create({ updateMetadata: false });
    doc.setProducer('PDF Studio (pdf-lib)');
    doc.setCreator('PDF Studio');
    doc.setCreationDate(new Date());
    doc.setModificationDate(new Date());
    return doc;
  }

  async function saveToBlob(doc, opts) {
    try { doc.setModificationDate(new Date()); } catch (_) { /* metadata is optional */ }
    const bytes = await doc.save(Object.assign({ useObjectStreams: true }, opts));
    return new Blob([bytes], { type: 'application/pdf' });
  }

  /* ---------------------------------------------------------- Rendering */
  // Simple concurrency-limited queue so dozens of thumbnails don't render at once.
  const queue = [];
  let active = 0;
  const CONCURRENCY = 2;
  function enqueue(job) {
    return new Promise((resolve, reject) => {
      queue.push({ job, resolve, reject });
      pump();
    });
  }
  function pump() {
    while (active < CONCURRENCY && queue.length) {
      const { job, resolve, reject } = queue.shift();
      active++;
      Promise.resolve().then(job).then(resolve, reject).finally(() => { active--; pump(); });
    }
  }

  /** Clamp a render scale so the canvas stays within safe browser limits. */
  function safeScale(baseW, baseH, scale) {
    let s = scale;
    if (baseW * s > MAX_CANVAS_SIDE) s = MAX_CANVAS_SIDE / baseW;
    if (baseH * s > MAX_CANVAS_SIDE) s = MAX_CANVAS_SIDE / baseH;
    if (baseW * s * baseH * s > MAX_CANVAS_PIXELS) s = Math.sqrt(MAX_CANVAS_PIXELS / (baseW * baseH));
    return s;
  }

  /**
   * Render one page to a canvas.
   * opts: { scale } or { width } (CSS-pixel target width), { extraRotation } (deg, added to the page's own),
   *       { rotation } (absolute override), { background } (fill colour, default white), { hidpi }
   */
  function renderPage(pdfjsDoc, pageNumber, opts = {}) {
    return enqueue(async () => {
      const page = await pdfjsDoc.getPage(pageNumber);
      try {
        const rotation = opts.rotation != null ? opts.rotation : ((page.rotate + (opts.extraRotation || 0)) % 360 + 360) % 360;
        const base = page.getViewport({ scale: 1, rotation });
        let scale = opts.scale || (opts.width ? opts.width / base.width : 1);
        const dpr = opts.hidpi ? Math.min(global.devicePixelRatio || 1, 2) : 1;
        scale = safeScale(base.width, base.height, scale * dpr);
        const viewport = page.getViewport({ scale, rotation });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        if (dpr !== 1) {
          canvas.style.width = Math.floor(viewport.width / dpr) + 'px';
          canvas.style.height = Math.floor(viewport.height / dpr) + 'px';
        }
        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.fillStyle = opts.background || '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
        canvas.pdfScale = scale / dpr;
        return canvas;
      } finally {
        page.cleanup();
      }
    });
  }

  /** Release a canvas' backing store early (helps Safari/iOS memory limits). */
  function releaseCanvas(canvas) {
    if (!canvas) return;
    canvas.width = 0;
    canvas.height = 0;
  }

  /* ------------------------------------------------ Page geometry helpers */
  function normRotation(a) { return ((Math.round(a / 90) * 90) % 360 + 360) % 360; }

  /**
   * Describe a pdf-lib page as the user *sees* it (after /Rotate is applied).
   * Display coordinates: origin top-left, x right, y down, units = PDF points.
   */
  function displayBox(page) {
    const R = normRotation(page.getRotation().angle);
    const box = page.getCropBox ? page.getCropBox() : Object.assign({ x: 0, y: 0 }, page.getSize());
    const { x, y, width: W, height: H } = box;
    const swap = R === 90 || R === 270;
    return { R, x0: x, y0: y, W, H, width: swap ? H : W, height: swap ? W : H };
  }

  /** Map a display point (dx, dy) to PDF user space. */
  function toUser(b, dx, dy) {
    switch (b.R) {
      case 90: return { x: b.x0 + dy, y: b.y0 + dx };
      case 180: return { x: b.x0 + b.W - dx, y: b.y0 + dy };
      case 270: return { x: b.x0 + b.W - dy, y: b.y0 + b.H - dx };
      default: return { x: b.x0 + dx, y: b.y0 + b.H - dy };
    }
  }

  /**
   * Draw text so it appears upright (plus `angle` degrees counter-clockwise) on the displayed page.
   * (dx, dy) is the display position of the text's baseline start.
   */
  function drawTextDisplay(page, text, { dx, dy, size, font, color, opacity = 1, angle = 0, lineHeight = 1.2 }) {
    const b = displayBox(page);
    const lines = String(text).split(/\r?\n/);
    const theta = ((angle) * Math.PI) / 180; // display-space rotation (ccw)
    lines.forEach((line, i) => {
      // offset each subsequent line "down" in the rotated text frame
      const off = i * size * lineHeight;
      const ldx = dx + off * Math.sin(theta);
      const ldy = dy + off * Math.cos(theta);
      const p = toUser(b, ldx, ldy);
      page.drawText(line, { x: p.x, y: p.y, size, font, color, opacity, rotate: global.PDFLib.degrees(b.R + angle) });
    });
  }

  /** Draw an embedded image with its display-space bottom-left corner at (dx, dy). */
  function drawImageDisplay(page, image, { dx, dy, width, height, opacity = 1, angle = 0 }) {
    const b = displayBox(page);
    const p = toUser(b, dx, dy);
    page.drawImage(image, { x: p.x, y: p.y, width, height, opacity, rotate: global.PDFLib.degrees(b.R + angle) });
  }

  /**
   * Compute the display-space anchor (baseline-left / bottom-left) for a box of size (w, h)
   * that should be centred at (cx, cy) after rotating by `angle` degrees ccw.
   */
  function anchorForCenter(cx, cy, w, h, angle) {
    const t = (angle * Math.PI) / 180;
    // vector from anchor to centre in an upright frame (display y is down, so "up" = -h/2)
    const vx = w / 2, vy = -h / 2;
    // rotate ccw on screen: x' = x cos + y sin, y' = -x sin + y cos (y-down coords)
    const rx = vx * Math.cos(t) + vy * Math.sin(t);
    const ry = -vx * Math.sin(t) + vy * Math.cos(t);
    return { dx: cx - rx, dy: cy - ry };
  }

  /**
   * Embed any browser-decodable image into a pdf-lib doc.
   * PNG/JPEG are embedded as-is (no quality loss) unless the JPEG has an EXIF rotation;
   * other formats (WebP, GIF, BMP, AVIF…) are converted via canvas.
   */
  async function embedImageFile(doc, file) {
    const bytes = new Uint8Array(await readAsArrayBuffer(file));
    const kind = sniffImage(bytes);
    if (kind === 'png') return doc.embedPng(bytes);
    if (kind === 'jpg' && jpegOrientation(bytes) <= 1) return doc.embedJpg(bytes);
    // Decode with the browser (honours EXIF orientation) and re-encode.
    const blob = new Blob([bytes], { type: file.type || 'image/*' });
    const bmp = await decodeImage(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    if (bmp.close) bmp.close();
    let out;
    if (kind === 'jpg') {
      out = await doc.embedJpg(new Uint8Array(await (await PS.util.canvasToBlob(canvas, 'image/jpeg', 0.92)).arrayBuffer()));
    } else {
      out = await doc.embedPng(new Uint8Array(await (await PS.util.canvasToBlob(canvas, 'image/png')).arrayBuffer()));
    }
    releaseCanvas(canvas);
    return out;
  }

  async function decodeImage(blob) {
    if (global.createImageBitmap) {
      try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch (_) { /* fall back to <img> */ }
    }
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } catch (e) {
      throw new Error('This image format is not supported by your browser.');
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function sniffImage(u8) {
    if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) return 'png';
    if (u8[0] === 0xff && u8[1] === 0xd8) return 'jpg';
    return 'other';
  }

  /** Read the EXIF orientation tag (1–8) from a JPEG; 1/0 = normal/unknown. */
  function jpegOrientation(u8) {
    const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let off = 2;
    while (off + 4 < view.byteLength) {
      const marker = view.getUint16(off);
      const len = view.getUint16(off + 2);
      if (marker === 0xffe1 && view.getUint32(off + 4) === 0x45786966) { // "Exif"
        const tiff = off + 10;
        const little = view.getUint16(tiff) === 0x4949;
        const ifd = tiff + view.getUint32(tiff + 4, little);
        const count = view.getUint16(ifd, little);
        for (let i = 0; i < count; i++) {
          const entry = ifd + 2 + i * 12;
          if (entry + 10 > view.byteLength) break;
          if (view.getUint16(entry, little) === 0x0112) return view.getUint16(entry + 8, little);
        }
        return 0;
      }
      if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break;
      off += 2 + len;
    }
    return 0;
  }

  PS.engine = {
    ensurePdfJs, openPdfJs, openFile, loadPdfLib, createPdfLib, saveToBlob,
    renderPage, releaseCanvas, safeScale,
    displayBox, toUser, drawTextDisplay, drawImageDisplay, anchorForCenter, normRotation,
    embedImageFile, decodeImage, isFileProtocol,
  };
})(window);
