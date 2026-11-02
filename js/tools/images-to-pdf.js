/**
 * Tool: Images → PDF
 * JPG, PNG, WebP, GIF, BMP… to a PDF, one image per page. PNG/JPEG are embedded losslessly;
 * phone photos with EXIF rotation are auto-straightened.
 */
(function (global) {
  'use strict';
  const PS = global.PS;
  const { h, icon, formatBytes, plural, isImage, uid } = PS.util;
  const ui = PS.ui;

  const SIZES = { A4: [595.28, 841.89], Letter: [612, 792], Legal: [612, 1008], A5: [419.53, 595.28] };

  PS.tools.register({
    id: 'images-to-pdf',
    name: 'Images to PDF',
    category: 'convert',
    icon: 'images',
    description: 'Turn JPG, PNG, WebP and other images into a PDF.',
    longDescription: 'Convert photos and scans (JPG, PNG, WebP, GIF, BMP) into a PDF — one image per page, in the order you choose.',
    keywords: ['jpg to pdf', 'png to pdf', 'photo', 'scan', 'picture', 'convert'],
    mount(root) {
      const entries = []; // {id, file, url}
      const listEl = h('ul', { class: 'file-list', 'aria-label': 'Images (drag to reorder)' });
      const countEl = h('span', { class: 'hint' });
      const result = h('div', { hidden: true, 'aria-live': 'polite' });
      const size = ui.select([['A4', 'A4'], ['Letter', 'US Letter'], ['Legal', 'US Legal'], ['A5', 'A5'], ['fit', 'Same as image']], 'A4');
      const orient = ui.segmented('orient', [['auto', 'Auto'], ['portrait', 'Portrait'], ['landscape', 'Landscape']], 'auto', 'Orientation');
      const margin = ui.segmented('margin', [['0', 'None'], ['18', 'Small'], ['40', 'Large']], '18', 'Margin');
      const nameInput = h('input', { type: 'text', value: 'images.pdf', spellcheck: false });
      const btn = h('button', { class: 'btn btn-lg', type: 'button', style: { width: '100%' }, disabled: true, onclick: build }, icon('download'), 'Create PDF');
      const orientField = ui.field('Orientation', orient.el);
      size.addEventListener('change', () => { orientField.hidden = size.value === 'fit'; });

      const zone = ui.dropzone({
        title: 'Add images', subtitle: 'JPG, PNG, WebP, GIF, BMP — select several at once', accept: 'image/*',
        multiple: true, filter: isImage, rejectHint: 'only images are supported here', icon: 'image', onFiles: add,
      });
      const layout = PS.kit.twoColumn();
      layout.workspace.append(zone, h('section', { class: 'panel' },
        h('div', { class: 'list-toolbar', style: { marginBottom: '12px' } }, h('h2', null, 'Images'), countEl,
          h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: clear }, icon('trash', 'icon-sm'), 'Clear')),
        listEl), result);
      layout.options.append(PS.kit.panel('Page setup',
        ui.field('Page size', size), orientField, ui.field('Margin', margin.el)),
        PS.kit.panel('Output', ui.field('File name', nameInput), h('div', { style: { marginTop: '16px' } }, btn)));
      root.replaceChildren(layout.el);
      PS.app.setDropHandler((files) => zone._accept(files));
      PS.sortable(listEl, {
        itemSelector: '.file-item', handleSelector: '.drag-handle', axis: 'y',
        onEnd(order) { entries.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)); render(); },
      });

      function add(files) {
        files.forEach((file) => entries.push({ id: uid('img'), file, url: URL.createObjectURL(file) }));
        render();
      }
      function removeAt(i) { URL.revokeObjectURL(entries[i].url); entries.splice(i, 1); render(); }
      function clear() { entries.forEach((e) => URL.revokeObjectURL(e.url)); entries.length = 0; render(); }
      function move(i, d) {
        const j = i + d; if (j < 0 || j >= entries.length) return;
        [entries[i], entries[j]] = [entries[j], entries[i]]; render();
        listEl.children[j]?.querySelector(d < 0 ? '[data-act="up"]' : '[data-act="down"]')?.focus();
      }

      const rows = new Map();
      function rowFor(e) {
        if (rows.has(e.id)) return rows.get(e.id);
        const row = h('li', { class: 'file-item', dataset: { id: e.id } },
          h('span', { class: 'drag-handle', 'aria-hidden': 'true', title: 'Drag to reorder' }, icon('grip')),
          h('div', { class: 'file-thumb' }, h('img', { src: e.url, alt: '', loading: 'lazy', decoding: 'async' })),
          h('div', { class: 'file-meta' }, h('div', { class: 'file-name', title: e.file.name }, e.file.name), h('div', { class: 'file-sub' }, formatBytes(e.file.size))),
          h('div', { class: 'file-actions' },
            h('button', { class: 'icon-btn sm', type: 'button', dataset: { act: 'up' }, 'aria-label': `Move ${e.file.name} up`, onclick: () => move(entries.indexOf(e), -1) }, icon('arrow-up')),
            h('button', { class: 'icon-btn sm', type: 'button', dataset: { act: 'down' }, 'aria-label': `Move ${e.file.name} down`, onclick: () => move(entries.indexOf(e), 1) }, icon('arrow-down')),
            h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': `Remove ${e.file.name}`, onclick: () => removeAt(entries.indexOf(e)) }, icon('x'))));
        rows.set(e.id, row);
        return row;
      }
      function render() {
        for (const id of rows.keys()) if (!entries.some((e) => e.id === id)) rows.delete(id);
        listEl.replaceChildren(...(entries.length ? entries.map(rowFor) : [ui.emptyState('No images yet.', 'image')]));
        entries.forEach((e, i) => { const r = rows.get(e.id); r.querySelector('[data-act="up"]').disabled = i === 0; r.querySelector('[data-act="down"]').disabled = i === entries.length - 1; });
        countEl.textContent = entries.length ? plural(entries.length, 'image') : '';
        btn.disabled = !entries.length;
        zone.classList.toggle('compact', entries.length > 0);
      }

      async function build() {
        const m = parseFloat(margin.value) || 0;
        const out = await ui.run('Creating PDF…', async (busy) => {
          const doc = await PS.engine.createPdfLib();
          const failed = [];
          for (let i = 0; i < entries.length; i++) {
            busy.progress(i, entries.length, entries[i].file.name);
            let img;
            try { img = await PS.engine.embedImageFile(doc, entries[i].file); }
            catch (err) { failed.push(entries[i].file.name); console.warn(err); continue; }
            let pw, ph;
            if (size.value === 'fit') { pw = img.width + 2 * m; ph = img.height + 2 * m; }
            else {
              [pw, ph] = SIZES[size.value];
              const landscape = orient.value === 'landscape' || (orient.value === 'auto' && img.width > img.height);
              if (landscape) [pw, ph] = [ph, pw];
            }
            const page = doc.addPage([pw, ph]);
            const s = Math.min((pw - 2 * m) / img.width, (ph - 2 * m) / img.height);
            const w = img.width * s, hh = img.height * s;
            page.drawImage(img, { x: (pw - w) / 2, y: (ph - hh) / 2, width: w, height: hh });
            await PS.util.tick();
          }
          if (!doc.getPageCount()) throw new Error('None of the images could be read.');
          if (failed.length) ui.toast(`Skipped ${plural(failed.length, 'image')} that couldn't be decoded: ${failed.join(', ')}`, 'warning');
          busy.progress(1, 1, 'Saving…');
          return { blob: await PS.engine.saveToBlob(doc), pages: doc.getPageCount() };
        }, 'images');
        if (!out) return;
        let name = nameInput.value.trim() || 'images.pdf';
        if (!/\.pdf$/i.test(name)) name += '.pdf';
        ui.showResult(result, { blob: out.blob, filename: name, detail: plural(out.pages, 'page') });
      }
      render();
      return { destroy: clear };
    },
  });
})(window);
