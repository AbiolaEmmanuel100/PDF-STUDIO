/**
 * Tool: Compare PDFs
 * Finds text differences between two versions of a document. Each page pair is compared
 * word by word (longest-common-subsequence diff); removed words are marked red on the old
 * version and added words green on the new one, with a list of every change. The new version
 * can be downloaded with the changes marked as PDF comments.
 */
(function (global) {
  'use strict';
  const PS = global.PS;
  const { h, icon, baseName, plural, isPdf } = PS.util;
  const ui = PS.ui;
  const TG = () => PS.textgeo;
  const MAX_CELLS = 4e6;

  const norm = (w) => w.replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014]/g, '-');

  /** LCS diff of two string arrays -> ops [{t:'eq'|'del'|'ins', a, b}] (indices). */
  function diffWords(A, B) {
    let s = 0;
    while (s < A.length && s < B.length && A[s] === B[s]) s++;
    let ea = A.length, eb = B.length;
    while (ea > s && eb > s && A[ea - 1] === B[eb - 1]) { ea--; eb--; }
    const ops = [];
    for (let i = 0; i < s; i++) ops.push({ t: 'eq', a: i, b: i });
    const n = ea - s, m = eb - s;
    if (n * m > MAX_CELLS) {
      // too many differences for a full table: mark the middle block as replaced
      for (let i = s; i < ea; i++) ops.push({ t: 'del', a: i });
      for (let j = s; j < eb; j++) ops.push({ t: 'ins', b: j });
    } else if (n || m) {
      const W = m + 1;
      const T = new Int32Array((n + 1) * W);
      for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
        T[i * W + j] = A[s + i] === B[s + j] ? T[(i + 1) * W + j + 1] + 1 : Math.max(T[(i + 1) * W + j], T[i * W + j + 1]);
      }
      let i = 0, j = 0;
      while (i < n || j < m) {
        if (i < n && j < m && A[s + i] === B[s + j]) { ops.push({ t: 'eq', a: s + i, b: s + j }); i++; j++; }
        else if (j < m && (i >= n || T[i * W + j + 1] >= T[(i + 1) * W + j])) { ops.push({ t: 'ins', b: s + j }); j++; }
        else { ops.push({ t: 'del', a: s + i }); i++; }
      }
    }
    for (let k = 0; k < A.length - ea; k++) ops.push({ t: 'eq', a: ea + k, b: eb + k });
    return ops;
  }

  /** Group consecutive non-equal ops into hunks [{del:[aIdx], ins:[bIdx], anchorB}] (anchorB = next equal word in B). */
  function hunks(ops) {
    const out = [];
    let cur = null;
    for (const op of ops) {
      if (op.t === 'eq') { if (cur) { cur.anchorB = op.b; cur = null; } continue; }
      if (!cur) { cur = { del: [], ins: [], anchorB: null }; out.push(cur); }
      if (op.t === 'del') cur.del.push(op.a); else cur.ins.push(op.b);
    }
    return out;
  }
  PS.diffWords = diffWords;

  PS.tools.register({
    id: 'compare',
    name: 'Compare PDFs',
    category: 'review',
    icon: 'compare',
    isNew: true,
    description: 'See exactly what changed between two versions of a PDF.',
    longDescription: 'Compare two versions of a document side by side: removed text is marked in red, added text in green, and every change is listed. Download the new version with the changes marked as comments.',
    keywords: ['diff', 'difference', 'versions', 'changes', 'redline', 'track changes', 'contract review'],
    mount(root) {
      const docs = { a: null, b: null };
      let result = null; // {pages:[{ops, geoA, geoB, hunks}]}
      let pageNo = 1;
      const canvases = [];

      function slot(key, title) {
        const zone = ui.dropzone({ title, subtitle: 'PDF file', accept: '.pdf,application/pdf', filter: isPdf, compact: true, onFiles: ([f]) => load(key, f) });
        return zone;
      }
      function showStart() {
        const za = slot('a', 'Original (old) version'), zb = slot('b', 'Revised (new) version');
        const status = h('p', { class: 'hint', 'aria-live': 'polite' });
        const btn = h('button', { class: 'btn btn-lg', type: 'button', disabled: true, onclick: compare }, icon('compare'), 'Compare');
        const nameA = h('div', { class: 'file-sub' }), nameB = h('div', { class: 'file-sub' });
        root.replaceChildren(h('div', { class: 'tool-body single' },
          h('div', { class: 'compare-grid' }, h('div', null, za, nameA), h('div', null, zb, nameB)),
          h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center', marginTop: '16px' } }, btn, status)));
        PS.app.setDropHandler((files) => { const pdfs = files.filter(isPdf); if (pdfs[0] && !docs.a) load('a', pdfs[0]); else if (pdfs[0]) load('b', pdfs[0]); if (pdfs[1]) load('b', pdfs[1]); });
        showStart.refresh = () => {
          nameA.textContent = docs.a ? `✓ ${docs.a.name} · ${plural(docs.a.pageCount, 'page')}` : '';
          nameB.textContent = docs.b ? `✓ ${docs.b.name} · ${plural(docs.b.pageCount, 'page')}` : '';
          btn.disabled = !(docs.a && docs.b);
          status.textContent = docs.a && docs.b ? '' : 'Add both versions to compare.';
        };
        showStart.refresh();
      }
      async function load(key, file) {
        const hd = await PS.kit.openPdf(file);
        if (!hd) return;
        if (docs[key]) docs[key].destroy();
        docs[key] = hd;
        if (showStart.refresh) showStart.refresh();
      }

      async function compare() {
        const A = docs.a, B = docs.b;
        const res = await ui.run('Comparing…', async (busy) => {
          const N = Math.max(A.pageCount, B.pageCount);
          const pages = [];
          let ins = 0, del = 0, changedPages = 0, textless = 0;
          for (let n = 1; n <= N; n++) {
            busy.progress(n - 1, N, `Page ${n} of ${N}`);
            const geoA = n <= A.pageCount ? await TG().page(A.pdfjs, n) : { words: [], runs: [], text: '' };
            const geoB = n <= B.pageCount ? await TG().page(B.pdfjs, n) : { words: [], runs: [], text: '' };
            if (!geoA.runs.length && !geoB.runs.length) textless++;
            const ops = diffWords(geoA.words.map((w) => norm(w.text)), geoB.words.map((w) => norm(w.text)));
            const hk = hunks(ops);
            hk.forEach((x) => { del += x.del.length; ins += x.ins.length; });
            if (hk.length) changedPages++;
            pages.push({ n, ops, geoA, geoB, hunks: hk });
            if (n % 10 === 0) await PS.util.tick();
          }
          return { pages, ins, del, changedPages, textless };
        }, 'compare');
        if (!res) return;
        result = res;
        pageNo = (res.pages.find((p) => p.hunks.length) || res.pages[0]).n;
        showResult();
      }

      function showResult() {
        const layout = PS.kit.twoColumn();
        const left = h('div', { class: 'viewer' }), right = h('div', { class: 'viewer' });
        const label = h('span', { 'aria-live': 'polite' });
        const prev = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Previous page', onclick: () => go(pageNo - 1) }, icon('chevron-left'));
        const next = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Next page', onclick: () => go(pageNo + 1) }, icon('chevron-right'));
        const prevC = h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => jump(-1) }, icon('arrow-up', 'icon-sm'), 'Previous change');
        const nextC = h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => jump(1) }, icon('arrow-down', 'icon-sm'), 'Next change');
        const changeList = h('ul', { class: 'change-list' });
        const resultSlot = h('div', { class: 'result-slot', hidden: true, 'aria-live': 'polite' });
        const total = result.pages.reduce((s, p) => s + p.hunks.length, 0);
        layout.workspace.append(
          h('section', { class: 'panel' },
            h('div', { class: 'list-toolbar', style: { marginBottom: '12px' } },
              h('div', { class: 'diff-legend' }, h('span', null, h('i', { class: 'diff-del' }), 'Removed'), h('span', null, h('i', { class: 'diff-ins' }), 'Added')),
              h('div', { class: 'pager' }, prev, label, next)),
            h('div', { class: 'compare-grid' },
              h('div', null, h('h3', null, 'Original — ' + docs.a.name), left),
              h('div', null, h('h3', null, 'Revised — ' + docs.b.name), right))),
          resultSlot);
        const summary = total
          ? `${plural(total, 'change')} on ${plural(result.changedPages, 'page')}: ${plural(result.del, 'word')} removed, ${plural(result.ins, 'word')} added.`
          : 'No text differences found.';
        layout.options.append(
          PS.kit.panel('Summary', h('p', null, summary),
            result.textless ? ui.note(`${plural(result.textless, 'page')} have no text layer (scans?) and could not be compared. Run OCR on both files first.`, 'warn') : null,
            docs.a.pageCount !== docs.b.pageCount ? h('p', { class: 'hint' }, `Page count differs: ${docs.a.pageCount} vs ${docs.b.pageCount}.`) : null,
            h('div', { class: 'btn-row', style: { marginTop: '10px' } }, prevC, nextC)),
          PS.kit.panel('Changes on this page', changeList),
          PS.kit.panel('Export',
            h('button', { class: 'btn', type: 'button', style: { width: '100%' }, disabled: !total, onclick: () => exportReport(resultSlot) }, icon('download'), 'Download marked-up copy'),
            h('p', { class: 'hint', style: { marginTop: '8px' } }, 'The revised PDF with additions highlighted and removals added as comments.'),
            h('button', { class: 'btn btn-secondary', type: 'button', style: { width: '100%', marginTop: '10px' }, onclick: showStart }, icon('refresh', 'icon-sm'), 'Compare other files')));
        root.replaceChildren(layout.el);

        async function draw(target, hd, n, geo, idxs, cls) {
          if (n > hd.pageCount) { target.replaceChildren(h('p', { class: 'hint' }, 'No page ' + n + ' in this version.')); return; }
          const width = Math.max(200, Math.min(520, target.clientWidth - 24));
          const c = await PS.engine.renderPage(hd.pdfjs, n, { width, hidpi: true });
          canvases.push(c);
          const page = await hd.pdfjs.getPage(n);
          const vp = page.getViewport({ scale: c.pdfScale });
          const stage = h('div', { class: 'viewer-page' }, c);
          idxs.forEach((i) => {
            const w = geo.words[i];
            const q = TG().quadFor(w.run, w.from, w.to);
            const [l, t, ww, hh] = TG().quadToViewport(vp, q);
            stage.append(h('div', { class: 'diff-mark ' + cls, style: { left: l + 'px', top: t + 'px', width: ww + 'px', height: hh + 'px' } }));
          });
          target.replaceChildren(stage);
        }
        async function go(n) {
          pageNo = Math.max(1, Math.min(result.pages.length, n));
          const p = result.pages[pageNo - 1];
          prev.disabled = pageNo <= 1; next.disabled = pageNo >= result.pages.length;
          label.textContent = `Page ${pageNo} of ${result.pages.length}`;
          while (canvases.length) PS.engine.releaseCanvas(canvases.pop());
          const dels = [].concat(...p.hunks.map((x) => x.del)), insl = [].concat(...p.hunks.map((x) => x.ins));
          changeList.replaceChildren(...(p.hunks.length ? p.hunks.map((x) => h('li', null,
            x.del.length ? h('del', null, x.del.map((i) => p.geoA.words[i].text).join(' ')) : null,
            x.del.length && x.ins.length ? ' → ' : null,
            x.ins.length ? h('ins', null, x.ins.map((i) => p.geoB.words[i].text).join(' ')) : null))
            : [h('li', null, 'No changes on this page.')]));
          try {
            await Promise.all([draw(left, docs.a, pageNo, p.geoA, dels, 'diff-del'), draw(right, docs.b, pageNo, p.geoB, insl, 'diff-ins')]);
          } catch (err) { ui.reportError(err, 'compare'); }
        }
        function jump(d) {
          const pages = result.pages.filter((p) => p.hunks.length).map((p) => p.n);
          if (!pages.length) return;
          const t = d > 0 ? pages.find((n) => n > pageNo) : [...pages].reverse().find((n) => n < pageNo);
          go(t || (d > 0 ? pages[0] : pages[pages.length - 1]));
        }
        go(pageNo);
      }

      async function exportReport(slotEl) {
        const blob = await ui.run('Creating marked-up copy…', async () => {
          const doc = await PS.engine.loadPdfLib(docs.b.bytes);
          for (const p of result.pages) {
            if (p.n > docs.b.pageCount || !p.hunks.length) continue;
            const items = [];
            for (const x of p.hunks) {
              if (x.ins.length) items.push({ type: 'highlight', quads: x.ins.map((i) => { const w = p.geoB.words[i]; return TG().quadFor(w.run, w.from, w.to); }), color: [0.36, 0.83, 0.37], opacity: 0.45, note: 'Added' + (x.del.length ? ` (replaces: “${x.del.map((i) => p.geoA.words[i].text).join(' ')}”)` : '') });
              if (x.del.length && !x.ins.length) {
                const anchor = x.anchorB != null ? p.geoB.words[x.anchorB] : p.geoB.words[p.geoB.words.length - 1];
                const q = anchor ? TG().quadFor(anchor.run, anchor.from, anchor.to) : [36, 760];
                items.push({ type: 'note', x: Math.max(0, q[0] - 22), y: q[1] + 4, text: 'Removed: “' + x.del.map((i) => p.geoA.words[i].text).join(' ') + '”', color: [1, 0.42, 0.42] });
              }
            }
            await PS.annots.write(doc, p.n - 1, items, { author: 'PDF Studio Compare' });
          }
          return PS.engine.saveToBlob(doc);
        }, 'compare-export');
        if (blob) ui.showResult(slotEl, { blob, filename: `${baseName(docs.b.name)}_compared.pdf`, detail: 'Changes marked as comments' });
      }

      showStart();
      return { destroy() { while (canvases.length) PS.engine.releaseCanvas(canvases.pop()); if (docs.a) docs.a.destroy(); if (docs.b) docs.b.destroy(); } };
    },
  });
})(window);
