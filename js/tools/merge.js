/**
 * Tool: Merge PDFs
 * Combine several PDFs (optionally only some pages of each) into one document.
 * Files can be reordered by drag-and-drop, with the arrow buttons, or with Alt+↑/↓.
 */
(function (global) {
  'use strict';
  const PS = global.PS;
  const { h, icon, formatBytes, plural, isPdf, parseRanges, uid } = PS.util;
  const ui = PS.ui;

  PS.tools.register({
    id: 'merge',
    name: 'Merge PDFs',
    category: 'organize',
    icon: 'merge',
    description: 'Combine multiple PDFs into one, in any order.',
    longDescription: 'Combine multiple PDFs into a single document. Drag to reorder files and optionally pick which pages to take from each.',
    keywords: ['combine', 'join', 'append'],
    mount(root) {
      const entries = []; // { id, handle, rangeInput }
      const listEl = h('ul', { class: 'file-list', 'aria-label': 'Files to merge (drag to reorder)' });
      const countEl = h('span', { class: 'hint' });
      const nameInput = h('input', { type: 'text', value: 'merged.pdf', spellcheck: false });
      const mergeBtn = h('button', { class: 'btn btn-lg', type: 'button', style: { width: '100%' }, disabled: true, onclick: merge }, icon('merge'), 'Merge PDFs');
      const result = h('div', { hidden: true, 'aria-live': 'polite' });

      const zone = ui.dropzone({
        title: 'Add PDF files', subtitle: 'Choose several at once, or drag them here', accept: '.pdf,application/pdf',
        multiple: true, filter: isPdf, rejectHint: 'only PDFs can be merged', onFiles: addFiles,
      });
      const listPanel = h('section', { class: 'panel' },
        h('div', { class: 'list-toolbar', style: { marginBottom: '12px' } },
          h('h2', null, 'Files'), countEl,
          h('div', { class: 'btn-row' },
            h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: sortByName }, 'Sort A→Z'),
            h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: clearAll }, icon('trash', 'icon-sm'), 'Clear'))),
        listEl);

      const layout = PS.kit.twoColumn();
      layout.workspace.append(zone, listPanel, result);
      layout.options.append(
        PS.kit.panel('Output', ui.field('File name', nameInput),
          h('div', { style: { marginTop: '16px' } }, mergeBtn)),
        ui.note('Tip: type page ranges like “1-3, 7” next to a file to merge only those pages.'));
      root.replaceChildren(layout.el);
      PS.app.setDropHandler((files) => zone._accept(files));

      PS.sortable(listEl, {
        itemSelector: '.file-item', handleSelector: '.drag-handle', axis: 'y',
        onEnd(order) { entries.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)); render(); },
      });

      async function addFiles(files) {
        await ui.run('Reading files…', async (busy) => {
          let done = 0;
          for (const file of files) {
            busy.progress(done, files.length, file.name);
            try {
              const handle = await PS.engine.openFile(file);
              entries.push({ id: uid('m'), handle, range: '' });
            } catch (err) {
              ui.toast(`${file.name}: ${PS.util.errorMessage(err)}`, 'error');
            }
            done++;
          }
        });
        render();
      }

      function move(i, d) {
        const j = i + d;
        if (j < 0 || j >= entries.length) return;
        [entries[i], entries[j]] = [entries[j], entries[i]];
        render();
        listEl.children[j]?.querySelector(d < 0 ? '[data-act="up"]' : '[data-act="down"]')?.focus();
      }

      function removeAt(i) {
        entries[i].handle.destroy();
        entries.splice(i, 1);
        render();
      }

      function sortByName() {
        entries.sort((a, b) => a.handle.name.localeCompare(b.handle.name, undefined, { numeric: true }));
        render();
      }

      function clearAll() {
        entries.forEach((e) => e.handle.destroy());
        entries.length = 0;
        render();
      }

      // Rendered rows are cached per entry so thumbnails survive reordering.
      const rows = new Map();
      function rowFor(entry) {
        if (rows.has(entry.id)) return rows.get(entry.id);
        const thumb = h('div', { class: 'file-thumb' }, h('div', { class: 'spinner' }));
        PS.engine.renderPage(entry.handle.pdfjs, 1, { width: 46, hidpi: true })
          .then((c) => thumb.replaceChildren(c)).catch(() => thumb.replaceChildren(icon('file')));
        const range = h('input', {
          type: 'text', class: 'range-input', placeholder: 'All pages', value: entry.range, 'aria-label': `Pages to include from ${entry.handle.name}`,
          oninput: () => { entry.range = range.value; },
        });
        const row = h('li', { class: 'file-item', dataset: { id: entry.id }, tabindex: '-1' },
          h('span', { class: 'drag-handle', title: 'Drag to reorder', 'aria-hidden': 'true' }, icon('grip')),
          thumb,
          h('div', { class: 'file-meta' },
            h('div', { class: 'file-name', title: entry.handle.name }, entry.handle.name),
            h('div', { class: 'file-sub' }, `${plural(entry.handle.pageCount, 'page')} · ${formatBytes(entry.handle.size)}`)),
          range,
          h('div', { class: 'file-actions' },
            h('button', { class: 'icon-btn sm', type: 'button', dataset: { act: 'up' }, 'aria-label': `Move ${entry.handle.name} up`, onclick: () => move(entries.indexOf(entry), -1) }, icon('arrow-up')),
            h('button', { class: 'icon-btn sm', type: 'button', dataset: { act: 'down' }, 'aria-label': `Move ${entry.handle.name} down`, onclick: () => move(entries.indexOf(entry), 1) }, icon('arrow-down')),
            h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': `Remove ${entry.handle.name}`, onclick: () => removeAt(entries.indexOf(entry)) }, icon('x'))));
        row.addEventListener('keydown', (e) => {
          if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); move(entries.indexOf(entry), e.key === 'ArrowUp' ? -1 : 1); }
        });
        rows.set(entry.id, row);
        return row;
      }

      function render() {
        for (const id of rows.keys()) if (!entries.some((e) => e.id === id)) rows.delete(id);
        if (!entries.length) listEl.replaceChildren(ui.emptyState('No files yet. Add two or more PDFs to merge them.', 'merge'));
        else listEl.replaceChildren(...entries.map(rowFor));
        entries.forEach((e, i) => {
          const r = rows.get(e.id);
          r.querySelector('[data-act="up"]').disabled = i === 0;
          r.querySelector('[data-act="down"]').disabled = i === entries.length - 1;
        });
        const pages = entries.reduce((n, e) => n + e.handle.pageCount, 0);
        countEl.textContent = entries.length ? `${plural(entries.length, 'file')} · ${plural(pages, 'page')}` : '';
        mergeBtn.disabled = entries.length < 1;
        zone.classList.toggle('compact', entries.length > 0);
      }

      async function merge() {
        // validate ranges first so the user gets a precise message
        const plan = [];
        for (const e of entries) {
          try { plan.push({ e, indices: parseRanges(e.range, e.handle.pageCount) }); }
          catch (err) { ui.toast(`${e.handle.name}: ${err.message}`, 'error'); rows.get(e.id)?.querySelector('input')?.focus(); return; }
        }
        const out = await ui.run('Merging…', async (busy) => {
          const doc = await PS.engine.createPdfLib();
          for (let i = 0; i < plan.length; i++) {
            busy.progress(i, plan.length, `Adding ${plan[i].e.handle.name}`);
            const src = await PS.engine.loadPdfLib(plan[i].e.handle.bytes);
            const pages = await doc.copyPages(src, plan[i].indices);
            pages.forEach((p) => doc.addPage(p));
            await PS.util.tick();
          }
          busy.progress(plan.length, plan.length, 'Saving…');
          return { blob: await PS.engine.saveToBlob(doc), pages: doc.getPageCount() };
        }, 'merge');
        if (!out) return;
        let name = nameInput.value.trim() || 'merged.pdf';
        if (!/\.pdf$/i.test(name)) name += '.pdf';
        ui.showResult(result, { blob: out.blob, filename: name, detail: plural(out.pages, 'page') });
      }

      render();
      return { destroy: clearAll };
    },
  });
})(window);
