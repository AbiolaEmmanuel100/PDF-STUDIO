/**
 * Tool: PDF → images
 * Render pages to PNG or JPG at a chosen resolution. Several pages are bundled into a .zip.
 */
(function (global) {
  'use strict';
  const PS = global.PS;
  const { h, plural, baseName, canvasToBlob } = PS.util;
  const ui = PS.ui;

  PS.tools.register({
    id: 'pdf-to-images',
    name: 'PDF to images',
    category: 'convert',
    icon: 'file-image',
    isNew: true,
    description: 'Save pages as high-quality PNG or JPG images.',
    longDescription: 'Export every page — or just the ones you select — as PNG or JPG images at the resolution you need.',
    keywords: ['pdf to jpg', 'pdf to png', 'export images', 'render', 'convert'],
    mount(root) {
      return PS.kit.pdfTool(root, {
        dropTitle: 'Choose a PDF to convert to images',
        onLoad(handle, view) {
          const sel = PS.kit.pageSelector(handle, { label: 'Pages — select which to export (none = all)', onSelection: summary });
          const format = ui.segmented('fmt', [['png', 'PNG'], ['jpg', 'JPG']], 'png', 'Image format');
          const dpi = ui.select([[72, '72 DPI — screen'], [150, '150 DPI — standard'], [200, '200 DPI — sharp'], [300, '300 DPI — print']], 150);
          const quality = ui.range({ min: 50, max: 100, step: 1, value: 90, format: (v) => v + '%', label: 'JPG quality' });
          const qualityField = ui.field('JPG quality', quality);
          const info = h('p', { class: 'hint', style: { marginTop: '10px' }, 'aria-live': 'polite' });
          const btn = view.actionButton('Convert to images', 'download', run);
          const rangeField = ui.field('Pages (blank = all)', sel.rangeInput);
          rangeField.appendChild(sel.rangeHint);
          format.onChange(() => { qualityField.hidden = format.value !== 'jpg'; summary(); });
          dpi.addEventListener('change', summary);
          qualityField.hidden = true;
          view.workspace.insertBefore(sel.toolbar, view.result);
          view.workspace.insertBefore(sel.grid.el, view.result);
          view.options.append(
            PS.kit.panel('Image settings', ui.field('Format', format.el), ui.field('Resolution', dpi), qualityField,
              ui.note('PNG is lossless (best for text & diagrams). JPG makes much smaller files for photos.')),
            PS.kit.panel('Pages', rangeField, info, h('div', { style: { marginTop: '16px' } }, btn)));

          function targets() { const i = sel.indices(); return i.length ? i : [...Array(handle.pageCount).keys()]; }
          function summary() {
            const n = targets().length;
            info.textContent = `${plural(n, 'image')} will be created${n > 1 ? ' and saved as a .zip' : ''}.`;
          }
          summary();

          async function run() {
            const pages = targets();
            const isJpg = format.value === 'jpg';
            const scale = parseInt(dpi.value, 10) / 72;
            const q = parseInt(quality.input.value, 10) / 100;
            const base = baseName(handle.name);
            const pad = String(handle.pageCount).length;
            const out = await ui.run('Rendering pages…', async (busy) => {
              const files = [];
              for (let k = 0; k < pages.length; k++) {
                busy.progress(k, pages.length, `Page ${pages[k] + 1} (${k + 1} of ${pages.length})`);
                const canvas = await PS.engine.renderPage(handle.pdfjs, pages[k] + 1, { scale });
                const blob = await canvasToBlob(canvas, isJpg ? 'image/jpeg' : 'image/png', isJpg ? q : undefined);
                PS.engine.releaseCanvas(canvas);
                files.push({ name: `${base}_page-${String(pages[k] + 1).padStart(pad, '0')}.${isJpg ? 'jpg' : 'png'}`, blob });
              }
              if (files.length === 1) return { blob: files[0].blob, name: files[0].name };
              busy.message('Creating .zip…');
              const entries = [];
              for (const f of files) entries.push({ name: f.name, data: new Uint8Array(await f.blob.arrayBuffer()) });
              return { blob: PS.util.zip(entries), name: `${base}_images.zip` };
            }, 'pdf-to-images');
            if (out) ui.showResult(view.result, { blob: out.blob, filename: out.name, detail: `${plural(pages.length, 'image')} · ${dpi.value} DPI` });
          }
          return () => sel.grid.destroy();
        },
      });
    },
  });
})(window);
