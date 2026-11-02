/**
 * Tool: Crop pages
 * Drag the crop frame (or type margins), optionally auto-detect the white margins, and apply
 * to all or some pages. Sets each page's /CropBox — like Acrobat, content outside the frame is
 * hidden, not deleted.
 */
(function (global) {
  'use strict';
  const PS = global.PS;
  const { h, icon, baseName, plural, clamp } = PS.util;
  const ui = PS.ui;
  const MM = 72 / 25.4;

  PS.tools.register({
    id: 'crop',
    name: 'Crop pages',
    category: 'organize',
    icon: 'crop',
    isNew: true,
    description: 'Trim page margins or crop to an area.',
    longDescription: 'Crop pages by dragging a frame or typing margins, or let PDF Studio detect and remove white margins automatically. Apply to every page or just some.',
    keywords: ['crop', 'trim', 'margins', 'cut', 'cropbox', 'resize page', 'white space'],
    mount(root) {
      return PS.kit.pdfTool(root, {
        dropTitle: 'Choose a PDF to crop',
        async onLoad(handle, view) {
          let pageNo = 1;
          let info = null; // {W, H, scale, canvas}
          const m = { t: 0, r: 0, b: 0, l: 0 }; // display margins in points
          const unit = ui.segmented('crop-unit', [['mm', 'mm'], ['pt', 'pt'], ['in', 'in']], 'mm', 'Units');
          const factor = () => ({ mm: MM, pt: 1, in: 72 }[unit.value]);
          const inputs = {};
          ['t', 'r', 'b', 'l'].forEach((k) => { inputs[k] = h('input', { type: 'number', min: 0, step: 0.5, value: 0, 'aria-label': { t: 'Top', r: 'Right', b: 'Bottom', l: 'Left' }[k] + ' margin' }); });
          const frame = h('div', { class: 'crop-frame', tabindex: '0', 'aria-label': 'Crop area — drag to move, drag the corners to resize' },
            ...['nw', 'ne', 'sw', 'se'].map((c) => h('span', { class: 'crop-handle ' + c, 'data-corner': c })));
          const stage = h('div', { class: 'viewer-page' });
          const label = h('span', { 'aria-live': 'polite' });
          const prev = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Previous page', onclick: () => go(pageNo - 1) }, icon('chevron-left'));
          const next = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Next page', onclick: () => go(pageNo + 1) }, icon('chevron-right'));
          const sizeOut = h('p', { class: 'hint', 'aria-live': 'polite' });
          const pages = PS.stamp.pagePicker(handle.pageCount);
          const btn = view.actionButton('Crop PDF', 'crop', run);
          view.workspace.insertBefore(h('section', { class: 'panel' },
            h('div', { class: 'list-toolbar', style: { marginBottom: '12px' } }, h('h2', null, 'Crop area'), h('div', { class: 'pager' }, prev, label, next)),
            h('div', { class: 'viewer' }, stage)), view.result);
          view.options.append(
            PS.kit.panel('Margins', ui.field('Units', unit.el),
              h('div', { class: 'field-row' }, ui.field('Top', inputs.t), ui.field('Bottom', inputs.b)),
              h('div', { class: 'field-row' }, ui.field('Left', inputs.l), ui.field('Right', inputs.r)), sizeOut,
              h('div', { class: 'btn-row', style: { marginTop: '12px' } },
                h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: autoDetect }, icon('zap', 'icon-sm'), 'Remove white margins'),
                h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => setMargins({ t: 0, r: 0, b: 0, l: 0 }) }, icon('refresh', 'icon-sm'), 'Reset'))),
            PS.kit.panel('Pages', pages.el, h('div', { style: { marginTop: '16px' } }, btn)),
            ui.note('Like Acrobat, cropping hides what is outside the frame; it doesn’t delete it. To remove content permanently, use Redact.'));

          function setMargins(nm, fromInput) {
            if (!info) return;
            const maxW = info.W - 10, maxH = info.H - 10;
            m.l = clamp(nm.l, 0, maxW); m.r = clamp(nm.r, 0, maxW - m.l);
            m.t = clamp(nm.t, 0, maxH); m.b = clamp(nm.b, 0, maxH - m.t);
            if (!fromInput) ['t', 'r', 'b', 'l'].forEach((k) => { inputs[k].value = String(Math.round((m[k] / factor()) * 10) / 10); });
            layoutFrame();
          }
          function layoutFrame() {
            const s = info.scale;
            Object.assign(frame.style, { left: m.l * s + 'px', top: m.t * s + 'px', width: (info.W - m.l - m.r) * s + 'px', height: (info.H - m.t - m.b) * s + 'px' });
            const w = (info.W - m.l - m.r) / factor(), hh = (info.H - m.t - m.b) / factor();
            sizeOut.textContent = `Result: ${w.toFixed(unit.value === 'in' ? 2 : 1)} × ${hh.toFixed(unit.value === 'in' ? 2 : 1)} ${unit.value}`;
          }
          ['t', 'r', 'b', 'l'].forEach((k) => inputs[k].addEventListener('input', () => {
            const v = parseFloat(inputs[k].value);
            setMargins(Object.assign({}, m, { [k]: (Number.isFinite(v) ? v : 0) * factor() }), true);
          }));
          unit.onChange(() => setMargins(m));

          // dragging: move whole frame or a corner
          frame.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            frame.setPointerCapture(e.pointerId);
            const corner = e.target.dataset.corner;
            const start = [e.clientX, e.clientY];
            const m0 = Object.assign({}, m);
            const s = info.scale;
            const move = (ev) => {
              const dx = (ev.clientX - start[0]) / s, dy = (ev.clientY - start[1]) / s;
              const nm = Object.assign({}, m0);
              if (!corner) {
                const w = info.W - m0.l - m0.r, hh = info.H - m0.t - m0.b;
                nm.l = clamp(m0.l + dx, 0, info.W - w); nm.r = info.W - w - nm.l;
                nm.t = clamp(m0.t + dy, 0, info.H - hh); nm.b = info.H - hh - nm.t;
              } else {
                if (corner.includes('w')) nm.l = clamp(m0.l + dx, 0, info.W - m0.r - 10);
                if (corner.includes('e')) nm.r = clamp(m0.r - dx, 0, info.W - m0.l - 10);
                if (corner.includes('n')) nm.t = clamp(m0.t + dy, 0, info.H - m0.b - 10);
                if (corner.includes('s')) nm.b = clamp(m0.b - dy, 0, info.H - m0.t - 10);
              }
              setMargins(nm);
            };
            const up = () => { frame.removeEventListener('pointermove', move); frame.removeEventListener('pointerup', up); };
            frame.addEventListener('pointermove', move);
            frame.addEventListener('pointerup', up);
          });
          frame.addEventListener('keydown', (e) => {
            const d = (e.shiftKey ? 10 : 1);
            const mv = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[e.key];
            if (!mv) return;
            e.preventDefault();
            const w = info.W - m.l - m.r, hh = info.H - m.t - m.b;
            const l = clamp(m.l + mv[0], 0, info.W - w), t = clamp(m.t + mv[1], 0, info.H - hh);
            setMargins({ l, t, r: info.W - w - l, b: info.H - hh - t });
          });

          async function go(n) {
            pageNo = clamp(n, 1, handle.pageCount);
            prev.disabled = pageNo <= 1; next.disabled = pageNo >= handle.pageCount;
            label.textContent = `Page ${pageNo} of ${handle.pageCount}`;
            const width = Math.min(560, (stage.parentElement.clientWidth || 600) - 40);
            const c = await PS.engine.renderPage(handle.pdfjs, pageNo, { width, hidpi: true });
            if (info && info.canvas) PS.engine.releaseCanvas(info.canvas);
            const page = await handle.pdfjs.getPage(pageNo);
            const vp = page.getViewport({ scale: 1 });
            info = { W: vp.width, H: vp.height, scale: c.pdfScale, canvas: c };
            stage.replaceChildren(c, frame);
            setMargins(m);
          }

          /** Find the non-white content box of the current page and set margins around it. */
          async function autoDetect() {
            const c = await PS.engine.renderPage(handle.pdfjs, pageNo, { scale: 0.75 });
            const ctx = c.getContext('2d');
            const { width: w, height: hh } = c;
            const d = ctx.getImageData(0, 0, w, hh).data;
            let x1 = w, y1 = hh, x2 = -1, y2 = -1;
            for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
              const i = (y * w + x) * 4;
              if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) { if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y; }
            }
            PS.engine.releaseCanvas(c);
            if (x2 < 0) { ui.toast('This page is blank — nothing to detect.', 'info'); return; }
            const s = 0.75, pad = 6;
            setMargins({ l: Math.max(0, x1 / s - pad), t: Math.max(0, y1 / s - pad), r: Math.max(0, info.W - (x2 + 1) / s - pad), b: Math.max(0, info.H - (y2 + 1) / s - pad) });
            ui.toast('Margins detected on this page. Check other pages before applying to all.', 'success');
          }

          async function run() {
            let list;
            try { list = pages.indices(); } catch (err) { ui.toast(err.message, 'error'); return; }
            if (!m.t && !m.r && !m.b && !m.l) { ui.toast('Set a crop area first (drag the frame or type margins).', 'warning'); return; }
            const blob = await ui.run('Cropping…', async () => {
              const doc = await PS.engine.loadPdfLib(handle.bytes);
              const all = doc.getPages();
              for (const i of list) {
                const page = all[i];
                const b = PS.engine.displayBox(page);
                // margins are relative to the *current* page's displayed size; scale for other page sizes
                const sx = b.width / info.W, sy = b.height / info.H;
                const l = m.l * sx, r = m.r * sx, t = m.t * sy, bt = m.b * sy;
                const p1 = PS.engine.toUser(b, l, t), p2 = PS.engine.toUser(b, b.width - r, b.height - bt);
                const x = Math.min(p1.x, p2.x), y = Math.min(p1.y, p2.y);
                page.setCropBox(x, y, Math.abs(p2.x - p1.x), Math.abs(p2.y - p1.y));
                // keep TrimBox/ArtBox inside the new crop box
                page.node.delete(global.PDFLib.PDFName.of('TrimBox'));
                page.node.delete(global.PDFLib.PDFName.of('ArtBox'));
              }
              return PS.engine.saveToBlob(doc);
            }, 'crop');
            if (blob) ui.showResult(view.result, { blob, filename: `${baseName(handle.name)}_cropped.pdf`, detail: `${plural(list.length, 'page')} cropped` });
          }

          requestAnimationFrame(() => go(1).catch((err) => ui.reportError(err, 'crop')));
          return () => { if (info && info.canvas) PS.engine.releaseCanvas(info.canvas); };
        },
      });
    },
  });
})(window);
