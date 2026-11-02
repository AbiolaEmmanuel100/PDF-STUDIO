/**
 * PDF Studio — text geometry (PS.textgeo)
 *
 * Turns pdf.js text content into positioned runs, words and quads in PDF user space.
 * Used by the viewer search, markup (highlight/underline/strike-out), redaction,
 * Compare and Edit text — so every tool agrees on where a piece of text is.
 *
 * A quad is 8 numbers in PDF user space, in the order used by /QuadPoints:
 *   [x1,y1 (top-left), x2,y2 (top-right), x3,y3 (bottom-left), x4,y4 (bottom-right)]
 */
(function (global) {
  'use strict';
  const PS = global.PS;
  const ASC = 0.9;   // top of a glyph box, as a fraction of the font size above the baseline
  const DESC = 0.24; // bottom of a glyph box below the baseline

  const cache = new WeakMap(); // pdfjs doc -> Map(pageNo -> Promise<geo>)

  /** Geometry for one item from its transform; returns null for empty / zero-size items. */
  function itemGeom(item, style) {
    const [a, b, c, d, e, f] = item.transform;
    const size = Math.hypot(c, d) || Math.hypot(a, b);
    if (!item.str || !size) return null;
    let ux = a, uy = b;
    const len = Math.hypot(ux, uy) || 1;
    ux /= len; uy /= len;
    if (style && style.vertical) { const t = ux; ux = -uy; uy = t; }
    const vx = -uy, vy = ux; // "up" direction
    const width = item.width || size * item.str.length * 0.5;
    return { x: e, y: f, ux, uy, vx, vy, size, width };
  }

  let measureCtx = null;
  /** Cumulative character offsets along a run, from canvas text metrics scaled to the run's real width. */
  function offsets(run) {
    if (run._offs) return run._offs;
    const n = run.str.length;
    const offs = new Array(n + 1);
    offs[0] = 0;
    let ok = false;
    try {
      measureCtx = measureCtx || document.createElement('canvas').getContext('2d');
      const fam = /serif/i.test(run.family || '') && !/sans/i.test(run.family || '') ? 'serif' : /mono/i.test(run.family || '') ? 'monospace' : 'sans-serif';
      measureCtx.font = `100px ${fam}`;
      for (let i = 1; i <= n; i++) offs[i] = measureCtx.measureText(run.str.slice(0, i)).width;
      ok = offs[n] > 0;
    } catch (_) { ok = false; }
    if (!ok) for (let i = 0; i <= n; i++) offs[i] = i;
    const k = run.g.width / (offs[n] || 1);
    for (let i = 0; i <= n; i++) offs[i] *= k;
    run._offs = offs;
    return offs;
  }

  /** Quad for characters [from, to) of a run (character positions from measured glyph widths). */
  function quadFor(run, from = 0, to = run.str.length) {
    const g = run.g;
    let s0, s1;
    if (!run.str.length) { s0 = 0; s1 = g.width; }
    else { const o = offsets(run); s0 = o[Math.max(0, Math.min(from, o.length - 1))]; s1 = o[Math.max(0, Math.min(to, o.length - 1))]; }
    const bx = g.x + g.ux * s0, by = g.y + g.uy * s0;
    const ex = g.x + g.ux * s1, ey = g.y + g.uy * s1;
    const up = g.size * ASC, dn = g.size * DESC;
    return [
      bx + g.vx * up, by + g.vy * up,
      ex + g.vx * up, ey + g.vy * up,
      bx - g.vx * dn, by - g.vy * dn,
      ex - g.vx * dn, ey - g.vy * dn,
    ];
  }

  function quadRect(q) {
    const xs = [q[0], q[2], q[4], q[6]], ys = [q[1], q[3], q[5], q[7]];
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }

  /**
   * Load the geometry of a page (cached per document).
   * Returns { runs:[{str, g, fontName, start, end}], text, words:[{text, start, end, run, from, to}] }
   * `text` is the page text with runs joined (spaces / newlines inserted where pdf.js says so),
   * and start/end are offsets into it, so a regex over `text` maps back to geometry.
   */
  function page(pdfjsDoc, pageNo) {
    let m = cache.get(pdfjsDoc);
    if (!m) { m = new Map(); cache.set(pdfjsDoc, m); }
    if (!m.has(pageNo)) m.set(pageNo, load(pdfjsDoc, pageNo));
    return m.get(pageNo);
  }

  async function load(pdfjsDoc, pageNo) {
    const p = await pdfjsDoc.getPage(pageNo);
    const tc = await p.getTextContent();
    const runs = [];
    let text = '';
    let prev = null;
    for (const item of tc.items) {
      if (item.str === undefined) continue; // marked-content markers
      const g = itemGeom(item, tc.styles[item.fontName]);
      if (!g) { if (item.hasEOL && text && !text.endsWith('\n')) text += '\n'; continue; }
      // Insert a separator when pdf.js didn't give us one but the runs are visually apart.
      if (prev && text && !/\s$/.test(text) && !/^\s/.test(item.str)) {
        const dx = (g.x - (prev.g.x + prev.g.ux * prev.g.width)) * prev.g.ux + (g.y - (prev.g.y + prev.g.uy * prev.g.width)) * prev.g.uy;
        const dy = Math.abs((g.x - prev.g.x) * prev.g.vx + (g.y - prev.g.y) * prev.g.vy);
        if (dy > prev.g.size * 0.6) text += '\n';
        else if (dx > prev.g.size * 0.15) text += ' ';
      }
      const start = text.length;
      text += item.str;
      const run = { str: item.str, g, fontName: item.fontName, family: (tc.styles[item.fontName] || {}).fontFamily || 'sans-serif', start, end: text.length };
      runs.push(run);
      prev = run;
      if (item.hasEOL) text += '\n';
    }
    const words = [];
    for (const run of runs) {
      const re = /\S+/g;
      let mm;
      while ((mm = re.exec(run.str))) {
        words.push({ text: mm[0], start: run.start + mm.index, end: run.start + mm.index + mm[0].length, run, from: mm.index, to: mm.index + mm[0].length });
      }
    }
    return { runs, text, words, view: p.view, rotate: p.rotate };
  }

  /** Quads (one per run touched) covering text offsets [start, end) on a page geo. */
  function quadsForRange(geo, start, end) {
    const out = [];
    for (const run of geo.runs) {
      if (run.end <= start || run.start >= end) continue;
      const from = Math.max(0, start - run.start), to = Math.min(run.str.length, end - run.start);
      if (to > from) out.push(quadFor(run, from, to));
    }
    return out;
  }

  /**
   * Find matches of `query` (string or RegExp) in a page. Returns [{start, end, text, quads}].
   * String queries are case-insensitive and whitespace-tolerant.
   */
  function find(geo, query, { wholeWord = false, caseSensitive = false } = {}) {
    let re;
    if (query instanceof RegExp) re = new RegExp(query.source, query.flags.includes('g') ? query.flags : query.flags + 'g');
    else {
      const q = String(query).trim();
      if (!q) return [];
      const src = q.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
      re = new RegExp(wholeWord ? `\\b${src}\\b` : src, caseSensitive ? 'g' : 'gi');
    }
    const out = [];
    let m;
    while ((m = re.exec(geo.text))) {
      if (!m[0].length) { re.lastIndex++; continue; }
      out.push({ start: m.index, end: m.index + m[0].length, text: m[0], quads: quadsForRange(geo, m.index, m.index + m[0].length) });
      if (out.length > 5000) break;
    }
    return out;
  }

  /** Map a user-space quad to an axis-aligned viewport rectangle [left, top, width, height] in CSS px. */
  function quadToViewport(viewport, q) {
    const pts = [[q[0], q[1]], [q[2], q[3]], [q[4], q[5]], [q[6], q[7]]].map(([x, y]) => viewport.convertToViewportPoint(x, y));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const l = Math.min(...xs), t = Math.min(...ys);
    return [l, t, Math.max(...xs) - l, Math.max(...ys) - t];
  }

  /** Runs whose quads intersect a user-space rect [x1,y1,x2,y2]. */
  function runsInRect(geo, r) {
    return geo.runs.filter((run) => {
      const b = quadRect(quadFor(run));
      return b[0] < r[2] && b[2] > r[0] && b[1] < r[3] && b[3] > r[1];
    });
  }

  /** Group text runs into visual lines. */
  function lines(geo) {
    const out = [];
    let cur = null;
    for (const run of geo.runs) {
      const g = run.g;
      if (cur) {
        const lg = cur.g, last = cur.last.g;
        const sameDir = Math.abs(g.ux - lg.ux) < 0.02 && Math.abs(g.uy - lg.uy) < 0.02;
        const perp = (g.x - lg.x) * lg.vx + (g.y - lg.y) * lg.vy;
        const endAlong = (last.x + last.ux * last.width - lg.x) * lg.ux + (last.y + last.uy * last.width - lg.y) * lg.uy;
        const startAlong = (g.x - lg.x) * lg.ux + (g.y - lg.y) * lg.uy;
        if (sameDir && Math.abs(perp) < lg.size * 0.35 && Math.abs(g.size - lg.size) < lg.size * 0.3 && startAlong - endAlong < lg.size * 1.5 && startAlong > endAlong - lg.size) {
          cur.runs.push(run); cur.last = run; continue;
        }
      }
      if (!run.str.trim()) { cur = null; continue; }
      cur = { runs: [run], g, last: run };
      out.push(cur);
    }
    return out.map((ln, i) => {
      // trim trailing whitespace-only runs
      while (ln.runs.length > 1 && !ln.last.str.trim()) { ln.runs.pop(); ln.last = ln.runs[ln.runs.length - 1]; }
      const g = ln.g, last = ln.last.g;
      const width = (last.x + last.ux * last.width - g.x) * g.ux + (last.y + last.uy * last.width - g.y) * g.uy;
      const text = geo.text.slice(ln.runs[0].start, ln.last.end).replace(/\s*\n\s*/g, ' ');
      const quad = quadFor({ str: 'x', g: Object.assign({}, g, { width }) }, 0, 1);
      return { id: i, text, g, width, size: g.size, quad, rect: quadRect(quad), runs: ln.runs, fontName: ln.runs[0].fontName, family: ln.runs[0].family };
    }).filter((l) => l.text.trim());
  }

  /** Common regex presets for search-and-redact. */
  const PATTERNS = {
    email: { label: 'Email addresses', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
    phone: { label: 'Phone numbers', re: /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)|\d{2,4})[\s.-]?\d{3,4}[\s.-]?\d{3,4}/g },
    card: { label: 'Card numbers', re: /\b(?:\d[ -]?){13,19}\b/g },
    date: { label: 'Dates', re: /\b(?:\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/g },
    url: { label: 'Web addresses', re: /\bhttps?:\/\/[^\s]+|\bwww\.[^\s]+/g },
  };

  PS.textgeo = { page, find, lines, quadFor, offsets, quadRect, quadsForRange, quadToViewport, runsInRect, PATTERNS, ASC, DESC };
})(window);
