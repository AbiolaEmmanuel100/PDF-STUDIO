/**
 * Tool: Edit PDF
 * Change existing text lines, add new text boxes and images, and white-out areas.
 *
 * How text editing works (and its honest limits): PDF has no "paragraphs" — text is placed
 * glyph-run by glyph-run. We group pdf.js text runs into lines; editing a line covers the old
 * line with an opaque box (page background assumed white) and writes the new text at the same
 * baseline, size and direction in the closest standard font (Helvetica / Times / Courier,
 * bold/italic detected from the embedded font name). The original glyphs stay in the file
 * underneath — use Redact to truly remove text.
 */
(function (global) {
  'use strict';
  const PS = global.PS;
  const { h, icon, baseName, plural, hexToRgb01, isImage } = PS.util;
  const ui = PS.ui;
  const TG = () => PS.textgeo;
  const BASELINE = 0.95, LINE_H = 1.2;

  const FAMILIES = [['helv', 'Sans-serif (Helvetica)'], ['times', 'Serif (Times)'], ['cour', 'Monospace (Courier)']];
  const CSS_FAMILY = { helv: 'Helvetica, Arial, sans-serif', times: '"Times New Roman", Times, serif', cour: '"Courier New", Courier, monospace' };
  function stdFont(fam, bold, italic) {
    const F = global.PDFLib.StandardFonts;
    if (fam === 'times') return bold && italic ? F.TimesRomanBoldItalic : bold ? F.TimesRomanBold : italic ? F.TimesRomanItalic : F.TimesRoman;
    if (fam === 'cour') return bold && italic ? F.CourierBoldOblique : bold ? F.CourierBold : italic ? F.CourierOblique : F.Courier;
    return bold && italic ? F.HelveticaBoldOblique : bold ? F.HelveticaBold : italic ? F.HelveticaOblique : F.Helvetica;
  }

  function detectFont(page, line) {
    let name = '';
    try { const f = page.commonObjs.get(line.fontName); name = (f && (f.name || f.loadedName)) || ''; } catch (_) { /* not loaded */ }
    const n = name.replace(/^[A-Z]{6}\+/, '');
    let fam = 'helv';
    if (line.family === 'serif' || /times|georgia|garamond|cambria|book|serif|minion|palatino|roman/i.test(n) && !/sans/i.test(n)) fam = 'times';
    if (line.family === 'monospace' || /courier|mono|consol|menlo/i.test(n)) fam = 'cour';
    return { family: fam, bold: /bold|black|heavy|semibold|demi/i.test(n), italic: /italic|oblique/i.test(n), name: n };
  }

  PS.tools.register({
    id: 'edit-pdf',
    name: 'Edit PDF',
    category: 'edit',
    icon: 'edit-text',
    isNew: true,
    description: 'Edit existing text, add text and images, white-out areas.',
    longDescription: 'Fix typos and change text lines directly on the page, add new text boxes and images, and white-out anything you want gone from view. Edited lines are re-typeset in the closest standard font.',
    keywords: ['edit text', 'change text', 'typo', 'replace text', 'add image', 'insert image', 'whiteout', 'white out', 'cover', 'modify'],
    mount(root) {
      return PS.kit.pdfTool(root, {
        dropTitle: 'Choose a PDF to edit',
        async onLoad(handle, view) {
          view.workspace.parentElement.classList.add('viewer-tool');
          let mode = 'edit-text';
          const urls = [];
          const viewer = PS.viewer.create(handle, { textLayer: false });
          view.workspace.insertBefore(viewer.el, view.result);

          const famSel = ui.select(FAMILIES, 'helv');
          const sizeIn = h('input', { type: 'number', min: 4, max: 144, step: 0.5, value: 12, 'aria-label': 'Font size' });
          const colorIn = h('input', { type: 'color', value: '#000000', 'aria-label': 'Text colour' });
          const boldIn = h('input', { type: 'checkbox' }), italIn = h('input', { type: 'checkbox' });
          const propsPanel = PS.kit.panel('Text style', ui.field('Font', famSel), h('div', { class: 'field-row' }, ui.field('Size (pt)', sizeIn), ui.field('Colour', colorIn)),
            h('div', { class: 'btn-row' }, h('label', { class: 'check' }, boldIn, 'Bold'), h('label', { class: 'check' }, italIn, 'Italic')));
          const objs = PS.objects.create(viewer, {
            label: (o) => ({ replace: 'Edited text', text: 'Text box', image: 'Image', whiteout: 'White-out' }[o.kind]),
            render, onChange: changed, onSelect: selected,
          });

          const palette = h('div', { class: 'tool-palette', role: 'toolbar', 'aria-label': 'Edit tools' });
          [['edit-text', 'Edit text', 'edit-text'], ['add-text', 'Add text', 'type'], ['add-image', 'Add image', 'image'], ['whiteout', 'White-out', 'eraser']].forEach(([id, label, ic]) =>
            palette.append(h('button', { type: 'button', 'data-mode': id, 'aria-pressed': String(id === mode), onclick: () => setMode(id) }, icon(ic), label)));
          const hint = h('p', { class: 'kbd-hint' });
          const list = h('p', { class: 'hint' });
          const save = view.actionButton('Save edited PDF', 'download', run);
          const imgPicker = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif,image/bmp', hidden: true });
          view.options.append(
            PS.kit.panel('Tools', palette, hint, imgPicker),
            propsPanel,
            PS.kit.panel('Changes', list, h('div', { style: { marginTop: '12px' } }, save)),
            ui.note('Edited lines are retyped in a standard font over a white box. Original text stays in the file underneath — use Redact to remove text permanently.'));

          const HINTS = {
            'edit-text': 'Click any line of text to edit it. Press Esc when done.',
            'add-text': 'Click on the page where the new text should start.',
            'add-image': 'Choose an image; it is placed on the current page. Drag to move, use the corner handle to resize.',
            whiteout: 'Drag over an area to cover it with white.',
          };
          function setMode(m) {
            mode = m;
            palette.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
            hint.textContent = HINTS[m];
            viewer.el.classList.toggle('mode-edit-text', m === 'edit-text');
            if (m === 'add-text') objs.setCreate({ cursor: 'text', defaultSize: [120, 18], minPx: 8, make: makeText });
            else if (m === 'whiteout') objs.setCreate({ cursor: 'crosshair', minPx: 4, noFocus: true, make: (page, rect) => ({ page, rect, kind: 'whiteout', cls: 'kind-whiteout' }) });
            else { objs.setCreate(null); viewer.setInteractive(m === 'edit-text', 'text'); }
            if (m === 'add-image') { imgPicker.value = ''; imgPicker.click(); }
          }
          function curStyle() { return { family: famSel.value, size: +sizeIn.value || 12, color: colorIn.value, bold: boldIn.checked, italic: italIn.checked }; }
          function makeText(page, rect, pv) {
            const st = curStyle();
            // keep the top-left where the user clicked, size the box to one line
            const r = pv.rectToPx(rect);
            const o = Object.assign({ page, kind: 'text', cls: 'kind-text', text: '' }, st);
            o.rect = pv.pxToRect(r.left, r.top, Math.max(r.width, 60 * pv.scale), st.size * LINE_H * pv.scale + 4);
            setTimeout(() => focusText(o), 0);
            return o;
          }
          imgPicker.addEventListener('change', async () => {
            const f = imgPicker.files[0];
            if (!f) return;
            if (!isImage(f)) { ui.toast('Please choose an image file.', 'warning'); return; }
            const url = URL.createObjectURL(f); urls.push(url);
            const img = new Image(); img.src = url;
            try { await img.decode(); } catch (_) { ui.toast('This image format is not supported by your browser.', 'error'); return; }
            const pv = viewer.pages[viewer.current - 1];
            const W = pv.el.clientWidth, H = pv.el.clientHeight;
            const w = W * 0.4, hh = w * img.naturalHeight / img.naturalWidth;
            const vis = Math.max(0, viewer.scroller.scrollTop - pv.el.offsetTop);
            const top = Math.min(H - hh, vis + Math.min(H, viewer.scroller.clientHeight) / 2 - hh / 2);
            const o = { page: pv.num, kind: 'image', cls: 'kind-image', url, keepAspect: true, rect: pv.pxToRect((W - w) / 2, Math.max(0, top), w, Math.min(hh, H)) };
            o.file = f;
            objs.add(o); objs.select(o.id);
            setMode('edit-text');
          });

          /* ---- clickable lines */
          const lineCache = new Map();
          async function lines(n) { if (!lineCache.has(n)) lineCache.set(n, TG().page(handle.pdfjs, n).then(TG().lines)); return lineCache.get(n); }
          viewer.onPage(async (pv) => {
            let layer = pv.overlay.querySelector('.edit-lines');
            if (!layer) { layer = h('div', { class: 'edit-lines' }); pv.overlay.prepend(layer); }
            const ls = await lines(pv.num);
            layer.replaceChildren(...ls.map((ln) => {
              const r = PS.textgeo.quadToViewport(pv.viewport, ln.quad);
              const d = h('div', { class: 'edit-line', title: 'Click to edit', style: { left: r[0] + 'px', top: r[1] + 'px', width: r[2] + 'px', height: r[3] + 'px' } });
              d.addEventListener('click', (e) => { if (mode === 'edit-text') { e.stopPropagation(); editLine(pv, ln); } });
              return d;
            }));
          });
          function editLine(pv, ln) {
            const existing = objs.list().find((o) => o.kind === 'replace' && o.page === pv.num && o.lineId === ln.id);
            if (existing) { focusText(existing); return; }
            const a = pv.toPx(ln.g.x, ln.g.y), b = pv.toPx(ln.g.x + ln.g.ux * 10, ln.g.y + ln.g.uy * 10);
            if (Math.abs(b[1] - a[1]) > 0.5) { ui.toast('Rotated or vertical text can’t be edited here. Use White-out and Add text instead.', 'warning'); return; }
            const f = detectFont(pv.page, ln);
            const pad = ln.g.size * 0.08;
            const o = {
              page: pv.num, kind: 'replace', cls: 'kind-replace', locked: true, lineId: ln.id, original: ln.text, text: ln.text,
              rect: [ln.rect[0] - pad, ln.rect[1] - pad, ln.rect[2] + pad, ln.rect[3] + pad],
              base: { x: ln.g.x, y: ln.g.y, ux: ln.g.ux, uy: ln.g.uy }, size: Math.round(ln.g.size * 10) / 10,
              family: f.family, bold: f.bold, italic: f.italic, color: '#000000',
            };
            objs.add(o);
            focusText(o);
          }
          function focusText(o) {
            objs.select(o.id);
            const el = objs.element(o.id);
            const t = el && el.querySelector('.obj-text');
            if (!t) return;
            t.contentEditable = 'true';
            t.focus();
            const r = document.createRange(); r.selectNodeContents(t);
            const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
          }

          function render(o, body, pv) {
            if (o.kind === 'image') {
              if (!body.firstChild) body.append(h('img', { src: o.url, alt: '' }));
              return;
            }
            if (o.kind === 'whiteout') return;
            let t = body.querySelector('.obj-text');
            if (!t) {
              t = h('div', { class: 'obj-text' + (o.kind === 'replace' ? ' is-line' : ''), contenteditable: o.kind === 'replace' ? 'true' : 'false', spellcheck: 'true', role: 'textbox', 'aria-multiline': String(o.kind === 'text'), 'aria-label': o.kind === 'replace' ? 'Edit line' : 'Text' });
              t.textContent = o.text;
              t.addEventListener('input', () => { o.text = t.innerText.replace(/\n$/, ''); if (o.kind === 'replace') o.text = o.text.replace(/\n/g, ' '); grow(o, t); changed(objs.list()); });
              t.addEventListener('paste', (e) => { e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData || global.clipboardData).getData('text/plain')); });
              t.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') { e.preventDefault(); t.blur(); objs.element(o.id).focus(); }
                if (e.key === 'Enter' && o.kind === 'replace') e.preventDefault();
                e.stopPropagation();
              });
              t.addEventListener('pointerdown', (e) => { if (t.isContentEditable) { e.stopPropagation(); objs.select(o.id); } });
              if (o.kind === 'text') {
                // text boxes: drag to move, double-click (or Enter) to type
                t.addEventListener('dblclick', () => focusText(o));
                t.addEventListener('blur', () => { t.contentEditable = 'false'; if (!o.text.trim()) objs.remove(o.id); });
                body.parentElement.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === body.parentElement) { e.preventDefault(); focusText(o); } });
              }
              body.append(t);
            }
            Object.assign(t.style, { fontFamily: CSS_FAMILY[o.family], fontSize: o.size * pv.scale + 'px', color: o.color, fontWeight: o.bold ? '700' : '400', fontStyle: o.italic ? 'italic' : 'normal', padding: o.kind === 'text' ? '2px' : '0' });
          }
          function grow(o, t) {
            const el = objs.element(o.id);
            const pv = viewer.pages[o.page - 1];
            const r = pv.rectToPx(o.rect);
            const w = Math.max(r.width, t.scrollWidth + 4), hh = o.kind === 'text' ? Math.max(o.size * LINE_H * pv.scale + 4, t.scrollHeight) : r.height;
            if (w !== r.width || hh !== r.height) {
              if (o.kind === 'replace') { o.textRect = pv.pxToRect(r.left, r.top, w, hh); el.style.width = w + 'px'; return; }
              o.rect = pv.pxToRect(r.left, r.top, Math.min(w, pv.el.clientWidth - r.left), hh);
              el.style.width = Math.min(w, pv.el.clientWidth - r.left) + 'px'; el.style.height = hh + 'px';
            }
          }

          let syncing = false;
          function selected(o) {
            const isText = o && (o.kind === 'text' || o.kind === 'replace');
            propsPanel.querySelectorAll('input, select').forEach((x) => { x.disabled = !!o && !isText; });
            if (!isText) return;
            syncing = true;
            famSel.value = o.family; sizeIn.value = o.size; colorIn.value = o.color; boldIn.checked = o.bold; italIn.checked = o.italic;
            syncing = false;
          }
          [famSel, sizeIn, colorIn, boldIn, italIn].forEach((x) => x.addEventListener(x === sizeIn || x === colorIn ? 'input' : 'change', () => {
            if (syncing) return;
            const o = objs.selected;
            if (!o || (o.kind !== 'text' && o.kind !== 'replace')) return;
            Object.assign(o, curStyle());
            objs.refresh(o);
            const t = objs.element(o.id).querySelector('.obj-text');
            if (t) grow(o, t);
          }));

          function changed(all) {
            const k = { replace: 0, text: 0, image: 0, whiteout: 0 };
            all.forEach((o) => { if (o.kind !== 'replace' || o.text !== o.original) k[o.kind]++; });
            const parts = [k.replace && plural(k.replace, 'line') + ' edited', k.text && plural(k.text, 'text box', 'text boxes'), k.image && plural(k.image, 'image'), k.whiteout && plural(k.whiteout, 'white-out')].filter(Boolean);
            list.textContent = parts.length ? parts.join(' · ') : 'No changes yet.';
            save.disabled = !parts.length;
          }

          async function run() {
            const all = objs.list().filter((o) => o.kind !== 'replace' || o.text !== o.original);
            let replaced = 0;
            const blob = await ui.run('Saving edits…', async () => {
              const L = global.PDFLib;
              const doc = await PS.engine.loadPdfLib(handle.bytes);
              const fonts = new Map();
              const font = async (o) => { const k = stdFont(o.family, o.bold, o.italic); if (!fonts.has(k)) fonts.set(k, await doc.embedFont(k)); return fonts.get(k); };
              const pages = doc.getPages();
              const order = { whiteout: 0, replace: 1, image: 2, text: 3 };
              for (const o of all.sort((a, b) => order[a.kind] - order[b.kind])) {
                const page = pages[o.page - 1];
                const pv = viewer.pages[o.page - 1];
                const [r, g, b] = hexToRgb01(o.color || '#000000');
                if (o.kind === 'whiteout' || o.kind === 'replace') {
                  const [x1, y1, x2, y2] = o.rect;
                  page.drawRectangle({ x: x1, y: y1, width: x2 - x1, height: y2 - y1, color: L.rgb(1, 1, 1), borderWidth: 0 });
                }
                if (o.kind === 'replace') {
                  if (!o.text.trim()) continue;
                  const f = await font(o);
                  const ang = Math.atan2(o.base.uy, o.base.ux) * 180 / Math.PI;
                  page.drawText(PS.annots.sanitize(o.text, f), { x: o.base.x, y: o.base.y, size: o.size, font: f, color: L.rgb(r, g, b), rotate: L.degrees(ang) });
                  replaced++;
                } else if (o.kind === 'text') {
                  if (!o.text.trim()) continue;
                  const f = await font(o);
                  const px = pv.rectToPx(o.rect);
                  const s = pv.scale;
                  PS.engine.drawTextDisplay(page, PS.annots.sanitize(o.text, f), { dx: px.left / s + 2, dy: px.top / s + 2 + o.size * BASELINE, size: o.size, font: f, color: L.rgb(r, g, b), lineHeight: LINE_H });
                } else if (o.kind === 'image') {
                  const img = await PS.engine.embedImageFile(doc, o.file);
                  const px = pv.rectToPx(o.rect);
                  const s = pv.scale;
                  PS.engine.drawImageDisplay(page, img, { dx: px.left / s, dy: (px.top + px.height) / s, width: px.width / s, height: px.height / s });
                }
              }
              return PS.engine.saveToBlob(doc);
            }, 'edit-pdf');
            if (blob) ui.showResult(view.result, { blob, filename: `${baseName(handle.name)}_edited.pdf`, detail: list.textContent });
          }

          setMode('edit-text');
          changed([]);
          return () => { urls.forEach((u) => URL.revokeObjectURL(u)); viewer.destroy(); };
        },
      });
    },
  });
})(window);
