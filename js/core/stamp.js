/**
 * PDF Studio — shared "stamp" helpers used by Watermark and Page numbers.
 *
 *  - layout(): computes where a box of (w, h) goes on a page of (W, H) for a 3×3 position
 *    code or a tiled pattern, in *display* coordinates (top-left origin, y down, points).
 *  - pagePicker(): "All / First / Last / Odd / Even / Custom" selector.
 *  - previewer(): renders a page with pdf.js and lets a tool paint an overlay on top, so the
 *    live preview uses exactly the same geometry as the exported PDF.
 */
(function (global) {
  'use strict';
  const PS = global.PS;
  const { h, icon, parseRanges } = PS.util;
  const ui = PS.ui;

  /** Bounding box of a w×h rectangle rotated by `angle` degrees. */
  function rotatedBox(w, hgt, angle) {
    const t = (angle * Math.PI) / 180;
    return { bw: Math.abs(w * Math.cos(t)) + Math.abs(hgt * Math.sin(t)), bh: Math.abs(w * Math.sin(t)) + Math.abs(hgt * Math.cos(t)) };
  }

  /** Returns [{cx, cy}] centres. */
  function layout(W, H, w, hgt, { position = 'mc', angle = 0, margin = 36, tile = false }) {
    const { bw, bh } = rotatedBox(w, hgt, angle);
    if (tile) {
      const gx = bw + Math.max(40, bw * 0.35), gy = bh + Math.max(60, bh * 1.2);
      const out = [];
      let row = 0;
      for (let y = gy / 2; y < H + gy / 2; y += gy, row++) {
        const shift = row % 2 ? gx / 2 : 0; // brick pattern
        for (let x = gx / 2 - shift; x < W + gx / 2; x += gx) out.push({ cx: x, cy: y });
      }
      return out;
    }
    const col = position[1], row = position[0];
    const cx = col === 'l' ? margin + bw / 2 : col === 'r' ? W - margin - bw / 2 : W / 2;
    const cy = row === 't' ? margin + bh / 2 : row === 'b' ? H - margin - bh / 2 : H / 2;
    return [{ cx, cy }];
  }

  function pagePicker(pageCount) {
    const mode = ui.select([['all', 'All pages'], ['first', 'First page'], ['last', 'Last page'], ['odd', 'Odd pages'], ['even', 'Even pages'], ['custom', 'Custom…']], 'all');
    const custom = h('input', { type: 'text', placeholder: 'e.g. 1-3, 6', spellcheck: false, 'aria-label': 'Custom pages' });
    const wrap = h('div', null, ui.field('Apply to', mode), h('div', { style: { marginTop: '8px' } }, custom));
    custom.parentElement.hidden = true;
    mode.addEventListener('change', () => { custom.parentElement.hidden = mode.value !== 'custom'; if (mode.value === 'custom') custom.focus(); });
    return {
      el: wrap, mode, custom,
      /** 0-based page indices; throws with a readable message on bad ranges. */
      indices() {
        const all = [...Array(pageCount).keys()];
        switch (mode.value) {
          case 'first': return [0];
          case 'last': return [pageCount - 1];
          case 'odd': return all.filter((i) => i % 2 === 0);
          case 'even': return all.filter((i) => i % 2 === 1);
          case 'custom': return parseRanges(custom.value, pageCount, { allowEmpty: false });
          default: return all;
        }
      },
    };
  }

  /**
   * Page preview with an overlay canvas.
   * draw(ctx, scale, pageInfo) paints the overlay; pageInfo = {W, H} in display points.
   */
  function previewer(handle, draw) {
    let pageNo = 1;
    let base = null; // rendered page canvas
    let info = null;
    const overlay = h('canvas', { 'aria-hidden': 'true', style: { position: 'absolute', inset: '0', width: '100%', height: '100%' } });
    const stage = h('div', { class: 'viewer-page' });
    const label = h('span', { 'aria-live': 'polite' });
    const prev = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Previous page', onclick: () => go(pageNo - 1) }, icon('chevron-left'));
    const next = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Next page', onclick: () => go(pageNo + 1) }, icon('chevron-right'));
    const el = h('section', { class: 'panel' },
      h('div', { class: 'list-toolbar', style: { marginBottom: '12px' } }, h('h2', null, 'Preview'), h('div', { class: 'pager' }, prev, label, next)),
      h('div', { class: 'viewer' }, stage));

    async function go(n) {
      pageNo = Math.max(1, Math.min(handle.pageCount, n));
      prev.disabled = pageNo <= 1; next.disabled = pageNo >= handle.pageCount;
      label.textContent = `Page ${pageNo} of ${handle.pageCount}`;
      const width = Math.min(560, (el.clientWidth || 600) - 80);
      try {
        const c = await PS.engine.renderPage(handle.pdfjs, pageNo, { width, hidpi: true });
        if (base) PS.engine.releaseCanvas(base);
        base = c;
        const page = await handle.pdfjs.getPage(pageNo);
        const vp = page.getViewport({ scale: 1 });
        info = { W: vp.width, H: vp.height, page: pageNo };
        stage.replaceChildren(c, overlay);
        refresh();
      } catch (err) { PS.ui.reportError(err, 'preview'); }
    }

    function refresh() {
      if (!base || !info) return;
      overlay.width = base.width; overlay.height = base.height;
      const ctx = overlay.getContext('2d');
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      const scale = base.width / info.W;
      ctx.save();
      ctx.scale(scale, scale);
      try { draw(ctx, info); } catch (err) { console.warn('preview draw', err); }
      ctx.restore();
    }

    requestAnimationFrame(() => go(1));
    return { el, refresh, get page() { return pageNo; }, destroy() { if (base) PS.engine.releaseCanvas(base); } };
  }

  /** Draw text on a 2D canvas the way drawTextDisplay places it in the PDF (baseline anchor, ccw angle). */
  function canvasText(ctx, text, { dx, dy, size, cssFont, color, opacity, angle, lineHeight = 1.2 }) {
    ctx.save();
    ctx.translate(dx, dy);
    ctx.rotate((-angle * Math.PI) / 180);
    ctx.globalAlpha = opacity;
    ctx.fillStyle = color;
    ctx.font = `${cssFont.replace('{size}', size + 'px')}`;
    ctx.textBaseline = 'alphabetic';
    String(text).split(/\r?\n/).forEach((line, i) => ctx.fillText(line, 0, i * size * lineHeight));
    ctx.restore();
  }

  PS.stamp = { layout, rotatedBox, pagePicker, previewer, canvasText };
})(window);
