/**
 * Tool: Bookmarks
 * View, add, rename, nest, reorder and delete a PDF's bookmarks (document outline), or
 * generate them automatically from the document's headings.
 */
(function (global) {
  'use strict';
  const PS = global.PS;
  const { h, icon, baseName, plural, clamp } = PS.util;
  const ui = PS.ui;

  /** Write [{title, page, level}] as the document outline (replacing any existing one). */
  function writeOutline(doc, items) {
    const L = global.PDFLib;
    const ctx = doc.context;
    const pages = doc.getPages();
    doc.catalog.delete(L.PDFName.of('Outlines'));
    if (!items.length) return;
    const root = { children: [] };
    const stack = [{ node: root, level: -1 }];
    for (const it of items) {
      const node = { it, children: [] };
      while (stack.length > 1 && stack[stack.length - 1].level >= it.level) stack.pop();
      stack[stack.length - 1].node.children.push(node);
      stack.push({ node, level: it.level });
    }
    const outlinesRef = ctx.nextRef();
    function build(parentRef, children) {
      const refs = children.map(() => ctx.nextRef());
      let count = 0;
      children.forEach((c, i) => {
        const page = pages[clamp(c.it.page, 1, pages.length) - 1];
        const d = { Title: L.PDFHexString.fromText(c.it.title || 'Untitled'), Parent: parentRef, Dest: ctx.obj([page.ref, L.PDFName.of('Fit')]) };
        if (i > 0) d.Prev = refs[i - 1];
        if (i < refs.length - 1) d.Next = refs[i + 1];
        if (c.children.length) {
          const sub = build(refs[i], c.children);
          d.First = sub.first; d.Last = sub.last; d.Count = sub.count; // positive: expanded
          count += sub.count;
        }
        ctx.assign(refs[i], ctx.obj(d));
        count++;
      });
      return { first: refs[0], last: refs[refs.length - 1], count };
    }
    const top = build(outlinesRef, root.children);
    ctx.assign(outlinesRef, ctx.obj({ Type: 'Outlines', First: top.first, Last: top.last, Count: top.count }));
    doc.catalog.set(L.PDFName.of('Outlines'), outlinesRef);
    doc.catalog.set(L.PDFName.of('PageMode'), L.PDFName.of('UseOutlines'));
  }
  PS.writeOutline = writeOutline;

  /** Suggest bookmarks from text that is noticeably larger than the body text. */
  async function detectHeadings(pdfjs, pageCount, busy) {
    const all = [];
    const hist = new Map();
    for (let n = 1; n <= pageCount; n++) {
      if (busy) busy.progress(n - 1, pageCount);
      const geo = await PS.textgeo.page(pdfjs, n);
      const ls = PS.textgeo.lines(geo);
      ls.forEach((l) => { const s = Math.round(l.size * 2) / 2; hist.set(s, (hist.get(s) || 0) + l.text.length); all.push({ n, l, s }); });
    }
    if (!all.length) return [];
    const body = [...hist.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const heads = all.filter((x) => x.s >= body * 1.2 && x.l.text.trim().length >= 2 && x.l.text.length <= 120 && /[A-Za-z0-9]/.test(x.l.text));
    const sizes = [...new Set(heads.map((x) => x.s))].sort((a, b) => b - a).slice(0, 3);
    return heads.filter((x) => sizes.includes(x.s)).slice(0, 500).map((x) => ({ title: x.l.text.trim(), page: x.n, level: sizes.indexOf(x.s) }));
  }

  PS.tools.register({
    id: 'bookmarks',
    name: 'Bookmarks',
    category: 'organize',
    icon: 'bookmark',
    isNew: true,
    description: 'Add, edit, nest and reorder bookmarks (outline).',
    longDescription: 'Edit the bookmarks panel of a PDF: add bookmarks for any page, rename, nest, reorder and delete them — or generate them automatically from the document’s headings.',
    keywords: ['outline', 'table of contents', 'toc', 'navigation', 'chapters', 'bookmark'],
    mount(root) {
      return PS.kit.pdfTool(root, {
        dropTitle: 'Choose a PDF',
        async onLoad(handle, view) {
          let items = (await PS.resolveOutline(handle.pdfjs, await handle.pdfjs.getOutline().catch(() => null))).map((o) => ({ title: o.title, page: o.page || 1, level: Math.min(o.level, 5) }));
          const original = items.length;
          let previewPage = 1, previewCanvas = null;
          const list = h('div', { class: 'bm-list', role: 'list' });
          const stage = h('div', { class: 'viewer-page' });
          const pLabel = h('span');
          const empty = h('p', { class: 'hint' }, 'No bookmarks yet. Add one for the page shown on the right, or detect headings automatically.');
          const save = view.actionButton('Save bookmarks', 'download', run);
          view.workspace.insertBefore(PS.kit.panel('Bookmarks', empty, list,
            h('div', { class: 'btn-row', style: { marginTop: '12px' } },
              h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => add(previewPage) }, icon('plus', 'icon-sm'), 'Add bookmark'),
              h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: auto }, icon('zap', 'icon-sm'), 'Detect headings'),
              h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => { items = []; draw(); } }, icon('trash', 'icon-sm'), 'Remove all'))), view.result);
          view.options.append(
            h('section', { class: 'panel' }, h('div', { class: 'list-toolbar', style: { marginBottom: '10px' } }, h('h2', null, 'Page'), h('div', { class: 'pager' },
              h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Previous page', onclick: () => preview(previewPage - 1) }, icon('chevron-left')), pLabel,
              h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Next page', onclick: () => preview(previewPage + 1) }, icon('chevron-right')))),
            h('div', { class: 'viewer', style: { minHeight: '200px', padding: '10px' } }, stage)),
            PS.kit.panel('Save', h('p', { class: 'hint' }, original ? `The file had ${plural(original, 'bookmark')}.` : 'The file had no bookmarks.'), h('div', { style: { marginTop: '10px' } }, save)));

          async function preview(n) {
            previewPage = clamp(n, 1, handle.pageCount);
            pLabel.textContent = `${previewPage} / ${handle.pageCount}`;
            const c = await PS.engine.renderPage(handle.pdfjs, previewPage, { width: 250, hidpi: true });
            if (previewCanvas) PS.engine.releaseCanvas(previewCanvas);
            previewCanvas = c;
            stage.replaceChildren(c);
          }
          function add(page, title) {
            items.push({ title: title || `Page ${page}`, page, level: 0 });
            draw();
            const inputs = list.querySelectorAll('input[type="text"]');
            const last = inputs[inputs.length - 1];
            if (last) { last.focus(); last.select(); }
          }
          function draw() {
            empty.hidden = items.length > 0;
            save.disabled = !items.length && !original;
            list.replaceChildren(...items.map((it, i) => {
              const title = h('input', { type: 'text', value: it.title, 'aria-label': `Bookmark ${i + 1} title` });
              title.addEventListener('input', () => { it.title = title.value; });
              const page = h('input', { type: 'number', min: 1, max: handle.pageCount, value: it.page, 'aria-label': `Bookmark ${i + 1} page` });
              page.addEventListener('change', () => { it.page = clamp(parseInt(page.value, 10) || 1, 1, handle.pageCount); page.value = it.page; preview(it.page); });
              title.addEventListener('focus', () => preview(it.page));
              const btn = (ic, label, fn, dis) => h('button', { class: 'icon-btn', type: 'button', 'aria-label': label, title: label, disabled: dis, onclick: fn }, icon(ic, 'icon-sm'));
              return h('div', { class: 'bm-row', role: 'listitem', style: { paddingLeft: it.level * 22 + 'px' } },
                h('div', { class: 'btn-row', style: { gap: '0' } },
                  btn('chevron-left', 'Outdent', () => { it.level = Math.max(0, it.level - 1); draw(); }, it.level === 0),
                  btn('chevron-right', 'Indent', () => { it.level = Math.min(5, it.level + 1, i > 0 ? items[i - 1].level + 1 : 0); draw(); }, i === 0 || it.level > items[i - 1].level)),
                title, page,
                h('div', { class: 'btn-row', style: { gap: '0' } },
                  btn('arrow-up', 'Move up', () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; draw(); }, i === 0),
                  btn('arrow-down', 'Move down', () => { [items[i + 1], items[i]] = [items[i], items[i + 1]]; draw(); }, i === items.length - 1),
                  btn('x', 'Delete bookmark', () => { items.splice(i, 1); draw(); })));
            }));
          }
          async function auto() {
            const found = await ui.run('Detecting headings…', (busy) => detectHeadings(handle.pdfjs, handle.pageCount, busy), 'bookmarks');
            if (!found) return;
            if (!found.length) { ui.toast('No headings found (the document may be a scan or use one text size).', 'info'); return; }
            items = found;
            draw();
            ui.toast(`Found ${plural(found.length, 'heading')}. Review and edit them before saving.`, 'success');
          }
          async function run() {
            const clean = items.map((it) => ({ title: it.title.trim() || 'Untitled', page: it.page, level: it.level }));
            // fix levels so each item is at most one deeper than the previous
            clean.forEach((it, i) => { it.level = i === 0 ? 0 : Math.min(it.level, clean[i - 1].level + 1); });
            const blob = await ui.run('Saving bookmarks…', async () => {
              const doc = await PS.engine.loadPdfLib(handle.bytes);
              writeOutline(doc, clean);
              return PS.engine.saveToBlob(doc);
            }, 'bookmarks');
            if (blob) ui.showResult(view.result, { blob, filename: `${baseName(handle.name)}_bookmarked.pdf`, detail: clean.length ? plural(clean.length, 'bookmark') : 'Bookmarks removed' });
          }
          draw();
          requestAnimationFrame(() => preview(1).catch((err) => ui.reportError(err, 'bookmarks')));
          return () => { if (previewCanvas) PS.engine.releaseCanvas(previewCanvas); };
        },
      });
    },
  });
})(window);
