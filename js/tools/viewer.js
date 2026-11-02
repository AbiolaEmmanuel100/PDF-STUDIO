/**
 * Tool: View & search
 * A full document reader: continuous scroll, zoom/fit, thumbnails, selectable text,
 * full-text search with highlighted matches, and the document's bookmarks.
 */
(function (global) {
  'use strict';
  const PS = global.PS;
  const { h, icon } = PS.util;

  /** Flatten a pdf.js outline into [{title, level, dest, items}] and resolve page numbers lazily. */
  async function resolveOutline(doc, items, level = 0, out = []) {
    for (const it of items || []) {
      let page = null;
      try {
        let dest = it.dest;
        if (typeof dest === 'string') dest = await doc.getDestination(dest);
        if (Array.isArray(dest) && dest[0]) page = typeof dest[0] === 'number' ? dest[0] + 1 : (await doc.getPageIndex(dest[0])) + 1;
      } catch (_) { /* broken destination */ }
      out.push({ title: it.title || '(untitled)', level, page, url: it.url || null });
      await resolveOutline(doc, it.items, level + 1, out);
    }
    return out;
  }
  PS.resolveOutline = resolveOutline;

  PS.tools.register({
    id: 'viewer',
    name: 'View & search',
    category: 'inspect',
    icon: 'book-open',
    isNew: true,
    description: 'Read a PDF with zoom, thumbnails, selectable text and search.',
    longDescription: 'A fast, private PDF reader: continuous scrolling, fit-to-width or page, thumbnails, bookmarks, text selection and full-text search with highlighted matches.',
    keywords: ['read', 'open', 'reader', 'find', 'search', 'zoom', 'outline', 'bookmarks', 'select text', 'copy'],
    mount(root) {
      return PS.kit.pdfTool(root, {
        dropTitle: 'Choose a PDF to view',
        async onLoad(handle, view) {
          view.workspace.parentElement.classList.add('viewer-tool');
          const viewer = PS.viewer.create(handle, {});
          view.workspace.insertBefore(viewer.el, view.result);

          const outlineList = h('ul', { class: 'item-list' }, h('li', null, h('span', { class: 'muted' }, 'Loading…')));
          view.options.append(
            PS.kit.panel('Bookmarks', outlineList),
            PS.kit.panel('Shortcuts', h('ul', { class: 'kbd-list' },
              h('li', null, h('kbd', null, 'Ctrl'), ' + ', h('kbd', null, 'F'), ' Find in document'),
              h('li', null, h('kbd', null, 'Enter'), ' / ', h('kbd', null, 'Shift'), '+', h('kbd', null, 'Enter'), ' Next / previous match'),
              h('li', null, h('kbd', null, 'Ctrl'), ' + ', h('kbd', null, '+'), ' / ', h('kbd', null, '−'), ' Zoom · ', h('kbd', null, 'Ctrl'), '+', h('kbd', null, '0'), ' Fit width'),
              h('li', null, 'Select text with the mouse and copy it with ', h('kbd', null, 'Ctrl'), ' + ', h('kbd', null, 'C')))));

          const outline = await resolveOutline(handle.pdfjs, await handle.pdfjs.getOutline().catch(() => null));
          outlineList.replaceChildren(...(outline.length ? outline.map((o) => h('li', { style: { paddingLeft: 8 + o.level * 14 + 'px' } },
            h('button', { class: 'link grow', type: 'button', title: o.title, disabled: !o.page, onclick: () => viewer.goTo(o.page) }, o.title),
            o.page ? h('span', { class: 'muted' }, String(o.page)) : null)) : [h('li', null, h('span', { class: 'muted' }, 'This PDF has no bookmarks.'))]));

          const onKey = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); viewer.focusSearch(); }
          };
          document.addEventListener('keydown', onKey);
          return () => { document.removeEventListener('keydown', onKey); viewer.destroy(); };
        },
      });
    },
  });
})(window);
