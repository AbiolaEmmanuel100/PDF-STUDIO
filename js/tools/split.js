/**
 * Tool: Split / extract pages
 * Pick pages by clicking thumbnails or typing ranges, then either extract them into one PDF
 * or split the document into several files (downloaded together as a .zip).
 */
(function (global) {
  'use strict';
  const PS = global.PS;
  const { h, icon, plural, parseRanges, formatRanges, baseName, debounce } = PS.util;
  const ui = PS.ui;

  /** Shared by Split and Rotate: thumbnail grid + range field that stay in sync. */
  function pageSelector(handle, { label, onSelection }) {
    const sources = new Map([[handle.id, handle]]);
    const items = PS.pageGrid.itemsFor(handle);
    const rangeInput = h('input', { type: 'text', placeholder: 'e.g. 1-3, 5, 8-', spellcheck: false, autocomplete: 'off' });
    const rangeHint = h('div', { class: 'hint', 'aria-live': 'polite' });
    let syncing = false;
    const grid = PS.pageGrid({
      sources, items, selectable: true, label: label || 'Pages — click to select',
      onSelect(ids) {
        if (!syncing) {
          const idx = ids.map((id) => items.findIndex((it) => it.id === id));
          rangeInput.value = formatRanges(idx);
          rangeHint.textContent = ids.length ? plural(ids.length, 'page') + ' selected' : 'No pages selected';
        }
        onSelection?.(ids.length);
      },
    });
    rangeInput.addEventListener('input', debounce(() => {
      if (!rangeInput.value.trim()) { syncing = true; grid.clearSelection(); syncing = false; rangeHint.textContent = 'No pages selected'; return; }
      try {
        const idx = parseRanges(rangeInput.value, handle.pageCount, { allowEmpty: false });
        syncing = true; grid.setSelected(idx.map((i) => items[i].id)); syncing = false;
        rangeHint.textContent = plural(idx.length, 'page') + ' selected';
      } catch (err) { rangeHint.textContent = err.message; }
    }, 250));
    const toolbar = h('div', { class: 'grid-toolbar', role: 'toolbar', 'aria-label': 'Selection' },
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => grid.selectAll() }, icon('select', 'icon-sm'), 'Select all'),
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => grid.invertSelection() }, 'Invert'),
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => grid.clearSelection() }, 'Clear'),
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => grid.setSelected(items.filter((_, i) => i % 2 === 0).map((it) => it.id)) }, 'Odd'),
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => grid.setSelected(items.filter((_, i) => i % 2 === 1).map((it) => it.id)) }, 'Even'));
    return {
      grid, toolbar, rangeInput, rangeHint,
      /** 0-based selected indices (sorted). */
      indices() { return grid.selected().map((id) => items.findIndex((it) => it.id === id)).sort((a, b) => a - b); },
    };
  }
  PS.kit.pageSelector = pageSelector;

  PS.tools.register({
    id: 'split',
    name: 'Split & extract',
    category: 'organize',
    icon: 'scissors',
    description: 'Extract selected pages or split a PDF into several files.',
    longDescription: 'Select pages by clicking thumbnails or typing ranges. Extract them into a new PDF, or split the document into separate files.',
    keywords: ['extract', 'separate', 'pages', 'cut', 'divide'],
    mount(root) {
      return PS.kit.pdfTool(root, {
        dropTitle: 'Choose a PDF to split',
        onLoad(handle, view) {
          const sel = pageSelector(handle, { onSelection: updateBtn });
          const mode = ui.segmented('mode', [['extract', 'Extract'], ['each', 'Each page'], ['every', 'Every N'], ['ranges', 'By ranges']], 'extract', 'Split mode');
          const everyN = h('input', { type: 'number', min: 1, max: handle.pageCount, value: Math.min(2, handle.pageCount) });
          const everyField = ui.field('Pages per file', everyN);
          const modeHelp = h('p', { class: 'hint', style: { marginTop: '8px' } });
          const rangeField = ui.field('Pages', sel.rangeInput);
          rangeField.appendChild(sel.rangeHint);
          const btn = view.actionButton('Split PDF', 'scissors', run);
          const help = {
            extract: 'Selected pages are combined into one new PDF.',
            each: 'Every selected page becomes its own PDF (all pages if none are selected). Multiple files download as a .zip.',
            every: 'The whole document is cut into chunks of N pages.',
            ranges: 'Each comma-separated range becomes its own PDF — e.g. “1-3, 4-6, 7-” makes 3 files.',
          };
          function updateMode() {
            modeHelp.textContent = help[mode.value];
            everyField.hidden = mode.value !== 'every';
            rangeField.hidden = mode.value === 'every';
            updateBtn();
          }
          function updateBtn() {
            const n = sel.indices().length;
            btn.disabled = mode.value === 'extract' && !n;
            btn.lastChild.textContent = mode.value === 'extract' ? (n ? `Extract ${plural(n, 'page')}` : 'Select pages to extract') : 'Split PDF';
          }
          mode.onChange(updateMode);
          view.workspace.insertBefore(sel.toolbar, view.result);
          view.workspace.insertBefore(sel.grid.el, view.result);
          view.options.append(
            PS.kit.panel('Mode', mode.el, modeHelp),
            PS.kit.panel('Pages', rangeField, everyField, h('div', { style: { marginTop: '16px' } }, btn)));
          updateMode();

          async function run() {
            const total = handle.pageCount;
            let groups;
            try {
              if (mode.value === 'extract') groups = [sel.indices()];
              else if (mode.value === 'each') groups = (sel.indices().length ? sel.indices() : [...Array(total).keys()]).map((i) => [i]);
              else if (mode.value === 'every') {
                const n = Math.max(1, parseInt(everyN.value, 10) || 1);
                groups = [];
                for (let i = 0; i < total; i += n) groups.push([...Array(Math.min(n, total - i)).keys()].map((k) => i + k));
              } else {
                const text = sel.rangeInput.value.trim();
                if (!text) throw new Error('Type ranges like “1-3, 4-6” — each range becomes a file.');
                groups = text.split(',').filter((s) => s.trim()).map((part) => parseRanges(part, total, { allowEmpty: false, keepOrder: true }));
              }
            } catch (err) { ui.toast(err.message, 'error'); return; }
            if (!groups.length || !groups[0].length) { ui.toast('No pages selected.', 'error'); return; }
            const base = baseName(handle.name);
            const out = await ui.run('Splitting…', async (busy) => {
              const src = await PS.engine.loadPdfLib(handle.bytes);
              const files = [];
              for (let g = 0; g < groups.length; g++) {
                busy.progress(g, groups.length, `File ${g + 1} of ${groups.length}`);
                const doc = await PS.engine.createPdfLib();
                const pages = await doc.copyPages(src, groups[g]);
                pages.forEach((p) => doc.addPage(p));
                const bytes = await doc.save({ useObjectStreams: true });
                const label = formatRanges(groups[g]).replace(/, /g, '_').replace(/\s/g, '');
                files.push({ name: `${base}_${groups.length === 1 && mode.value === 'extract' ? 'pages_' : 'p'}${label}.pdf`, data: bytes, pages: groups[g].length });
                await PS.util.tick();
              }
              if (files.length === 1) return { blob: new Blob([files[0].data], { type: 'application/pdf' }), name: files[0].name, detail: plural(files[0].pages, 'page') };
              busy.message('Creating .zip…');
              return { blob: PS.util.zip(files), name: `${base}_split.zip`, detail: plural(files.length, 'PDF file') };
            }, 'split');
            if (out) ui.showResult(view.result, { blob: out.blob, filename: out.name, detail: out.detail });
          }
          return () => sel.grid.destroy();
        },
      });
    },
  });
})(window);
