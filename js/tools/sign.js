/**
 * Tool: Sign & annotate
 * Place signatures (drawn, typed or uploaded), text boxes, dates and images anywhere on any page.
 * Items are dragged to position, resized with the corner handle (or arrow keys), and burned into
 * the PDF on export. Geometry is stored as fractions of the displayed page, so it is independent
 * of zoom level and maps correctly onto rotated pages.
 */
(function (global) {
  'use strict';
  const PS = global.PS;
  const { h, icon, uid, baseName, plural, clamp, isImage, hexToRgb01, debounce, canvasToBlob } = PS.util;
  const ui = PS.ui;

  const BASELINE = 0.95;   // first-line baseline offset (× font size) for line-height 1.2 — matches CSS
  const LINE_H = 1.2;
  let lastSignature = null; // reused within the session (never persisted)

  /* ------------------------------------------------ signature dialog */
  function trimCanvas(src) {
    const ctx = src.getContext('2d', { willReadFrequently: true });
    const { width, height } = src;
    const data = ctx.getImageData(0, 0, width, height).data;
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    if (maxX < 0) return null;
    const pad = 6;
    minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad); maxX = Math.min(width - 1, maxX + pad); maxY = Math.min(height - 1, maxY + pad);
    const out = document.createElement('canvas');
    out.width = maxX - minX + 1; out.height = maxY - minY + 1;
    out.getContext('2d').drawImage(src, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
    return out;
  }

  async function canvasToImageItem(canvas) {
    const blob = await canvasToBlob(canvas, 'image/png');
    return { bytes: new Uint8Array(await blob.arrayBuffer()), url: URL.createObjectURL(blob), aspect: canvas.height / canvas.width };
  }

  function signatureDialog() {
    return new Promise((resolve) => {
      let tab = 'draw';
      let inkColor = '#10204a';
      const pad = h('canvas', { class: 'sig-pad', 'aria-label': 'Signature drawing area. Draw with mouse, pen or finger.' });
      const typed = h('input', { type: 'text', placeholder: 'Type your name', class: 'sig-typed', 'aria-label': 'Typed signature', style: { minHeight: '64px' } });
      let uploadCanvas = null;
      const uploadInfo = h('p', { class: 'hint' }, 'PNG with a transparent background looks best.');
      const upload = ui.dropzone({
        compact: true, title: 'Choose an image of your signature', accept: 'image/*', filter: isImage, icon: 'image',
        onFiles: async ([f]) => {
          try {
            const bmp = await PS.engine.decodeImage(f);
            const max = 1200, s = Math.min(1, max / Math.max(bmp.width, bmp.height));
            uploadCanvas = document.createElement('canvas');
            uploadCanvas.width = Math.round(bmp.width * s); uploadCanvas.height = Math.round(bmp.height * s);
            uploadCanvas.getContext('2d').drawImage(bmp, 0, 0, uploadCanvas.width, uploadCanvas.height);
            uploadInfo.textContent = `${f.name} loaded.`;
          } catch (err) { ui.reportError(err, 'signature'); }
        },
      });
      const colors = h('div', { class: 'btn-row', role: 'radiogroup', 'aria-label': 'Ink colour' },
        ...[['#10204a', 'Navy'], ['#111111', 'Black'], ['#1d4ed8', 'Blue']].map(([c, name]) =>
          h('label', { class: 'check' }, h('input', { type: 'radio', name: 'ink', value: c, checked: c === inkColor, onchange: () => { inkColor = c; } }), name)));
      const clearBtn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: clearPad }, 'Clear');
      const panes = {
        draw: h('div', null, pad),
        type: h('div', null, typed),
        upload: h('div', null, upload, uploadInfo),
      };
      const inkRow = h('div', { class: 'list-toolbar', style: { marginTop: '10px' } }, colors, clearBtn);
      const tabs = h('div', { class: 'tabs', role: 'tablist' },
        ...[['draw', 'Draw'], ['type', 'Type'], ['upload', 'Upload']].map(([k, label]) =>
          h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === tab), dataset: { tab: k }, onclick: () => select(k) }, label)));
      const body = h('div', null, tabs, panes.draw, panes.type, panes.upload, inkRow);
      function select(k) {
        tab = k;
        tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === k)));
        Object.entries(panes).forEach(([key, el]) => { el.hidden = key !== k; });
        inkRow.hidden = k === 'upload';
        clearBtn.hidden = k !== 'draw';
        if (k === 'draw') sizePad();
        if (k === 'type') typed.focus();
      }

      // drawing pad
      let drawing = false, last = null, hasInk = false;
      const padCtx = pad.getContext('2d', { willReadFrequently: true });
      function sizePad() {
        const r = pad.getBoundingClientRect();
        if (!r.width) return;
        const dpr = Math.min(global.devicePixelRatio || 1, 2);
        if (pad.width === Math.round(r.width * dpr)) return;
        // keep any ink already drawn when the pad is (re)sized
        const copy = hasInk ? Object.assign(document.createElement('canvas'), { width: pad.width, height: pad.height }) : null;
        if (copy) copy.getContext('2d').drawImage(pad, 0, 0);
        pad.width = Math.round(r.width * dpr); pad.height = Math.round(r.height * dpr);
        if (copy) padCtx.drawImage(copy, 0, 0, pad.width, pad.height);
      }
      function clearPad() { padCtx.clearRect(0, 0, pad.width, pad.height); hasInk = false; }
      function pt(e) { const r = pad.getBoundingClientRect(); return { x: (e.clientX - r.left) * (pad.width / r.width), y: (e.clientY - r.top) * (pad.height / r.height), p: e.pressure || 0.5 }; }
      pad.addEventListener('pointerdown', (e) => { drawing = true; last = pt(e); pad.setPointerCapture(e.pointerId); e.preventDefault(); });
      pad.addEventListener('pointermove', (e) => {
        if (!drawing) return;
        const p = pt(e);
        const ctx = padCtx;
        const dpr = pad.width / pad.getBoundingClientRect().width;
        ctx.strokeStyle = inkColor; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.lineWidth = (e.pointerType === 'pen' ? 1.2 + p.p * 2.6 : 2.6) * dpr;
        ctx.beginPath(); ctx.moveTo(last.x, last.y);
        ctx.quadraticCurveTo(last.x, last.y, (last.x + p.x) / 2, (last.y + p.y) / 2);
        ctx.lineTo(p.x, p.y); ctx.stroke();
        last = p; hasInk = true;
      });
      const end = () => { drawing = false; };
      pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end);

      async function finish() {
        let canvas = null;
        if (tab === 'draw') { if (!hasInk) { ui.toast('Draw your signature first.', 'error'); return false; } canvas = trimCanvas(pad); }
        else if (tab === 'type') {
          const name = typed.value.trim();
          if (!name) { ui.toast('Type your name first.', 'error'); typed.focus(); return false; }
          canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          const font = `96px ${getComputedStyle(typed).fontFamily}`;
          ctx.font = font;
          canvas.width = Math.ceil(ctx.measureText(name).width + 40); canvas.height = 150;
          ctx.font = font; ctx.fillStyle = inkColor; ctx.textBaseline = 'middle';
          ctx.fillText(name, 20, 75);
          canvas = trimCanvas(canvas);
        } else {
          if (!uploadCanvas) { ui.toast('Choose an image first.', 'error'); return false; }
          canvas = uploadCanvas;
        }
        if (!canvas) { ui.toast('The signature is empty.', 'error'); return false; }
        resolved = true;
        resolve(await canvasToImageItem(canvas));
        return true;
      }
      let resolved = false;
      ui.modal({
        title: 'Create your signature', body,
        actions: [{ label: 'Cancel' }, { label: 'Use signature', primary: true, onClick: finish }],
        onClose: () => { if (!resolved) resolve(null); },
      });
      select('draw');
      requestAnimationFrame(sizePad);
    });
  }

  /* --------------------------------------------------------------- tool */
  PS.tools.register({
    id: 'sign',
    name: 'Sign & annotate',
    category: 'edit',
    icon: 'pen',
    isNew: true,
    description: 'Add your signature, text, dates and images anywhere.',
    longDescription: 'Sign documents and fill them in: draw, type or upload a signature, add text, dates and images, then drag them into place.',
    keywords: ['signature', 'esign', 'fill', 'annotate', 'text box', 'add text', 'date', 'initials', 'image'],
    mount(root) {
      return PS.kit.pdfTool(root, {
        dropTitle: 'Choose a PDF to sign or fill in',
        async onLoad(handle, view) {
          const scratch = await global.PDFLib.PDFDocument.create();
          const measureFont = await scratch.embedFont(global.PDFLib.StandardFonts.Helvetica);
          const annots = [];
          let selectedId = null;
          let pageNo = 1;
          let pageInfo = null; // {W, H} display points of the current page
          let pxPerPt = 1;

          const stage = h('div', { class: 'viewer-page' });
          const layer = h('div', { class: 'annot-layer', role: 'group', 'aria-label': 'Items on this page' });
          const viewer = h('div', { class: 'viewer' }, stage);
          const label = h('span', { 'aria-live': 'polite' });
          const prev = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Previous page', onclick: () => go(pageNo - 1) }, icon('chevron-left'));
          const next = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Next page', onclick: () => go(pageNo + 1) }, icon('chevron-right'));
          const imgPicker = ui.dropzone({ accept: 'image/*', filter: isImage, onFiles: ([f]) => addImageFile(f) });
          const toolbar = h('div', { class: 'grid-toolbar', role: 'toolbar', 'aria-label': 'Add to page' },
            h('button', { class: 'btn btn-sm', type: 'button', onclick: addSignature }, icon('signature', 'icon-sm'), 'Signature'),
            h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => addText('Your text') }, icon('type', 'icon-sm'), 'Text'),
            h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => addText(new Date().toLocaleDateString()) }, icon('calendar', 'icon-sm'), 'Date'),
            h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: addCheck }, icon('check', 'icon-sm'), 'Check'),
            h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => imgPicker.open() }, icon('image', 'icon-sm'), 'Image'),
            h('span', { class: 'count' }, h('span', { class: 'pager' }, prev, label, next)));

          // properties panel
          const propText = h('textarea', { 'aria-label': 'Text content', style: { minHeight: '90px' } });
          const propSize = ui.range({ min: 6, max: 72, value: 14, format: (v) => v + ' pt', label: 'Font size' });
          const propColor = h('input', { type: 'color', value: '#111111', 'aria-label': 'Text colour' });
          const textProps = h('div', null, ui.field('Text', propText), h('div', { class: 'field-row' }, ui.field('Size', propSize), ui.field('Colour', propColor)));
          const noneSel = h('p', { class: 'hint' }, 'Add an item, then drag it into place. Select an item to edit it; use arrow keys to nudge and Delete to remove.');
          const delBtn = h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => removeAnnot(selectedId) }, icon('trash', 'icon-sm'), 'Delete item');
          const propsPanel = PS.kit.panel('Selected item', noneSel, textProps, h('div', { style: { marginTop: '12px' } }, delBtn));
          const countEl = h('p', { class: 'hint', style: { marginBottom: '12px' } });
          const saveBtn = view.actionButton('Save signed PDF', 'download', exportPdf);

          view.workspace.insertBefore(toolbar, view.result);
          view.workspace.insertBefore(viewer, view.result);
          view.options.append(propsPanel, PS.kit.panel('Finish', countEl, saveBtn),
            ui.note('Signatures added here are visual (an image of your signature). They are not certificate-based digital signatures.'));

          propText.addEventListener('input', () => { const a = sel(); if (a && a.type === 'text') { a.text = propText.value || ' '; measure(a); draw(); } });
          propSize.input.addEventListener('input', () => { const a = sel(); if (a && a.type === 'text') { a.size = +propSize.input.value; measure(a); draw(); } });
          propColor.addEventListener('input', () => { const a = sel(); if (a && a.type === 'text') { a.color = propColor.value; draw(); } });

          function sel() { return annots.find((a) => a.id === selectedId) || null; }

          /* ----- page rendering ----- */
          async function go(n) {
            pageNo = clamp(n, 1, handle.pageCount);
            prev.disabled = pageNo <= 1; next.disabled = pageNo >= handle.pageCount;
            label.textContent = `Page ${pageNo} / ${handle.pageCount}`;
            const width = Math.max(260, Math.min(900, viewer.clientWidth - 36));
            try {
              const c = await PS.engine.renderPage(handle.pdfjs, pageNo, { width, hidpi: true });
              const old = stage.querySelector('canvas');
              if (old) PS.engine.releaseCanvas(old);
              const page = await handle.pdfjs.getPage(pageNo);
              const vp = page.getViewport({ scale: 1 });
              pageInfo = { W: vp.width, H: vp.height };
              pxPerPt = c.pdfScale; // CSS px per PDF point
              stage.replaceChildren(c, layer);
              if (selectedId && sel()?.page !== pageNo) select(null);
              draw();
            } catch (err) { ui.reportError(err, 'sign'); }
          }
          const onResize = debounce(() => go(pageNo), 200);
          global.addEventListener('resize', onResize);

          /* ----- model helpers (fractions of the displayed page) ----- */
          function measure(a) {
            if (a.type !== 'text' || !pageInfo) return;
            const lines = a.text.split('\n');
            const safe = (s) => { try { return measureFont.widthOfTextAtSize(s, a.size); } catch (_) { return s.length * a.size * 0.55; } };
            a.w = (Math.max(...lines.map(safe)) + 2) / pageInfo.W;
            a.h = (lines.length * a.size * LINE_H) / pageInfo.H;
          }
          function addAnnot(a) {
            a.id = uid('an'); a.page = pageNo;
            if (a.type === 'text') measure(a);
            // centre of the part of the page currently visible on screen
            const r = stage.getBoundingClientRect();
            const top = Math.max(r.top, 70), bottom = Math.min(r.bottom, global.innerHeight);
            const cy = r.height ? clamp(((top + bottom) / 2 - r.top) / r.height, 0, 1) : 0.5;
            const offset = (annots.filter((o) => o.page === pageNo).length % 5) * 0.03; // cascade new items
            a.x = clamp(0.5 - a.w / 2 + offset, 0, 1 - a.w); a.y = clamp(cy - a.h / 2 + offset, 0, 1 - a.h);
            annots.push(a);
            select(a.id);
            draw();
            // focus after any closing dialog has restored focus, so the new item stays selected
            setTimeout(() => { select(a.id); layer.querySelector(`[data-id="${a.id}"]`)?.focus({ preventScroll: true }); }, 0);
          }
          function addText(text, size) { addAnnot({ type: 'text', text, size: size || 14, color: '#111111' }); }
          function addImage(item, widthPt) {
            const wPt = Math.min(widthPt, pageInfo.W * 0.8);
            addAnnot({ type: 'image', url: item.url, bytes: item.bytes, aspect: item.aspect, w: wPt / pageInfo.W, h: (wPt * item.aspect) / pageInfo.H });
          }
          async function addSignature() {
            if (lastSignature) {
              const choice = await reuseLast();
              if (choice === 'cancel') return;
              if (choice === 'reuse') { addImage(lastSignature, 170); return; }
            }
            const item = await signatureDialog();
            if (!item) return;
            lastSignature = item;
            addImage(item, 170);
          }
          /** Ask whether to reuse this session's signature. Resolves 'reuse' | 'new' | 'cancel'. */
          function reuseLast() {
            return new Promise((resolve) => {
              let answer = 'cancel';
              ui.modal({
                title: 'Add signature',
                body: h('div', null, h('p', { style: { marginBottom: '12px' } }, 'Use the signature you created earlier?'),
                  h('img', { src: lastSignature.url, alt: 'Previous signature', style: { maxHeight: '90px', background: '#fff', borderRadius: '8px', padding: '6px' } })),
                actions: [{ label: 'Create new', onClick: () => { answer = 'new'; } }, { label: 'Use it', primary: true, onClick: () => { answer = 'reuse'; } }],
                onClose: () => resolve(answer),
              });
            });
          }
          /** A tick mark drawn as a transparent PNG (standard PDF fonts have no ✓ glyph). */
          async function addCheck() {
            const c = document.createElement('canvas');
            c.width = c.height = 96;
            const ctx = c.getContext('2d');
            ctx.strokeStyle = '#111'; ctx.lineWidth = 12; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
            ctx.beginPath(); ctx.moveTo(14, 52); ctx.lineTo(38, 78); ctx.lineTo(84, 18); ctx.stroke();
            addImage(await canvasToImageItem(c), 16);
          }
          async function addImageFile(file) {
            try {
              const bmp = await PS.engine.decodeImage(file);
              const max = 1600, s = Math.min(1, max / Math.max(bmp.width, bmp.height));
              const c = document.createElement('canvas');
              c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
              c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
              const item = await canvasToImageItem(c);
              PS.engine.releaseCanvas(c);
              addImage(item, 200);
            } catch (err) { ui.reportError(err, 'image'); }
          }
          function removeAnnot(id) {
            const i = annots.findIndex((a) => a.id === id);
            if (i < 0) return;
            const [a] = annots.splice(i, 1);
            if (a.type === 'image' && a.url !== lastSignature?.url) URL.revokeObjectURL(a.url);
            select(null);
            draw();
          }
          function select(id) {
            selectedId = id;
            const a = sel();
            noneSel.hidden = !!a;
            textProps.hidden = !a || a.type !== 'text';
            delBtn.parentElement.hidden = !a;
            if (a && a.type === 'text') {
              propText.value = a.text; propSize.input.value = a.size; propSize.input.dispatchEvent(new Event('input')); propColor.value = a.color;
            }
            layer.querySelectorAll('.annot').forEach((el) => el.classList.toggle('is-selected', el.dataset.id === id));
          }

          /* ----- view ----- */
          function draw() {
            const onPage = annots.filter((a) => a.page === pageNo);
            const existing = new Map(Array.from(layer.children).map((el) => [el.dataset.id, el]));
            for (const [id, el] of existing) if (!onPage.some((a) => a.id === id)) el.remove();
            for (const a of onPage) {
              let el = existing.get(a.id);
              if (!el) { el = createEl(a); layer.appendChild(el); }
              el.style.left = a.x * 100 + '%'; el.style.top = a.y * 100 + '%';
              el.style.width = a.w * 100 + '%'; el.style.height = a.h * 100 + '%';
              if (a.type === 'text') {
                const t = el.querySelector('.annot-text');
                t.textContent = a.text;
                t.style.fontSize = a.size * pxPerPt + 'px';
                t.style.color = a.color;
              }
              el.classList.toggle('is-selected', a.id === selectedId);
            }
            const total = annots.length;
            const pages = new Set(annots.map((a) => a.page)).size;
            countEl.textContent = total ? `${plural(total, 'item')} on ${plural(pages, 'page')}.` : 'Nothing added yet.';
            saveBtn.disabled = !total;
          }

          function createEl(a) {
            const el = h('div', {
              class: 'annot', tabindex: '0', role: 'button', dataset: { id: a.id },
              'aria-label': `${a.type === 'text' ? 'Text: ' + a.text : 'Image'} — drag or use arrow keys to move, Delete to remove`,
            },
              a.type === 'text' ? h('div', { class: 'annot-text' }) : h('img', { src: a.url, alt: '' }),
              h('span', { class: 'handle', 'aria-hidden': 'true' }),
              h('button', { class: 'annot-del', type: 'button', 'aria-label': 'Delete item', onclick: (e) => { e.stopPropagation(); removeAnnot(a.id); } }, icon('x')));
            el.addEventListener('pointerdown', (e) => startDrag(e, a, e.target.classList.contains('handle')));
            el.addEventListener('focus', () => { if (selectedId !== a.id) select(a.id); });
            el.addEventListener('dblclick', () => { if (a.type === 'text') { propText.focus(); propText.select(); } });
            el.addEventListener('keydown', (e) => {
              const step = e.shiftKey ? 0.05 : 0.005;
              const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
              if (moves[e.key]) {
                e.preventDefault();
                if (e.altKey) resizeBy(a, moves[e.key][0] || -moves[e.key][1]);
                else { a.x = clamp(a.x + moves[e.key][0], 0, 1 - a.w); a.y = clamp(a.y + moves[e.key][1], 0, 1 - a.h); }
                draw();
              } else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeAnnot(a.id); }
            });
            return el;
          }

          function resizeBy(a, delta) {
            const factor = clamp(1 + delta * 4, 0.5, 1.5);
            if (a.type === 'text') { a.size = clamp(a.size * factor, 4, 144); measure(a); propSize.input.value = Math.round(a.size); propSize.input.dispatchEvent(new Event('input')); }
            else { const w = clamp(a.w * factor, 0.02, 1); a.h = (a.h / a.w) * w; a.w = w; }
            a.x = clamp(a.x, 0, Math.max(0, 1 - a.w)); a.y = clamp(a.y, 0, Math.max(0, 1 - a.h));
          }

          function startDrag(e, a, resizing) {
            if (e.button !== 0 && e.pointerType === 'mouse') return;
            if (e.target.closest('.annot-del')) return;
            e.preventDefault();
            select(a.id);
            const el = e.currentTarget;
            el.focus({ preventScroll: true });
            const rect = layer.getBoundingClientRect();
            const start = { x: e.clientX, y: e.clientY, ax: a.x, ay: a.y, aw: a.w, ah: a.h, size: a.size };
            el.setPointerCapture(e.pointerId);
            const move = (ev) => {
              const fx = (ev.clientX - start.x) / rect.width, fy = (ev.clientY - start.y) / rect.height;
              if (resizing) {
                const w = clamp(start.aw + fx, 0.02, 1 - a.x);
                const ratio = w / start.aw;
                if (a.type === 'text') { a.size = clamp(start.size * ratio, 4, 144); measure(a); }
                else { a.w = w; a.h = start.ah * ratio; }
              } else {
                a.x = clamp(start.ax + fx, 0, 1 - a.w);
                a.y = clamp(start.ay + fy, 0, 1 - a.h);
              }
              draw();
            };
            const up = () => {
              el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
              if (a.type === 'text') { propSize.input.value = Math.round(a.size); propSize.input.dispatchEvent(new Event('input')); }
            };
            el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
          }
          layer.addEventListener('pointerdown', (e) => { if (e.target === layer) select(null); });

          /* ----- export ----- */
          async function exportPdf() {
            const blob = await ui.run('Saving signed PDF…', async () => {
              const doc = await PS.engine.loadPdfLib(handle.bytes);
              const font = await doc.embedFont(global.PDFLib.StandardFonts.Helvetica);
              const pages = doc.getPages();
              const embedded = new Map();
              for (const a of annots) {
                const page = pages[a.page - 1];
                const box = PS.engine.displayBox(page);
                const x = a.x * box.width, top = a.y * box.height;
                if (a.type === 'image') {
                  if (!embedded.has(a.url)) embedded.set(a.url, await doc.embedPng(a.bytes));
                  const w = a.w * box.width, hh = a.h * box.height;
                  PS.engine.drawImageDisplay(page, embedded.get(a.url), { dx: x, dy: top + hh, width: w, height: hh });
                } else {
                  const [r, g, b] = hexToRgb01(a.color);
                  let text = a.text;
                  try { font.encodeText(text.replace(/\n/g, '')); } catch (_) { text = Array.from(text).map((ch) => { if (ch === '\n') return ch; try { font.encodeText(ch); return ch; } catch (e) { return '?'; } }).join(''); }
                  PS.engine.drawTextDisplay(page, text, { dx: x + 1, dy: top + a.size * BASELINE, size: a.size, font, color: global.PDFLib.rgb(r, g, b), lineHeight: LINE_H });
                }
              }
              return PS.engine.saveToBlob(doc);
            }, 'sign');
            if (blob) ui.showResult(view.result, { blob, filename: `${baseName(handle.name)}_signed.pdf`, detail: plural(annots.length, 'item') + ' added' });
          }

          select(null);
          requestAnimationFrame(() => go(1));
          return () => {
            global.removeEventListener('resize', onResize);
            annots.forEach((a) => { if (a.type === 'image' && a.url !== lastSignature?.url) URL.revokeObjectURL(a.url); });
          };
        },
      });
    },
  });
})(window);
