/**
 * PDF Studio — document viewer (PS.viewer)
 *
 * A continuous-scroll PDF viewer used by the Viewer tool and by every tool that works
 * "on the page" (Comment, Fill form, Prepare form, Edit, Redact):
 *   - lazy page rendering (only pages near the viewport are drawn; far pages are released)
 *   - zoom in/out, fit width, fit page, Ctrl/⌘ + wheel, keyboard shortcuts
 *   - page navigation (prev/next, page number box, thumbnail sidebar)
 *   - selectable text layer (pdf.js) and full-text search with highlighted matches
 *   - an overlay layer per page that tools can draw/listen on, with px <-> PDF helpers
 *
 * create(handle, opts) -> viewer
 *   opts: { textLayer=true, thumbnails=true, search=true, toolbarExtra:[nodes],
 *           onPage(pv) called whenever a page view's overlay is (re)laid out,
 *           height: CSS height of the scroll area }
 */
(function (global) {
  'use strict';
  const PS = global.PS;
  const { h, icon, debounce, clamp } = PS.util;

  const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
  const PAD = 24;      // scroller padding (px)
  const KEEP = 14;     // max rendered pages kept in memory

  function create(handle, opts = {}) {
    const doc = handle.pdfjs;
    const N = doc.numPages;
    const pvs = [];
    let scale = 1;
    let zoomMode = 'width';
    let current = 1;
    let destroyed = false;
    let interactive = false;
    const rendered = new Set();
    const listeners = { page: [], zoom: [] };

    /* ----------------------------------------------------------- DOM */
    const pageInput = h('input', { type: 'text', inputmode: 'numeric', class: 'pv-page-input', value: '1', 'aria-label': 'Page number', autocomplete: 'off' });
    const pageTotal = h('span', { class: 'pv-total' }, `/ ${N}`);
    const btnPrev = h('button', { class: 'icon-btn', type: 'button', title: 'Previous page', 'aria-label': 'Previous page', onclick: () => goTo(current - 1) }, icon('chevron-left'));
    const btnNext = h('button', { class: 'icon-btn', type: 'button', title: 'Next page', 'aria-label': 'Next page', onclick: () => goTo(current + 1) }, icon('chevron-right'));
    const zoomSel = h('select', { class: 'pv-zoom', 'aria-label': 'Zoom' },
      h('option', { value: 'width' }, 'Fit width'), h('option', { value: 'page' }, 'Fit page'),
      ...ZOOMS.map((z) => h('option', { value: String(z) }, Math.round(z * 100) + '%')),
      h('option', { value: 'custom', hidden: true }, ''));
    const btnOut = h('button', { class: 'icon-btn', type: 'button', title: 'Zoom out (Ctrl −)', 'aria-label': 'Zoom out', onclick: () => step(-1) }, icon('minus'));
    const btnIn = h('button', { class: 'icon-btn', type: 'button', title: 'Zoom in (Ctrl +)', 'aria-label': 'Zoom in', onclick: () => step(1) }, icon('plus'));
    const btnThumbs = h('button', { class: 'icon-btn', type: 'button', title: 'Page thumbnails', 'aria-label': 'Toggle page thumbnails', 'aria-pressed': 'false', onclick: () => toggleThumbs() }, icon('layout'));

    const searchInput = h('input', { type: 'search', class: 'pv-search-input', placeholder: 'Find in document', 'aria-label': 'Find in document', autocomplete: 'off', spellcheck: false });
    const searchCount = h('span', { class: 'pv-search-count', 'aria-live': 'polite' });
    const btnSPrev = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Previous match', title: 'Previous match (Shift+Enter)', onclick: () => stepMatch(-1) }, icon('arrow-up'));
    const btnSNext = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Next match', title: 'Next match (Enter)', onclick: () => stepMatch(1) }, icon('arrow-down'));
    const searchBox = h('div', { class: 'pv-search' }, icon('search', 'icon-sm'), searchInput, searchCount, btnSPrev, btnSNext);

    const toolbar = h('div', { class: 'pv-toolbar', role: 'toolbar', 'aria-label': 'Viewer' },
      h('div', { class: 'pv-group' }, opts.thumbnails !== false ? btnThumbs : null, btnPrev, h('span', { class: 'pv-pagebox' }, pageInput, pageTotal), btnNext),
      h('div', { class: 'pv-group' }, btnOut, zoomSel, btnIn),
      opts.search !== false ? searchBox : null,
      ...(opts.toolbarExtra || []).map((n) => h('div', { class: 'pv-group' }, n)));

    const pagesEl = h('div', { class: 'pv-pages' });
    const scroller = h('div', { class: 'pv-scroll', tabindex: '0', 'aria-label': 'Document pages' }, pagesEl);
    const thumbs = h('nav', { class: 'pv-thumbs', 'aria-label': 'Page thumbnails', hidden: true });
    const body = h('div', { class: 'pv-body' }, thumbs, scroller);
    const el = h('section', { class: 'pv' + (opts.textLayer === false ? '' : ' has-text') }, toolbar, body);
    if (opts.height) scroller.style.height = opts.height;

    /* ------------------------------------------------------ Page views */
    async function init() {
      for (let n = 1; n <= N; n++) {
        const page = await doc.getPage(n);
        if (destroyed) return;
        const base = page.getViewport({ scale: 1 });
        const pv = makePv(n, page, base);
        pvs.push(pv);
        pagesEl.append(pv.el);
        if (opts.thumbnails !== false) thumbs.append(pv.thumb);
        if (n === 1) { applyZoom(zoomMode, true); }
        else layoutPv(pv);
        if (n % 50 === 0) await PS.util.tick();
      }
      applyZoom(zoomMode, true);
      observe();
      if (opts.thumbnails !== false && (opts.showThumbs || (scroller.clientWidth > 900 && N > 1))) toggleThumbs(true);
      api.ready = true;
      readyResolve();
    }

    function makePv(n, page, base) {
      const canvasWrap = h('div', { class: 'pv-canvas' });
      const textEl = h('div', { class: 'textLayer' });
      const hlEl = h('div', { class: 'pv-hl', 'aria-hidden': 'true' });
      const overlay = h('div', { class: 'pv-overlay' });
      const pel = h('div', { class: 'pv-page', 'data-page': String(n), role: 'img', 'aria-label': `Page ${n}` }, canvasWrap, hlEl, textEl, overlay);
      const thumb = h('button', { class: 'pv-thumb', type: 'button', 'aria-label': `Go to page ${n}`, onclick: () => goTo(n) }, h('span', { class: 'pv-thumb-img' }), h('span', { class: 'pv-thumb-n' }, String(n)));
      const pv = {
        num: n, page, base, el: pel, canvasWrap, textEl, hlEl, overlay, thumb, viewport: null, canvas: null, task: null, textTask: null, token: 0,
        /** CSS px within the page -> PDF user-space point [x, y] */
        toPdf(px, py) { return pv.viewport.convertToPdfPoint(px, py); },
        /** PDF user-space point -> CSS px [x, y] */
        toPx(x, y) { return pv.viewport.convertToViewportPoint(x, y); },
        /** user-space rect [x1,y1,x2,y2] -> {left, top, width, height} CSS px */
        rectToPx(r) {
          const [a, b, c, d] = pv.viewport.convertToViewportRectangle(r);
          return { left: Math.min(a, c), top: Math.min(b, d), width: Math.abs(c - a), height: Math.abs(d - b) };
        },
        /** CSS px rect -> normalized user-space rect */
        pxToRect(left, top, width, height) {
          const p1 = pv.toPdf(left, top), p2 = pv.toPdf(left + width, top + height);
          return [Math.min(p1[0], p2[0]), Math.min(p1[1], p2[1]), Math.max(p1[0], p2[0]), Math.max(p1[1], p2[1])];
        },
        /** Pointer event -> CSS px inside this page */
        eventPoint(e) { const r = pel.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; },
        get scale() { return scale; },
        get rotation() { return pv.viewport ? pv.viewport.rotation : page.rotate; },
      };
      return pv;
    }

    function layoutPv(pv) {
      pv.viewport = pv.page.getViewport({ scale });
      pv.el.style.width = Math.floor(pv.viewport.width) + 'px';
      pv.el.style.height = Math.floor(pv.viewport.height) + 'px';
      pv.el.style.setProperty('--scale-factor', String(scale));
      const tw = 96 / pv.base.width;
      pv.thumb.firstChild.style.width = '96px';
      pv.thumb.firstChild.style.height = Math.round(pv.base.height * tw) + 'px';
      paintHighlights(pv);
      listeners.page.forEach((fn) => { try { fn(pv); } catch (e) { console.warn(e); } });
    }

    /* ------------------------------------------------------- Rendering */
    const renderQueue = [];
    let rendering = 0;
    function requestRender(pv) {
      if (pv.renderedScale === scale || renderQueue.includes(pv)) return;
      renderQueue.push(pv);
      pumpRender();
    }
    function pumpRender() {
      while (rendering < 2 && renderQueue.length) {
        // nearest to current page first
        renderQueue.sort((a, b) => Math.abs(a.num - current) - Math.abs(b.num - current));
        const pv = renderQueue.shift();
        rendering++;
        renderPv(pv).catch((err) => { if (err && err.name !== 'RenderingCancelledException') console.warn('render', err); })
          .finally(() => { rendering--; pumpRender(); });
      }
    }
    async function renderPv(pv) {
      if (destroyed) return;
      const token = ++pv.token;
      const s = scale;
      const dpr = Math.min(global.devicePixelRatio || 1, 2);
      const outScale = PS.engine.safeScale(pv.base.width, pv.base.height, s * dpr);
      const vp = pv.page.getViewport({ scale: outScale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(vp.width));
      canvas.height = Math.max(1, Math.floor(vp.height));
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      pv.task = pv.page.render({ canvasContext: ctx, viewport: vp });
      await pv.task.promise;
      pv.task = null;
      if (token !== pv.token || destroyed || s !== scale) { PS.engine.releaseCanvas(canvas); return; }
      if (pv.canvas) PS.engine.releaseCanvas(pv.canvas);
      pv.canvas = canvas;
      pv.canvasWrap.replaceChildren(canvas);
      pv.renderedScale = s;
      rendered.add(pv);
      if (opts.textLayer !== false) await renderText(pv, token);
      paintThumb(pv, canvas);
      trim();
    }
    async function renderText(pv, token) {
      try {
        const tc = await pv.page.getTextContent();
        if (token !== pv.token) return;
        pv.textEl.replaceChildren();
        pv.textTask = global.pdfjsLib.renderTextLayer({ textContentSource: tc, container: pv.textEl, viewport: pv.viewport, textDivs: [] });
        await pv.textTask.promise;
      } catch (err) { if (err && err.name !== 'AbortException') console.warn('text layer', err); }
    }
    function unrender(pv) {
      pv.token++;
      if (pv.task) { try { pv.task.cancel(); } catch (_) { /* noop */ } pv.task = null; }
      if (pv.canvas) { PS.engine.releaseCanvas(pv.canvas); pv.canvas = null; }
      pv.canvasWrap.replaceChildren();
      pv.textEl.replaceChildren();
      pv.renderedScale = 0;
      rendered.delete(pv);
    }
    function trim() {
      if (rendered.size <= KEEP) return;
      [...rendered].sort((a, b) => Math.abs(b.num - current) - Math.abs(a.num - current))
        .slice(0, rendered.size - KEEP).forEach(unrender);
    }
    function paintThumb(pv, canvas) {
      if (pv.thumbDone || opts.thumbnails === false) return;
      const box = pv.thumb.firstChild;
      const t = document.createElement('canvas');
      const w = 96 * Math.min(global.devicePixelRatio || 1, 2);
      t.width = Math.round(w); t.height = Math.round(w * canvas.height / canvas.width);
      t.getContext('2d').drawImage(canvas, 0, 0, t.width, t.height);
      box.replaceChildren(t);
      pv.thumbDone = true;
    }
    async function renderThumbOnly(pv) {
      if (pv.thumbDone) return;
      const c = await PS.engine.renderPage(doc, pv.num, { width: 96, hidpi: true });
      if (!pv.thumbDone) { pv.thumb.firstChild.replaceChildren(c); pv.thumbDone = true; } else PS.engine.releaseCanvas(c);
    }

    let io = null, tio = null;
    function observe() {
      io = new IntersectionObserver((entries) => {
        for (const en of entries) {
          const pv = pvs[+en.target.dataset.page - 1];
          if (en.isIntersecting) requestRender(pv);
        }
      }, { root: scroller, rootMargin: '600px 0px' });
      pvs.forEach((pv) => io.observe(pv.el));
      if (opts.thumbnails !== false) {
        tio = new IntersectionObserver((entries) => {
          for (const en of entries) if (en.isIntersecting) renderThumbOnly(pvs[+en.target.dataset.n - 1]).catch(() => {});
        }, { root: thumbs, rootMargin: '200px 0px' });
        pvs.forEach((pv) => { pv.thumb.dataset.n = String(pv.num); tio.observe(pv.thumb); });
      }
    }

    /* ------------------------------------------------------------ Zoom */
    function fitScale(mode) {
      const ref = pvs[current - 1] || pvs[0];
      if (!ref) return 1;
      const vp1 = ref.page.getViewport({ scale: 1 });
      const availW = Math.max(120, scroller.clientWidth - PAD * 2);
      const maxW = Math.max(...pvs.map((p) => p.page.getViewport({ scale: 1 }).width));
      const sw = availW / maxW;
      if (mode === 'width') return clamp(sw, 0.1, 4);
      const availH = Math.max(120, scroller.clientHeight - PAD * 2);
      return clamp(Math.min(availW / vp1.width, availH / vp1.height), 0.1, 4);
    }
    function applyZoom(mode, silent) {
      const anchor = pvs[current - 1];
      const off = anchor ? (scroller.scrollTop - anchor.el.offsetTop) / (anchor.el.offsetHeight || 1) : 0;
      zoomMode = mode;
      const next = typeof mode === 'number' ? clamp(mode, 0.1, 5) : fitScale(mode);
      const changed = Math.abs(next - scale) > 1e-4;
      scale = next;
      const opt = [...zoomSel.options].find((o) => o.value === String(mode));
      if (opt) zoomSel.value = opt.value;
      else { const c = zoomSel.querySelector('option[value="custom"]'); c.textContent = Math.round(scale * 100) + '%'; zoomSel.value = 'custom'; }
      if (!changed && !silent) return;
      pvs.forEach((pv) => { if (pv.task) { try { pv.task.cancel(); } catch (_) { /* noop */ } } pv.renderedScale = 0; layoutPv(pv); });
      if (anchor) scroller.scrollTop = anchor.el.offsetTop + off * anchor.el.offsetHeight;
      // re-render visible pages; keep the old bitmap (stretched) until the new one arrives
      pvs.forEach((pv) => { if (pv.canvas) { pv.canvas.style.width = '100%'; pv.canvas.style.height = '100%'; } });
      renderVisible();
      listeners.zoom.forEach((fn) => fn(scale));
    }
    function renderVisible() {
      const top = scroller.scrollTop - 600, bottom = scroller.scrollTop + scroller.clientHeight + 600;
      pvs.forEach((pv) => {
        const y = pv.el.offsetTop;
        if (y + pv.el.offsetHeight >= top && y <= bottom) requestRender(pv);
        else if (pv.canvas) unrender(pv);
      });
    }
    function step(dir) {
      const cur = scale;
      let next;
      if (dir > 0) next = ZOOMS.find((z) => z > cur + 0.01) || ZOOMS[ZOOMS.length - 1];
      else next = [...ZOOMS].reverse().find((z) => z < cur - 0.01) || ZOOMS[0];
      applyZoom(next);
    }
    zoomSel.addEventListener('change', () => { const v = zoomSel.value; if (v === 'custom') return; applyZoom(v === 'width' || v === 'page' ? v : +v); });
    scroller.addEventListener('wheel', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      applyZoom(clamp(scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1), 0.1, 5));
    }, { passive: false });
    const onResize = debounce(() => { if (zoomMode === 'width' || zoomMode === 'page') applyZoom(zoomMode); }, 120);
    const ro = new ResizeObserver(onResize);
    ro.observe(scroller);

    /* ------------------------------------------------------ Navigation */
    function updateCurrent() {
      const mid = scroller.scrollTop + Math.min(scroller.clientHeight * 0.35, 300);
      let n = 1;
      for (const pv of pvs) { if (pv.el.offsetTop <= mid) n = pv.num; else break; }
      if (n !== current) {
        current = n;
        pvs.forEach((pv) => pv.thumb.classList.toggle('is-current', pv.num === n));
        const t = pvs[n - 1] && pvs[n - 1].thumb;
        if (t && !thumbs.hidden) {
          const tr = t.offsetTop, th = t.offsetHeight;
          if (tr < thumbs.scrollTop || tr + th > thumbs.scrollTop + thumbs.clientHeight) thumbs.scrollTop = tr - 20;
        }
        if (api.onCurrent) api.onCurrent(n);
      }
      if (document.activeElement !== pageInput) pageInput.value = String(current);
      btnPrev.disabled = current <= 1; btnNext.disabled = current >= N;
    }
    let scrollRaf = 0;
    scroller.addEventListener('scroll', () => { if (!scrollRaf) scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; updateCurrent(); }); });
    function goTo(n, yOffsetPx) {
      n = clamp(Math.round(n) || 1, 1, N);
      const pv = pvs[n - 1];
      if (!pv) return;
      scroller.scrollTop = pv.el.offsetTop - PAD / 2 + (yOffsetPx || 0);
      current = n; updateCurrent();
      pvs.forEach((p) => p.thumb.classList.toggle('is-current', p.num === n));
    }
    pageInput.addEventListener('change', () => goTo(parseInt(pageInput.value, 10)));
    pageInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); goTo(parseInt(pageInput.value, 10)); } });
    function toggleThumbs(force) {
      const show = force != null ? force : thumbs.hidden;
      thumbs.hidden = !show;
      btnThumbs.setAttribute('aria-pressed', String(show));
      btnThumbs.classList.toggle('is-active', show);
      onResize();
    }

    scroller.addEventListener('keydown', (e) => {
      if (e.target !== scroller) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) { e.preventDefault(); step(1); }
      else if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); step(-1); }
      else if ((e.ctrlKey || e.metaKey) && e.key === '0') { e.preventDefault(); applyZoom('width'); }
      else if (e.key === 'PageDown' && e.altKey) { e.preventDefault(); goTo(current + 1); }
      else if (e.key === 'PageUp' && e.altKey) { e.preventDefault(); goTo(current - 1); }
      else if (e.key === 'Home' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); goTo(1); }
      else if (e.key === 'End' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); goTo(N); }
    });

    /* ---------------------------------------------------------- Search */
    let matches = [];      // [{page, quads, text}]
    let matchIdx = -1;
    let searchToken = 0;
    async function runSearch(q) {
      const token = ++searchToken;
      matches = []; matchIdx = -1;
      pvs.forEach(paintHighlights);
      if (!q.trim()) { searchCount.textContent = ''; return; }
      searchCount.textContent = 'Searching…';
      for (let n = 1; n <= N; n++) {
        const geo = await PS.textgeo.page(doc, n);
        if (token !== searchToken) return;
        PS.textgeo.find(geo, q).forEach((m) => matches.push({ page: n, quads: m.quads, text: m.text }));
        if (n % 20 === 0) searchCount.textContent = `${matches.length} found…`;
      }
      pvs.forEach(paintHighlights);
      if (matches.length) {
        // first match at/after the current page
        const i = matches.findIndex((m) => m.page >= current);
        setMatch(i < 0 ? 0 : i);
      } else searchCount.textContent = 'No matches';
    }
    function setMatch(i) {
      if (!matches.length) return;
      matchIdx = (i + matches.length) % matches.length;
      const m = matches[matchIdx];
      searchCount.textContent = `${matchIdx + 1} of ${matches.length}`;
      pvs.forEach(paintHighlights);
      const pv = pvs[m.page - 1];
      const r = PS.textgeo.quadToViewport(pv.viewport, m.quads[0]);
      scroller.scrollTop = pv.el.offsetTop + r[1] - scroller.clientHeight / 3;
      const left = pv.el.offsetLeft + r[0] - scroller.clientWidth / 2;
      if (scroller.scrollWidth > scroller.clientWidth) scroller.scrollLeft = Math.max(0, left);
      updateCurrent();
    }
    function stepMatch(d) { if (matches.length) setMatch(matchIdx + d); else if (searchInput.value.trim()) runSearch(searchInput.value); }
    function paintHighlights(pv) {
      if (!pv.viewport) return;
      const frag = document.createDocumentFragment();
      matches.forEach((m, i) => {
        if (m.page !== pv.num) return;
        m.quads.forEach((q) => {
          const [l, t, w, hh] = PS.textgeo.quadToViewport(pv.viewport, q);
          frag.append(h('div', { class: 'pv-match' + (i === matchIdx ? ' is-current' : ''), style: { left: l + 'px', top: t + 'px', width: w + 'px', height: hh + 'px' } }));
        });
      });
      pv.hlEl.replaceChildren(frag);
    }
    const debSearch = debounce(() => runSearch(searchInput.value), 250);
    searchInput.addEventListener('input', debSearch);
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); if (matches.length) stepMatch(e.shiftKey ? -1 : 1); else runSearch(searchInput.value); }
      else if (e.key === 'Escape') { searchInput.value = ''; runSearch(''); }
    });

    /* ------------------------------------------------------------- API */
    let readyResolve;
    const ready = new Promise((r) => { readyResolve = r; });
    const api = {
      el, toolbar, scroller, pages: pvs, ready: false, whenReady: ready,
      get current() { return current; },
      get scale() { return scale; },
      goTo, zoom: applyZoom, toggleThumbs,
      search(q) { searchInput.value = q; return runSearch(q); },
      get matches() { return matches; },
      focusSearch() { searchInput.focus(); searchInput.select(); },
      /** Register fn(pv) called on every page layout (initial + each zoom). */
      onPage(fn) { listeners.page.push(fn); pvs.forEach((pv) => pv.viewport && fn(pv)); },
      onZoom(fn) { listeners.zoom.push(fn); },
      /** Let tools capture pointer input on the overlay (disables text selection). */
      setInteractive(on, cursor) {
        interactive = !!on;
        el.classList.toggle('is-interactive', interactive);
        el.style.setProperty('--pv-cursor', cursor || 'crosshair');
      },
      get interactive() { return interactive; },
      /** Re-render one page (or all) — e.g. after the underlying document changed. */
      rerender(n) { (n ? [pvs[n - 1]] : pvs).forEach((pv) => { if (pv) { pv.renderedScale = 0; } }); renderVisible(); },
      destroy() {
        destroyed = true;
        searchToken++;
        if (io) io.disconnect(); if (tio) tio.disconnect(); ro.disconnect();
        pvs.forEach((pv) => { unrender(pv); try { pv.page.cleanup(); } catch (_) { /* noop */ } });
      },
    };
    if (opts.onPage) listeners.page.push(opts.onPage);
    requestAnimationFrame(() => init().catch((err) => PS.ui.reportError(err, 'viewer')));
    return api;
  }

  PS.viewer = { create };
})(window);
