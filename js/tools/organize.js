/**
 * Tool: Organize pages
 * Visual page editor: drag thumbnails to reorder; rotate, duplicate, delete pages; insert
 * blank pages; add pages from other PDFs. Full undo/redo. Exports a new PDF.
 */
(function (global) {
  'use strict';
  const PS = global.PS;
  const { h, icon, plural, isPdf, uid, baseName } = PS.util;
  const ui = PS.ui;

  PS.tools.register({
    id: 'organize',
    name: 'Organize pages',
    category: 'organize',
    icon: 'layout',
    description: 'Reorder, rotate, duplicate, delete and insert pages visually.',
    longDescription: 'Drag pages to reorder them, rotate or delete individual pages, duplicate or insert blank pages, and pull in pages from other PDFs.',
    keywords: ['reorder', 'sort', 'delete pages', 'remove pages', 'insert', 'arrange', 'rearrange'],
    mount(root) {
      const sources = new Map();
      let grid = null;
      let firstName = 'document';
      const undoStack = [], redoStack = [];
      let lastItems = null;
      let selectionCount = 0;

      const zone = ui.dropzone({
        title: 'Choose PDF files', subtitle: 'Select one or more — all their pages appear as thumbnails',
        accept: '.pdf,application/pdf', multiple: true, filter: isPdf, rejectHint: 'only PDFs are supported', onFiles: addFiles,
      });
      const adder = ui.dropzone({ accept: '.pdf,application/pdf', multiple: true, filter: isPdf, onFiles: addFiles });
      root.replaceChildren(h('div', { class: 'tool-body single' }, zone));
      PS.app.setDropHandler((files) => (grid ? adder : zone)._accept(files));

      const countEl = h('span', { class: 'count', 'aria-live': 'polite' });
      const nameInput = h('input', { type: 'text', spellcheck: false });
      const tb = {};
      function tbtn(key, iconName, label, fn, needsSel) {
        const b = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', title: label, 'aria-label': label, onclick: fn }, icon(iconName, 'icon-sm'), h('span', { class: 'tb-label' }, label));
        b.dataset.needsSel = needsSel ? '1' : '';
        tb[key] = b;
        return b;
      }
      const toolbar = h('div', { class: 'grid-toolbar', role: 'toolbar', 'aria-label': 'Page actions' },
        tbtn('all', 'select', 'Select all', () => grid.selectAll()),
        tbtn('none', 'square', 'Clear', () => grid.clearSelection(), true),
        h('span', { class: 'sep' }),
        tbtn('rl', 'rotate-ccw', 'Left', () => grid.rotate(grid.selected(), -90), true),
        tbtn('rr', 'rotate-cw', 'Right', () => grid.rotate(grid.selected(), 90), true),
        tbtn('dup', 'copy', 'Duplicate', () => grid.duplicate(grid.selected()), true),
        tbtn('del', 'trash', 'Delete', () => grid.remove(grid.selected()), true),
        h('span', { class: 'sep' }),
        tbtn('blank', 'file-plus', 'Blank page', insertBlank),
        tbtn('add', 'plus', 'Add PDF', () => adder.open()),
        h('span', { class: 'sep' }),
        tbtn('undo', 'undo', 'Undo', undo),
        tbtn('redo', 'redo', 'Redo', redo),
        countEl);

      const result = h('div', { hidden: true, 'aria-live': 'polite' });
      const exportBtn = h('button', { class: 'btn btn-lg', type: 'button', style: { width: '100%' }, onclick: exportPdf }, icon('download'), 'Export PDF');

      async function addFiles(files) {
        const handles = [];
        await ui.run('Opening…', async (busy) => {
          for (let i = 0; i < files.length; i++) {
            busy.progress(i, files.length, files[i].name);
            try { handles.push(await PS.engine.openFile(files[i])); }
            catch (err) { ui.toast(`${files[i].name}: ${PS.util.errorMessage(err)}`, 'error'); }
          }
        });
        if (!handles.length) return;
        handles.forEach((hd) => sources.set(hd.id, hd));
        const newItems = handles.flatMap((hd) => PS.pageGrid.itemsFor(hd));
        if (!grid) {
          firstName = baseName(handles[0].name);
          nameInput.value = firstName + '-organized.pdf';
          buildEditor(newItems);
        } else {
          grid.addItems(newItems);
          ui.toast(`Added ${plural(newItems.length, 'page')}.`, 'success');
        }

      }

      function buildEditor(items) {
        grid = PS.pageGrid({
          sources, items, sortable: true, actions: ['rotate', 'duplicate', 'delete'], showSource: true,
          label: 'Pages — drag to reorder, Space to select, Alt+Arrow to move, R to rotate, Delete to remove',
          onChange(next, kind) {
            if (lastItems && kind !== 'set') { undoStack.push(lastItems); redoStack.length = 0; if (undoStack.length > 100) undoStack.shift(); }
            lastItems = snapshot(next);
            refresh();
          },
          onSelect(sel) { selectionCount = sel.length; refresh(); },
        });
        lastItems = snapshot(grid.items);
        const layout = PS.kit.twoColumn();
        layout.workspace.append(toolbar, grid.el, result);
        layout.options.append(
          PS.kit.panel('Export', ui.field('File name', nameInput), h('div', { style: { marginTop: '16px' } }, exportBtn)),
          PS.kit.panel('Shortcuts', h('ul', { class: 'hint', style: { margin: 0, paddingLeft: '18px' } },
            h('li', null, 'Click or Space — select a page'), h('li', null, 'Shift+click — select a range'),
            h('li', null, 'Drag (long-press on touch) or Alt+← → — move'), h('li', null, 'R / Shift+R — rotate'),
            h('li', null, 'Delete — remove'), h('li', null, 'Ctrl+Z / Ctrl+Y — undo / redo'))));
        root.replaceChildren(layout.el);
        refresh();
      }

      function snapshot(items) { return items.map((it) => Object.assign({}, it)); }

      function undo() {
        if (!undoStack.length) return;
        redoStack.push(snapshot(grid.items));
        const prev = undoStack.pop();
        lastItems = snapshot(prev);
        grid.setItems(prev);
      }
      function redo() {
        if (!redoStack.length) return;
        undoStack.push(snapshot(grid.items));
        const next = redoStack.pop();
        lastItems = snapshot(next);
        grid.setItems(next);
      }

      async function insertBlank() {
        const items = grid.items;
        const sel = grid.selected();
        const afterIdx = sel.length ? items.findIndex((it) => it.id === sel[sel.length - 1]) : items.length - 1;
        const ref = items[afterIdx] || items[0];
        let size = { width: 595.28, height: 841.89 }; // A4 fallback
        try {
          if (ref && ref.blank) size = ref.blank;
          else if (ref) size = await pageSize(sources.get(ref.srcId), ref.index); // match the neighbouring page
        } catch (_) { /* keep A4 */ }
        items.splice(afterIdx + 1, 0, { id: uid('pg'), blank: size, rotation: 0, srcId: null, index: 0 });
        const prev = lastItems;
        grid.setItems(items); // 'set' changes aren't recorded automatically
        undoStack.push(prev); redoStack.length = 0;
        refresh();
      }

      function refresh() {
        const total = grid ? grid.items.length : 0;
        countEl.textContent = `${plural(total, 'page')}${selectionCount ? ` · ${selectionCount} selected` : ''}`;
        for (const b of Object.values(tb)) if (b.dataset.needsSel) b.disabled = !selectionCount;
        tb.undo.disabled = !undoStack.length;
        tb.redo.disabled = !redoStack.length;
        exportBtn.disabled = !total;
      }

      const onKey = (e) => {
        if (!grid || /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
        const mod = e.ctrlKey || e.metaKey;
        if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
        else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
      };
      document.addEventListener('keydown', onKey);

      // Page size (unrotated, in points) of a source page — used to size inserted blank pages
      async function pageSize(src, index) {
        src._sizes = src._sizes || {};
        if (!src._sizes[index]) {
          const p = await src.pdfjs.getPage(index + 1);
          const vp = p.getViewport({ scale: 1, rotation: 0 });
          src._sizes[index] = { width: vp.width, height: vp.height };
        }
        return src._sizes[index];
      }

      async function exportPdf() {
        const items = grid.items;
        const out = await ui.run('Building PDF…', async (busy) => {
          const doc = await PS.engine.createPdfLib();
          const loaded = new Map();
          for (let i = 0; i < items.length; i++) {
            const it = items[i];
            if (i % 10 === 0) { busy.progress(i, items.length, `Page ${i + 1} of ${items.length}`); await PS.util.tick(); }
            if (it.blank) {
              const p = doc.addPage([it.blank.width, it.blank.height]);
              if (it.rotation) p.setRotation(global.PDFLib.degrees(it.rotation));
              continue;
            }
            if (!loaded.has(it.srcId)) loaded.set(it.srcId, await PS.engine.loadPdfLib(sources.get(it.srcId).bytes));
            const [page] = await doc.copyPages(loaded.get(it.srcId), [it.index]);
            const base = page.getRotation().angle;
            page.setRotation(global.PDFLib.degrees(PS.engine.normRotation(base + it.rotation)));
            doc.addPage(page);
          }
          busy.progress(items.length, items.length, 'Saving…');
          return PS.engine.saveToBlob(doc);
        }, 'organize');
        if (!out) return;
        let name = nameInput.value.trim() || firstName + '-organized.pdf';
        if (!/\.pdf$/i.test(name)) name += '.pdf';
        ui.showResult(result, { blob: out, filename: name, detail: plural(items.length, 'page') });
      }

      return {
        destroy() {
          document.removeEventListener('keydown', onKey);
          grid?.destroy();
          for (const s of sources.values()) s.destroy();
          sources.clear();
        },
      };
    },
  });
})(window);
