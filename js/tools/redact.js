/**
 * Tool: Redact
 * Permanently remove sensitive content. Mark areas by dragging, or search for words and
 * patterns (emails, phone and card numbers…). On apply, every page with a mark is re-rendered
 * as an image with solid boxes burned in, so the text, vector graphics and images underneath
 * are really gone — not just covered. Hidden information (metadata, bookmarks, attachments,
 * scripts) can be removed at the same time.
 */
(function (global) {
  'use strict';
  const PS = global.PS;
  const { h, icon, baseName, plural } = PS.util;
  const ui = PS.ui;
  const TG = () => PS.textgeo;

  /** Remove document-level hidden data that could leak information. */
  function sanitizeDoc(doc) {
    const L = global.PDFLib;
    const cat = doc.catalog;
    ['Metadata', 'Outlines', 'Names', 'OpenAction', 'AA', 'Threads', 'StructTreeRoot', 'MarkInfo', 'PieceInfo', 'Dests', 'SpiderInfo', 'URI', 'Perms', 'Legal'].forEach((k) => cat.delete(L.PDFName.of(k)));
    try {
      const info = doc.getInfoDict();
      [...info.keys()].forEach((k) => info.delete(k));
    } catch (_) { /* no info dict */ }
    doc.setProducer('PDF Studio');
    doc.getPages().forEach((p) => { p.node.delete(L.PDFName.of('PieceInfo')); p.node.delete(L.PDFName.of('Metadata')); p.node.delete(L.PDFName.of('AA')); });
  }
  PS.sanitizePdf = sanitizeDoc;

  const overlaps = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

  /**
   * Re-create the page's text that is NOT under a redaction mark as invisible text on the new
   * (image) page, so the rest of the page stays searchable and copyable. Characters that touch
   * a mark are dropped — they never reach the output file.
   */
  function restoreText(newPage, font, geo, marks, vp) {
    const L = global.PDFLib;
    const H = vp.height;
    const map = (x, y) => { const [px, py] = vp.convertToViewportPoint(x, y); return [px, H - py]; };
    newPage.setFont(font);
    const key = newPage.getFont()[1];
    const ops = [];
    let kept = 0;
    for (const run of geo.runs) {
      const n = run.str.length;
      let seg = null;
      const flush = () => {
        if (!seg) return;
        const text = PS.annots.sanitize(run.str.slice(seg.from, seg.to), font);
        if (text.trim()) {
          const g = run.g;
          const offs = PS.textgeo.offsets(run);
          const s0 = offs[seg.from];
          const [x, y] = map(g.x + g.ux * s0, g.y + g.uy * s0);
          const [ex, ey] = map(g.x + g.ux * (s0 + 10), g.y + g.uy * (s0 + 10));
          const len = Math.hypot(ex - x, ey - y) || 1;
          const ux = (ex - x) / len, uy = (ey - y) / len;
          const want = offs[seg.to] - offs[seg.from];
          const nat = font.widthOfTextAtSize(text, g.size) || 1;
          ops.push(L.beginText(), L.setFontAndSize(key, g.size), L.setTextRenderingMode(L.TextRenderingMode.Invisible),
            L.setCharacterSqueeze(Math.max(10, Math.min(500, (100 * want) / nat))), L.setTextMatrix(ux, uy, -uy, ux, x, y), L.showText(font.encodeText(text)), L.endText());
          kept += text.length;
        }
        seg = null;
      };
      for (let i = 0; i < n; i++) {
        const r = PS.textgeo.quadRect(PS.textgeo.quadFor(run, i, i + 1));
        const hit = marks.some((m) => overlaps(r, m.rect));
        if (hit) flush();
        else if (!seg) seg = { from: i, to: i + 1 };
        else seg.to = i + 1;
      }
      flush();
    }
    if (ops.length) newPage.pushOperators(L.pushGraphicsState(), ...ops, L.popGraphicsState());
    return kept;
  }

  PS.tools.register({
    id: 'redact',
    name: 'Redact',
    category: 'review',
    icon: 'redact',
    isNew: true,
    description: 'Permanently black out sensitive text and areas.',
    longDescription: 'Mark areas or search for words and patterns (emails, phone numbers, card numbers…) and remove them permanently. Redacted pages are flattened so the content underneath is truly gone, and hidden metadata can be removed too.',
    keywords: ['redaction', 'black out', 'censor', 'hide', 'sanitize', 'remove text', 'privacy', 'gdpr', 'pii'],
    mount(root) {
      return PS.kit.pdfTool(root, {
        dropTitle: 'Choose a PDF to redact',
        async onLoad(handle, view) {
          view.workspace.parentElement.classList.add('viewer-tool');
          const viewer = PS.viewer.create(handle, {});
          view.workspace.insertBefore(viewer.el, view.result);
          const fill = ui.swatches([['#000000', 'Black'], ['#ffffff', 'White'], ['#7a7a7a', 'Grey']], '#000000', 'Redaction colour');
          const objs = PS.objects.create(viewer, {
            label: () => 'Redaction mark',
            render(obj, body) { body.style.background = 'repeating-linear-gradient(45deg, rgba(0,0,0,.62) 0 6px, rgba(0,0,0,.5) 6px 12px)'; body.style.outline = '1.5px solid #c62f3a'; },
            onChange: update,
          });
          let marking = true;
          const btnMark = h('button', { class: 'btn btn-secondary btn-sm', type: 'button', 'aria-pressed': 'true', onclick: () => setMarking(!marking) }, icon('redact', 'icon-sm'), 'Mark areas');
          function setMarking(on) {
            marking = on;
            btnMark.setAttribute('aria-pressed', String(on));
            btnMark.classList.toggle('is-active', on);
            objs.setCreate(on ? { cursor: 'crosshair', minPx: 4, noFocus: true, make: (page, rect) => ({ page, rect }) } : null);
            viewer.setInteractive(on);
          }

          const query = h('input', { type: 'text', placeholder: 'Word or phrase', 'aria-label': 'Text to redact' });
          const whole = h('input', { type: 'checkbox' });
          const presets = Object.entries(TG().PATTERNS).map(([k, p]) => ({ k, box: h('input', { type: 'checkbox', value: k }), label: p.label }));
          const found = h('p', { class: 'hint', 'aria-live': 'polite' });
          const btnFind = h('button', { class: 'btn btn-secondary', type: 'button', onclick: findAndMark }, icon('search', 'icon-sm'), 'Mark all matches');
          const list = h('p', { class: 'hint' });
          const btnClear = h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => objs.clear() }, icon('trash', 'icon-sm'), 'Clear marks');
          const dpi = ui.select([['150', '150 dpi — smaller file'], ['200', '200 dpi — balanced'], ['300', '300 dpi — sharp']], '200');
          const strip = h('input', { type: 'checkbox', checked: true });
          const keepText = h('input', { type: 'checkbox', checked: true });
          const apply = view.actionButton('Apply redactions', 'redact', run);
          view.options.append(
            PS.kit.panel('Mark', h('div', { class: 'btn-row' }, btnMark, btnClear), h('p', { class: 'kbd-hint' }, 'Drag on the page to mark an area. Select a mark to move or resize it; Delete removes it.'), list),
            PS.kit.panel('Search & redact', ui.field('Find text', query), h('label', { class: 'check' }, whole, 'Whole words only'),
              h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Patterns'), ...presets.map((p) => h('label', { class: 'check' }, p.box, p.label))),
              btnFind, found),
            PS.kit.panel('Apply', ui.field('Box colour', fill.el), ui.field('Output quality', dpi, 'Redacted pages become images at this resolution; other pages are untouched.'),
              h('label', { class: 'check' }, keepText, 'Keep the rest of the text on redacted pages searchable'),
              h('label', { class: 'check' }, strip, 'Also remove hidden information (metadata, bookmarks, attachments, scripts)'),
              h('div', { style: { marginTop: '14px' } }, apply)));
          query.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); findAndMark(); } });

          function update(all) {
            const pages = new Set(all.map((o) => o.page));
            list.textContent = all.length ? `${plural(all.length, 'mark')} on ${plural(pages.size, 'page')}.` : 'No marks yet.';
            apply.disabled = !all.length;
            btnClear.disabled = !all.length;
          }

          async function findAndMark() {
            const pats = presets.filter((p) => p.box.checked).map((p) => TG().PATTERNS[p.k].re);
            const q = query.value.trim();
            if (!q && !pats.length) { ui.toast('Type a word or choose a pattern first.', 'warning'); query.focus(); return; }
            let count = 0, noText = 0;
            await ui.run('Searching…', async (busy) => {
              for (let n = 1; n <= handle.pageCount; n++) {
                busy.progress(n - 1, handle.pageCount);
                const geo = await TG().page(handle.pdfjs, n);
                if (!geo.runs.length) { noText++; continue; }
                const ms = [];
                if (q) ms.push(...TG().find(geo, q, { wholeWord: whole.checked }));
                pats.forEach((re) => ms.push(...TG().find(geo, re)));
                const existing = objs.list().filter((o) => o.page === n).map((o) => o.rect.map((x) => x.toFixed(1)).join());
                for (const m of ms) for (const quad of m.quads) {
                  const r = TG().quadRect(quad);
                  // Pad a little: glyph positions inside a run are estimated, so err on the side of covering more.
                  const pad = Math.max(1, (r[3] - r[1]) * 0.25);
                  const rect = [r[0] - pad, r[1] - 1, r[2] + pad, r[3] + 1];
                  const key = rect.map((x) => x.toFixed(1)).join();
                  if (existing.includes(key)) continue;
                  existing.push(key);
                  objs.add({ page: n, rect, match: m.text });
                  count++;
                }
              }
            }, 'redact-search');
            found.textContent = count ? `Marked ${plural(count, 'match', 'matches')}.` : 'No matches found.';
            if (noText) found.textContent += ` ${plural(noText, 'page')} without text (scans) can only be redacted by marking areas.`;
          }

          async function run() {
            const marks = objs.list();
            if (!marks.length) return;
            const pages = [...new Set(marks.map((o) => o.page))].sort((a, b) => a - b);
            const color = fill.value;
            const blob = await ui.run('Applying redactions…', async (busy) => {
              const doc = await PS.engine.loadPdfLib(handle.bytes);
              const helv = await doc.embedFont(global.PDFLib.StandardFonts.Helvetica);
              const scale = +dpi.value / 72;
              for (let k = 0; k < pages.length; k++) {
                const n = pages[k];
                busy.progress(k, pages.length, `Page ${n}`);
                const page = await handle.pdfjs.getPage(n);
                const base = page.getViewport({ scale: 1 });
                const s = PS.engine.safeScale(base.width, base.height, scale);
                const vp = page.getViewport({ scale: s });
                const canvas = document.createElement('canvas');
                canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
                const ctx = canvas.getContext('2d', { alpha: false });
                ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
                await page.render({ canvasContext: ctx, viewport: vp }).promise;
                ctx.fillStyle = color;
                marks.filter((m) => m.page === n).forEach((m) => {
                  const [a, b, c, d] = vp.convertToViewportRectangle(m.rect);
                  ctx.fillRect(Math.floor(Math.min(a, c)), Math.floor(Math.min(b, d)), Math.ceil(Math.abs(c - a)) + 1, Math.ceil(Math.abs(d - b)) + 1);
                });
                const jpg = new Uint8Array(await (await PS.util.canvasToBlob(canvas, 'image/jpeg', 0.9)).arrayBuffer());
                PS.engine.releaseCanvas(canvas);
                page.cleanup();
                const img = await doc.embedJpg(jpg);
                const fresh = doc.insertPage(n - 1, [base.width, base.height]);
                fresh.drawImage(img, { x: 0, y: 0, width: base.width, height: base.height });
                if (keepText.checked) restoreText(fresh, helv, await TG().page(handle.pdfjs, n), marks.filter((mk) => mk.page === n), base);
                doc.removePage(n); // the original, now shifted by one
              }
              if (strip.checked) sanitizeDoc(doc);
              busy.progress(1, 1, 'Saving…');
              return PS.engine.saveToBlob(doc);
            }, 'redact');
            if (!blob) return;
            ui.showResult(view.result, { blob, filename: `${baseName(handle.name)}_redacted.pdf`, detail: `${plural(marks.length, 'area')} removed on ${plural(pages.length, 'page')}${strip.checked ? ' · hidden info removed' : ''}` });
          }

          setMarking(true);
          update([]);
          return () => viewer.destroy();
        },
      });
    },
  });
})(window);
