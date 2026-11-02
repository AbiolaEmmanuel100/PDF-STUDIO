/**
 * Tool: Watermark / stamp
 * Stamp text (e.g. CONFIDENTIAL, DRAFT) or an image (logo) onto pages, with position, tiling,
 * rotation, size, colour and opacity — previewed live with the same geometry used for export.
 * (Supersedes the original "Add Text / Stamp" tool; its defaults reproduce that behaviour.)
 */
(function (global) {
  'use strict';
  const PS = global.PS;
  const { h, icon, plural, baseName, isImage, hexToRgb01, debounce } = PS.util;
  const ui = PS.ui;

  const FONTS = {
    HelveticaBold: 'bold {size} Helvetica, Arial, sans-serif',
    Helvetica: '{size} Helvetica, Arial, sans-serif',
    TimesRomanBold: 'bold {size} "Times New Roman", Times, serif',
    CourierBold: 'bold {size} "Courier New", Courier, monospace',
  };

  PS.tools.register({
    id: 'watermark',
    name: 'Watermark & stamp',
    category: 'edit',
    icon: 'droplet',
    description: 'Stamp text or a logo on pages — CONFIDENTIAL, DRAFT, your brand.',
    longDescription: 'Add a text or image watermark to all or some pages. Choose position, tiling, angle, size, colour and transparency with a live preview.',
    keywords: ['stamp', 'confidential', 'draft', 'logo', 'overlay', 'add text', 'brand'],
    mount(root) {
      return PS.kit.pdfTool(root, {
        dropTitle: 'Choose a PDF to watermark',
        async onLoad(handle, view) {
          const measureDoc = await global.PDFLib.PDFDocument.create();
          const fontCache = {};
          const getFont = async (doc, name, cache) => cache[name] || (cache[name] = await doc.embedFont(global.PDFLib.StandardFonts[name]));

          const kind = ui.segmented('kind', [['text', 'Text'], ['image', 'Image']], 'text', 'Watermark type');
          const text = h('input', { type: 'text', value: 'CONFIDENTIAL', maxlength: 200 });
          const font = ui.select([['HelveticaBold', 'Helvetica Bold'], ['Helvetica', 'Helvetica'], ['TimesRomanBold', 'Times Bold'], ['CourierBold', 'Courier Bold']], 'HelveticaBold');
          const size = ui.range({ min: 8, max: 160, value: 60, format: (v) => v + ' pt', label: 'Font size' });
          const color = h('input', { type: 'color', value: '#cc1a1a', 'aria-label': 'Text colour' });
          let imgFile = null, imgEl = null, imgUrl = null;
          const imgName = h('span', { class: 'hint' }, 'No image chosen');
          const imgPicker = ui.dropzone({
            compact: true, title: 'Choose image', subtitle: 'PNG with transparency works best', accept: 'image/*', filter: isImage, icon: 'image',
            onFiles: async ([f]) => {
              if (imgUrl) URL.revokeObjectURL(imgUrl);
              imgUrl = URL.createObjectURL(f);
              const el = new Image(); el.src = imgUrl;
              try { await el.decode(); } catch (_) { ui.toast('That image could not be read.', 'error'); return; }
              imgFile = f; imgEl = el; imgName.textContent = f.name; preview.refresh();
            },
          });
          const imgScale = ui.range({ min: 5, max: 100, value: 35, format: (v) => v + '%', label: 'Image width (% of page)' });
          const opacity = ui.range({ min: 5, max: 100, value: 35, format: (v) => v + '%', label: 'Opacity' });
          const angle = ui.range({ min: -90, max: 90, value: 45, format: (v) => v + '°', label: 'Rotation' });
          const pos = ui.positionGrid('mc', null, 'Watermark position');
          const tile = h('input', { type: 'checkbox' });
          const pages = PS.stamp.pagePicker(handle.pageCount);
          const btn = view.actionButton('Apply watermark', 'droplet', run);

          const textGroup = h('div', null, ui.field('Text', text), ui.field('Font', font),
            h('div', { class: 'field-row' }, ui.field('Size', size), ui.field('Colour', color)));
          const imageGroup = h('div', null, imgPicker, h('div', { style: { margin: '8px 0 12px' } }, imgName), ui.field('Width', imgScale));
          imageGroup.hidden = true;
          kind.onChange((v) => { textGroup.hidden = v !== 'text'; imageGroup.hidden = v !== 'image'; preview.refresh(); });

          /** Shared geometry for preview and export: returns placements in display points. */
          function placements(W, H, measure) {
            const ang = parseFloat(angle.input.value) || 0;
            let w, hh;
            if (kind.value === 'text') { const s = +size.input.value; w = measure(text.value, s); hh = s * 0.72; }
            else { if (!imgEl) return []; w = (W * +imgScale.input.value) / 100; hh = (w * imgEl.naturalHeight) / imgEl.naturalWidth; }
            return PS.stamp.layout(W, H, w, hh, { position: pos.value, angle: ang, tile: tile.checked }).map((c) => {
              const a = PS.engine.anchorForCenter(c.cx, c.cy, w, hh, ang);
              return { dx: a.dx, dy: a.dy, w, h: hh, angle: ang };
            });
          }

          const measureFonts = {};
          for (const k of Object.keys(FONTS)) measureFonts[k] = await getFont(measureDoc, k, fontCache);
          const preview = PS.stamp.previewer(handle, (ctx, info) => {
            const f = measureFonts[font.value];
            const list = placements(info.W, info.H, (t, s) => f.widthOfTextAtSize(t, s));
            const op = +opacity.input.value / 100;
            for (const p of list) {
              if (kind.value === 'text') {
                PS.stamp.canvasText(ctx, text.value, { dx: p.dx, dy: p.dy, size: +size.input.value, cssFont: FONTS[font.value], color: color.value, opacity: op, angle: p.angle });
              } else {
                ctx.save(); ctx.translate(p.dx, p.dy); ctx.rotate((-p.angle * Math.PI) / 180); ctx.globalAlpha = op;
                ctx.drawImage(imgEl, 0, -p.h, p.w, p.h); ctx.restore();
              }
            }
          });
          const refresh = debounce(() => preview.refresh(), 30);
          [text, font, size.input, color, imgScale.input, opacity.input, angle.input, tile].forEach((el) => el.addEventListener('input', refresh));
          [font, tile].forEach((el) => el.addEventListener('change', refresh));
          pos.el.addEventListener('change', refresh);

          view.workspace.insertBefore(preview.el, view.result);
          view.options.append(
            PS.kit.panel('Watermark', kind.el, h('div', { style: { marginTop: '14px' } }, textGroup, imageGroup)),
            PS.kit.panel('Appearance', ui.field('Opacity', opacity), ui.field('Rotation', angle),
              h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Position'), pos.el),
              h('label', { class: 'check', style: { marginTop: '12px' } }, tile, 'Tile across the page')),
            PS.kit.panel('Pages', pages.el, h('div', { style: { marginTop: '16px' } }, btn)));

          async function run() {
            let targets;
            try { targets = pages.indices(); } catch (err) { ui.toast(err.message, 'error'); return; }
            if (kind.value === 'text' && !text.value.trim()) { ui.toast('Enter the watermark text.', 'error'); text.focus(); return; }
            if (kind.value === 'image' && !imgFile) { ui.toast('Choose an image for the watermark.', 'error'); return; }
            const blob = await ui.run('Applying watermark…', async (busy) => {
              const doc = await PS.engine.loadPdfLib(handle.bytes);
              const cache = {};
              const f = kind.value === 'text' ? await getFont(doc, font.value, cache) : null;
              const img = kind.value === 'image' ? await PS.engine.embedImageFile(doc, imgFile) : null;
              const [r, g, b] = hexToRgb01(color.value);
              const op = +opacity.input.value / 100;
              const all = doc.getPages();
              for (let k = 0; k < targets.length; k++) {
                if (k % 20 === 0) { busy.progress(k, targets.length); await PS.util.tick(); }
                const page = all[targets[k]];
                const box = PS.engine.displayBox(page);
                for (const p of placements(box.width, box.height, (t, s) => f.widthOfTextAtSize(t, s))) {
                  if (f) PS.engine.drawTextDisplay(page, text.value, { dx: p.dx, dy: p.dy, size: +size.input.value, font: f, color: global.PDFLib.rgb(r, g, b), opacity: op, angle: p.angle });
                  else PS.engine.drawImageDisplay(page, img, { dx: p.dx, dy: p.dy, width: p.w, height: p.h, opacity: op, angle: p.angle });
                }
              }
              busy.progress(1, 1, 'Saving…');
              return PS.engine.saveToBlob(doc);
            }, 'watermark');
            if (blob) ui.showResult(view.result, { blob, filename: `${baseName(handle.name)}_watermarked.pdf`, detail: `${plural(targets.length, 'page')} stamped` });
          }

          return () => { preview.destroy(); if (imgUrl) URL.revokeObjectURL(imgUrl); };
        },
      });
    },
  });
})(window);
