/**
 * Tool: Compress PDF
 * Two strategies, clearly explained to the user:
 *  - Lossless: rewrite the file with compressed object streams (keeps text, links, forms).
 *  - Strong:   re-render every page as a JPEG image at a chosen resolution/quality. Big savings
 *              for scans and image-heavy files, but text is no longer selectable/searchable.
 */
(function (global) {
  'use strict';
  const PS = global.PS;
  const { h, plural, baseName, formatBytes, canvasToBlob } = PS.util;
  const ui = PS.ui;

  const PRESETS = {
    low: { dpi: 72, q: 50, label: 'Smallest file' },
    medium: { dpi: 110, q: 65, label: 'Balanced' },
    high: { dpi: 150, q: 80, label: 'Better quality' },
  };

  PS.tools.register({
    id: 'compress',
    name: 'Compress PDF',
    category: 'optimize',
    icon: 'minimize',
    description: 'Reduce file size — lossless or strong image compression.',
    longDescription: 'Make PDFs smaller for email and uploads. Choose lossless optimisation, or strong compression that converts pages to images.',
    keywords: ['reduce', 'shrink', 'smaller', 'optimize', 'size'],
    mount(root) {
      return PS.kit.pdfTool(root, {
        dropTitle: 'Choose a PDF to compress',
        onLoad(handle, view) {
          const mode = ui.segmented('cmode', [['lossless', 'Lossless'], ['strong', 'Strong']], 'lossless', 'Compression mode');
          const preset = ui.segmented('preset', Object.entries(PRESETS).map(([k, v]) => [k, v.label]), 'medium', 'Quality preset');
          const dpi = ui.range({ min: 50, max: 220, value: 110, format: (v) => v + ' DPI', label: 'Resolution' });
          const quality = ui.range({ min: 20, max: 95, value: 65, format: (v) => v + '%', label: 'JPEG quality' });
          const gray = h('input', { type: 'checkbox' });
          preset.onChange((k) => {
            dpi.input.value = PRESETS[k].dpi; dpi.input.dispatchEvent(new Event('input'));
            quality.input.value = PRESETS[k].q; quality.input.dispatchEvent(new Event('input'));
          });
          const strongGroup = h('div', { style: { marginTop: '14px' } },
            ui.field('Preset', preset.el), ui.field('Resolution', dpi), ui.field('JPEG quality', quality),
            h('label', { class: 'check', style: { marginTop: '12px' } }, gray, 'Convert to grayscale (smaller)'),
            h('div', { style: { marginTop: '12px' } }, ui.note('Pages become images: text can no longer be selected, searched or copied, and links/forms are removed. Best for scans and photo-heavy PDFs.', 'warn')));
          const losslessHelp = h('div', { style: { marginTop: '14px' } }, ui.note('Rewrites the file structure with compressed object streams. Nothing visible changes; savings depend on how the PDF was made (often 0–30%).'));
          strongGroup.hidden = true;
          mode.onChange((v) => { strongGroup.hidden = v !== 'strong'; losslessHelp.hidden = v === 'strong'; });

          const stats = h('div', { class: 'stats' },
            stat('Original', formatBytes(handle.size)), stat('Pages', String(handle.pageCount)));
          const btn = view.actionButton('Compress PDF', 'minimize', run);
          view.workspace.insertBefore(PS.kit.panel('Size', stats), view.result);
          view.options.append(PS.kit.panel('Compression', mode.el, losslessHelp, strongGroup, h('div', { style: { marginTop: '16px' } }, btn)));

          function stat(label, value) { return h('div', { class: 'stat' }, h('b', null, value), h('span', null, label)); }

          async function run() {
            const strong = mode.value === 'strong';
            const blob = await ui.run(strong ? 'Compressing pages…' : 'Optimising…', async (busy) => {
              if (!strong) {
                const doc = await PS.engine.loadPdfLib(handle.bytes);
                return new Blob([await doc.save({ useObjectStreams: true })], { type: 'application/pdf' });
              }
              const out = await PS.engine.createPdfLib();
              const scale = +dpi.input.value / 72;
              const q = +quality.input.value / 100;
              for (let i = 1; i <= handle.pageCount; i++) {
                busy.progress(i - 1, handle.pageCount, `Page ${i} of ${handle.pageCount}`);
                const page = await handle.pdfjs.getPage(i);
                const vp = page.getViewport({ scale: 1, rotation: 0 });
                const rot = page.rotate;
                page.cleanup();
                const canvas = await PS.engine.renderPage(handle.pdfjs, i, { scale, rotation: 0 });
                if (gray.checked) toGray(canvas);
                const jpg = new Uint8Array(await (await canvasToBlob(canvas, 'image/jpeg', q)).arrayBuffer());
                PS.engine.releaseCanvas(canvas);
                const img = await out.embedJpg(jpg);
                const p = out.addPage([vp.width, vp.height]);
                p.drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height });
                if (rot) p.setRotation(global.PDFLib.degrees(rot));
                await PS.util.tick();
              }
              busy.progress(1, 1, 'Saving…');
              return PS.engine.saveToBlob(out);
            }, 'compress');
            if (!blob) return;
            const saved = 1 - blob.size / handle.size;
            stats.replaceChildren(
              stat('Original', formatBytes(handle.size)),
              stat('Compressed', formatBytes(blob.size)),
              stat(saved >= 0 ? 'Saved' : 'Larger by', Math.abs(Math.round(saved * 100)) + '%'),
              stat('Pages', String(handle.pageCount)));
            if (saved <= 0.01) ui.toast(strong ? 'The result isn’t smaller — try a lower resolution or quality.' : 'This PDF is already well optimised. Try “Strong” for a smaller file (pages become images).', 'warning', { timeout: 8000 });
            ui.showResult(view.result, { blob, filename: `${baseName(handle.name)}_compressed.pdf`, detail: `${saved > 0 ? Math.round(saved * 100) + '% smaller' : 'no reduction'} · ${plural(handle.pageCount, 'page')}` });
          }

          function toGray(canvas) {
            const ctx = canvas.getContext('2d');
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const d = img.data;
            for (let i = 0; i < d.length; i += 4) {
              const y = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
              d[i] = d[i + 1] = d[i + 2] = y;
            }
            ctx.putImageData(img, 0, 0);
          }
          return null;
        },
      });
    },
  });
})(window);
