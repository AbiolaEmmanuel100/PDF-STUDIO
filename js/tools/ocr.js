/**
 * Tool: OCR — make scanned PDFs searchable
 * Renders each page, recognises the text with Tesseract (WebAssembly, running in a Web
 * Worker) and adds it back as an invisible text layer exactly over the words in the scan,
 * so the PDF looks the same but can be searched, selected and copied.
 *
 * Everything is bundled (vendor/tesseract: engine, worker and English model, ~7 MB) and is
 * only downloaded from this site the first time OCR runs. Browsers don't allow Web Workers
 * on pages opened from file://, so OCR needs the app to be served over http(s).
 */
(function (global) {
  'use strict';
  const PS = global.PS;
  const { h, icon, baseName, plural, loadScript } = PS.util;
  const ui = PS.ui;
  const DIR = 'vendor/tesseract/';

  function simdSupported() {
    try {
      return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
    } catch (_) { return false; }
  }

  async function createWorker(onProgress) {
    await loadScript(DIR + 'tesseract.min.js', 'Tesseract');
    const base = new URL(DIR, location.href).href;
    return global.Tesseract.createWorker('eng', 1, {
      workerPath: base + 'worker.min.js',
      corePath: base + 'tesseract-core-simd-lstm.wasm.js',
      langPath: base.replace(/\/$/, ''),
      workerBlobURL: false,
      gzip: true,
      cacheMethod: 'none',
      logger: (m) => onProgress && onProgress(m),
      errorHandler: (e) => console.warn('[ocr]', e),
    });
  }
  PS.ocr = { createWorker, available: () => !PS.engine.isFileProtocol && typeof Worker !== 'undefined' && simdSupported() };

  /** Add recognised words to a pdf-lib page as invisible (render mode 3) text. */
  function addTextLayer(page, font, data, scale) {
    const L = global.PDFLib;
    const box = PS.engine.displayBox(page);
    page.setFont(font);
    const key = page.getFont()[1];
    const ops = [];
    const rad = (box.R * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    let words = 0;
    for (const block of data.blocks || []) for (const para of block.paragraphs || []) for (const line of para.lines || []) {
      const lh = (line.bbox.y1 - line.bbox.y0) / scale;
      const size = Math.max(3, lh * 1.0);
      const bl = line.baseline || { x0: line.bbox.x0, y0: line.bbox.y1, x1: line.bbox.x1, y1: line.bbox.y1 };
      for (const w of line.words || []) {
        const text = PS.annots.sanitize(String(w.text || '').trim(), font);
        if (!text || w.confidence < 20) continue;
        const wpx = w.bbox.x1 - w.bbox.x0;
        const by = bl.x1 !== bl.x0 ? bl.y0 + ((bl.y1 - bl.y0) * (w.bbox.x0 - bl.x0)) / (bl.x1 - bl.x0) : bl.y0;
        const p = PS.engine.toUser(box, w.bbox.x0 / scale, by / scale);
        const natural = font.widthOfTextAtSize(text, size);
        const squeeze = Math.max(10, Math.min(500, (100 * (wpx / scale)) / (natural || 1)));
        ops.push(
          L.beginText(), L.setFontAndSize(key, size), L.setTextRenderingMode(L.TextRenderingMode.Invisible), L.setCharacterSqueeze(squeeze),
          L.setTextMatrix(cos, sin, -sin, cos, p.x, p.y), L.showText(font.encodeText(text)), L.endText());
        words++;
      }
    }
    if (ops.length) page.pushOperators(L.pushGraphicsState(), ...ops, L.popGraphicsState());
    return words;
  }

  PS.tools.register({
    id: 'ocr',
    name: 'OCR (searchable PDF)',
    category: 'convert',
    icon: 'scan',
    isNew: true,
    description: 'Recognise text in scans so you can search, select and copy it.',
    longDescription: 'Optical character recognition for scanned documents and photos of pages. The PDF looks exactly the same, but gains an invisible text layer so you can search, select and copy the text. English, fully offline.',
    keywords: ['ocr', 'scan', 'scanned', 'recognize', 'recognise', 'searchable', 'text recognition', 'tesseract', 'image to text'],
    mount(root) {
      return PS.kit.pdfTool(root, {
        dropTitle: 'Choose a scanned PDF',
        async onLoad(handle, view) {
          const previewWrap = PS.kit.panel('Recognised text', h('p', { class: 'hint' }, 'Run OCR to see the recognised text here.'));
          const pages = PS.stamp.pagePicker(handle.pageCount);
          const skip = h('input', { type: 'checkbox', checked: true });
          const dpi = ui.select([['200', '200 dpi — faster'], ['300', '300 dpi — more accurate']], '300');
          const btn = view.actionButton('Make searchable', 'scan', run);
          const txtBtn = h('button', { class: 'btn btn-secondary', type: 'button', disabled: true }, icon('file-text', 'icon-sm'), 'Download text (.txt)');
          let lastText = '';
          txtBtn.addEventListener('click', () => PS.util.download(new Blob([lastText], { type: 'text/plain;charset=utf-8' }), baseName(handle.name) + '_ocr.txt'));
          view.workspace.insertBefore(previewWrap, view.result);
          const available = PS.ocr.available();
          if (!available) {
            btn.disabled = true;
            view.options.append(ui.note(PS.engine.isFileProtocol
              ? 'OCR runs in a background worker, which browsers don’t allow for pages opened directly from a file (file://). Open PDF Studio from a web address instead — e.g. GitHub Pages, or run “python3 -m http.server” in the app folder and visit http://localhost:8000.'
              : 'Your browser doesn’t support WebAssembly SIMD, which the OCR engine needs. Please update your browser.', 'warn'));
          }
          view.options.append(
            PS.kit.panel('Settings', ui.field('Language', ui.select([['eng', 'English']], 'eng'), 'More languages can be added to vendor/tesseract.'), ui.field('Resolution', dpi),
              h('label', { class: 'check' }, skip, 'Skip pages that already have text')),
            PS.kit.panel('Pages', pages.el, h('div', { style: { marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '10px' } }, btn, txtBtn)));

          async function run() {
            let list;
            try { list = pages.indices(); } catch (err) { ui.toast(err.message, 'error'); return; }
            let worker = null;
            const out = await ui.run('Starting OCR engine…', async (busy) => {
              let k = 0;
              worker = await createWorker((m) => {
                if (m.status === 'recognizing text') busy.progress(k + (m.progress || 0), list.length, `Page ${k + 1} of ${list.length}`);
                else if (m.status && k === 0) busy.message(m.status.charAt(0).toUpperCase() + m.status.slice(1) + '…');
              });
              busy.message('Recognising text…');
              const doc = await PS.engine.loadPdfLib(handle.bytes);
              const font = await doc.embedFont(global.PDFLib.StandardFonts.Helvetica);
              const texts = [];
              let words = 0, skipped = 0;
              for (k = 0; k < list.length; k++) {
                const n = list[k] + 1;
                if (skip.checked) {
                  const geo = await PS.textgeo.page(handle.pdfjs, n);
                  if (geo.text.replace(/\s/g, '').length > 20) { skipped++; texts.push(`--- Page ${n} (existing text) ---\n${geo.text}`); continue; }
                }
                const canvas = await PS.engine.renderPage(handle.pdfjs, n, { scale: +dpi.value / 72 });
                const scale = canvas.pdfScale;
                const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
                PS.engine.releaseCanvas(canvas);
                words += addTextLayer(doc.getPage(n - 1), font, data, scale);
                texts.push(`--- Page ${n} ---\n${(data.text || '').trim()}`);
              }
              busy.progress(1, 1, 'Saving…');
              return { blob: await PS.engine.saveToBlob(doc), words, skipped, text: texts.join('\n\n') };
            }, 'ocr');
            if (worker) worker.terminate().catch(() => {});
            if (!out) return;
            lastText = out.text;
            txtBtn.disabled = !out.text.trim();
            previewWrap.replaceChildren(h('h2', null, 'Recognised text'), h('pre', { class: 'text-preview', tabindex: '0' }, out.text.slice(0, 20000) || '(no text found)'));
            if (!out.words && !out.skipped) ui.toast('No text was recognised. Is the scan very faint or not in English?', 'warning');
            ui.showResult(view.result, { blob: out.blob, filename: `${baseName(handle.name)}_ocr.pdf`, detail: `${plural(out.words, 'word')} recognised${out.skipped ? ` · ${plural(out.skipped, 'page')} skipped (already had text)` : ''}` });
          }
        },
      });
    },
  });
})(window);
