/**
 * Tool: Add page numbers
 * Number pages with a choice of format, position, size, colour and starting number.
 * Positions are relative to the page as displayed, so rotated pages are numbered correctly.
 */
(function (global) {
  'use strict';
  const PS = global.PS;
  const { h, plural, baseName, hexToRgb01, debounce } = PS.util;
  const ui = PS.ui;

  const FORMATS = [['{n}', '1'], ['Page {n}', 'Page 1'], ['Page {n} of {total}', 'Page 1 of 9'], ['{n} / {total}', '1 / 9'], ['– {n} –', '– 1 –']];

  PS.tools.register({
    id: 'page-numbers',
    name: 'Page numbers',
    category: 'edit',
    icon: 'hash',
    isNew: true,
    description: 'Add “Page 1 of N” style numbers to your PDF.',
    longDescription: 'Insert page numbers in the header or footer, in the format and style you want. Skip a cover page or start from any number.',
    keywords: ['numbering', 'paginate', 'footer', 'header', 'bates'],
    mount(root) {
      return PS.kit.pdfTool(root, {
        dropTitle: 'Choose a PDF to number',
        async onLoad(handle, view) {
          const scratch = await global.PDFLib.PDFDocument.create();
          const measureFont = await scratch.embedFont(global.PDFLib.StandardFonts.Helvetica);
          const format = ui.select(FORMATS, 'Page {n} of {total}');
          const pos = ui.positionGrid('bc', ['tl', 'tc', 'tr', 'bl', 'bc', 'br'], 'Number position');
          const size = ui.range({ min: 6, max: 36, value: 11, format: (v) => v + ' pt', label: 'Font size' });
          const color = h('input', { type: 'color', value: '#444444', 'aria-label': 'Number colour' });
          const margin = ui.range({ min: 10, max: 90, value: 28, format: (v) => v + ' pt', label: 'Distance from edge' });
          const start = h('input', { type: 'number', value: 1, min: 0, max: 99999 });
          const pages = PS.stamp.pagePicker(handle.pageCount);
          const btn = view.actionButton('Add page numbers', 'hash', run);

          function targets() { try { return pages.indices(); } catch (_) { return []; } }
          function labelFor(pageIndex, list) {
            const k = list.indexOf(pageIndex);
            if (k < 0) return null;
            const s = parseInt(start.value, 10);
            const first = Number.isFinite(s) ? s : 1;
            return format.value.replace('{n}', String(first + k)).replace('{total}', String(first - 1 + list.length));
          }
          function place(W, H, label, fs) {
            const w = measureFont.widthOfTextAtSize(label, fs);
            const [c] = PS.stamp.layout(W, H, w, fs * 0.72, { position: pos.value, margin: +margin.input.value });
            return PS.engine.anchorForCenter(c.cx, c.cy, w, fs * 0.72, 0);
          }

          const preview = PS.stamp.previewer(handle, (ctx, info) => {
            const label = labelFor(info.page - 1, targets());
            if (!label) return;
            const fs = +size.input.value;
            const a = place(info.W, info.H, label, fs);
            PS.stamp.canvasText(ctx, label, { dx: a.dx, dy: a.dy, size: fs, cssFont: '{size} Helvetica, Arial, sans-serif', color: color.value, opacity: 1, angle: 0 });
          });
          const refresh = debounce(() => preview.refresh(), 30);
          [format, size.input, color, margin.input, start, pages.mode, pages.custom].forEach((el) => { el.addEventListener('input', refresh); el.addEventListener('change', refresh); });
          pos.el.addEventListener('change', refresh);

          view.workspace.insertBefore(preview.el, view.result);
          view.options.append(
            PS.kit.panel('Format', ui.field('Style', format), ui.field('Start at', start, 'The first numbered page gets this number.')),
            PS.kit.panel('Appearance',
              h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Position'), pos.el),
              ui.field('Font size', size), ui.field('Distance from edge', margin), ui.field('Colour', color)),
            PS.kit.panel('Pages', pages.el, h('div', { style: { marginTop: '16px' } }, btn)));

          async function run() {
            let list;
            try { list = pages.indices(); } catch (err) { ui.toast(err.message, 'error'); return; }
            const blob = await ui.run('Numbering pages…', async (busy) => {
              const doc = await PS.engine.loadPdfLib(handle.bytes);
              const font = await doc.embedFont(global.PDFLib.StandardFonts.Helvetica);
              const [r, g, b] = hexToRgb01(color.value);
              const fs = +size.input.value;
              const all = doc.getPages();
              for (let k = 0; k < list.length; k++) {
                if (k % 25 === 0) { busy.progress(k, list.length); await PS.util.tick(); }
                const page = all[list[k]];
                const box = PS.engine.displayBox(page);
                const label = labelFor(list[k], list);
                const a = place(box.width, box.height, label, fs);
                PS.engine.drawTextDisplay(page, label, { dx: a.dx, dy: a.dy, size: fs, font, color: global.PDFLib.rgb(r, g, b) });
              }
              busy.progress(1, 1, 'Saving…');
              return PS.engine.saveToBlob(doc);
            }, 'page-numbers');
            if (blob) ui.showResult(view.result, { blob, filename: `${baseName(handle.name)}_numbered.pdf`, detail: `${plural(list.length, 'page')} numbered` });
          }
          return () => preview.destroy();
        },
      });
    },
  });
})(window);
