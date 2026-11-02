/**
 * PDF Studio — real PDF annotations (PS.annots)
 *
 * Writes standard PDF annotation objects (ISO 32000 §12.5) with pdf-lib's low-level API,
 * each with an appearance stream (/AP) so every viewer — Acrobat, Preview, Chrome,
 * Firefox — shows them identically, and they remain editable/deletable as comments.
 *
 * Supported item types (all coordinates in PDF user space):
 *   highlight | underline | strikeout  { quads:[[8 numbers]...], color, opacity, note }
 *   note      { x, y, text, color }                          -> /Text (sticky note) + /Popup
 *   ink       { paths:[[x,y,x,y,...]...], color, width, opacity }
 *   rect | ellipse { rect:[x1,y1,x2,y2], color, width, fill }  -> /Square, /Circle
 *   line | arrow   { p1:[x,y], p2:[x,y], color, width }       -> /Line (with /OpenArrow end)
 *   text      { rect, text, size, color }                      -> /FreeText (typewriter)
 */
(function (global) {
  'use strict';
  const PS = global.PS;
  const SUBTYPE = { highlight: 'Highlight', underline: 'Underline', strikeout: 'StrikeOut', note: 'Text', ink: 'Ink', rect: 'Square', ellipse: 'Circle', line: 'Line', arrow: 'Line', text: 'FreeText' };

  const n = (v) => (Math.round(v * 1000) / 1000).toString();
  const rgb = (c) => c.map(n).join(' ');

  function bounds(points, pad = 0) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (let i = 0; i < points.length; i += 2) {
      x1 = Math.min(x1, points[i]); x2 = Math.max(x2, points[i]);
      y1 = Math.min(y1, points[i + 1]); y2 = Math.max(y2, points[i + 1]);
    }
    return [x1 - pad, y1 - pad, x2 + pad, y2 + pad];
  }

  function arrowHead(p1, p2, w) {
    const len = Math.max(6, w * 4.5);
    const ang = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
    const a1 = ang + Math.PI - 0.45, a2 = ang + Math.PI + 0.45;
    return [[p2[0] + len * Math.cos(a1), p2[1] + len * Math.sin(a1)], [p2[0] + len * Math.cos(a2), p2[1] + len * Math.sin(a2)]];
  }

  /** Bézier ellipse path inside rect. */
  function ellipsePath(x1, y1, x2, y2) {
    const k = 0.5523;
    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, rx = (x2 - x1) / 2, ry = (y2 - y1) / 2;
    return `${n(cx + rx)} ${n(cy)} m ` +
      `${n(cx + rx)} ${n(cy + ry * k)} ${n(cx + rx * k)} ${n(cy + ry)} ${n(cx)} ${n(cy + ry)} c ` +
      `${n(cx - rx * k)} ${n(cy + ry)} ${n(cx - rx)} ${n(cy + ry * k)} ${n(cx - rx)} ${n(cy)} c ` +
      `${n(cx - rx)} ${n(cy - ry * k)} ${n(cx - rx * k)} ${n(cy - ry)} ${n(cx)} ${n(cy - ry)} c ` +
      `${n(cx + rx * k)} ${n(cy - ry)} ${n(cx + rx)} ${n(cy - ry * k)} ${n(cx + rx)} ${n(cy)} c`;
  }

  /** Smooth a polyline (quadratic midpoint scheme, emitted as cubic Béziers). */
  function inkPath(pts) {
    if (pts.length < 4) return '';
    let s = `${n(pts[0])} ${n(pts[1])} m `;
    if (pts.length <= 6) { for (let i = 2; i < pts.length; i += 2) s += `${n(pts[i])} ${n(pts[i + 1])} l `; return s; }
    let cx = pts[0], cy = pts[1];
    for (let i = 2; i < pts.length - 2; i += 2) {
      const qx = pts[i], qy = pts[i + 1];
      const mx = (qx + pts[i + 2]) / 2, my = (qy + pts[i + 3]) / 2;
      s += `${n(cx + (2 / 3) * (qx - cx))} ${n(cy + (2 / 3) * (qy - cy))} ${n(mx + (2 / 3) * (qx - mx))} ${n(my + (2 / 3) * (qy - my))} ${n(mx)} ${n(my)} c `;
      cx = mx; cy = my;
    }
    s += `${n(pts[pts.length - 2])} ${n(pts[pts.length - 1])} l `;
    return s;
  }

  /**
   * Add annotations to one page.
   * opts: { author }
   * Returns the number of annotation objects written.
   */
  async function write(doc, pageIndex, items, opts = {}) {
    const L = global.PDFLib;
    const ctx = doc.context;
    const page = doc.getPage(pageIndex);
    const now = L.PDFString.fromDate(new Date());
    const author = L.PDFHexString.fromText(opts.author || 'PDF Studio');
    let helv = null;
    let count = 0;

    function gs(opacity, blend) {
      const d = { Type: 'ExtGState', CA: opacity, ca: opacity };
      if (blend) d.BM = blend;
      return { ExtGState: { GS0: ctx.obj(d) } };
    }
    function ap(ops, bbox, resources) {
      const stream = ctx.stream(ops, { Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: bbox, Matrix: [1, 0, 0, 1, 0, 0], Resources: resources || {} });
      return ctx.register(stream);
    }
    function add(dict, apRef) {
      const base = {
        Type: 'Annot', F: 4, P: page.ref, M: now, T: author,
        NM: L.PDFHexString.fromText(PS.util.uid('annot')),
      };
      const obj = ctx.obj(Object.assign(base, dict));
      if (apRef) obj.set(L.PDFName.of('AP'), ctx.obj({ N: apRef }));
      const ref = ctx.register(obj);
      page.node.addAnnot(ref);
      count++;
      return { ref, obj };
    }
    const contents = (t) => (t ? { Contents: L.PDFHexString.fromText(String(t)) } : {});

    for (const it of items) {
      const color = it.color || [1, 0.85, 0];
      const op = it.opacity != null ? it.opacity : 1;
      const w = it.width || 2;
      switch (it.type) {
        case 'highlight': case 'underline': case 'strikeout': {
          const qp = [].concat(...it.quads);
          const rect = bounds(qp, 1);
          let ops = '';
          if (it.type === 'highlight') {
            ops = `/GS0 gs ${rgb(color)} rg `;
            for (const q of it.quads) ops += `${n(q[0])} ${n(q[1])} m ${n(q[2])} ${n(q[3])} l ${n(q[6])} ${n(q[7])} l ${n(q[4])} ${n(q[5])} l h f `;
          } else {
            ops = `/GS0 gs ${rgb(color)} RG `;
            for (const q of it.quads) {
              const hgt = Math.hypot(q[0] - q[4], q[1] - q[5]);
              const t = it.type === 'underline' ? 0.14 : 0.48; // fraction up from the bottom edge
              const lw = Math.max(0.6, hgt * 0.07);
              const ax = q[4] + (q[0] - q[4]) * t, ay = q[5] + (q[1] - q[5]) * t;
              const bx = q[6] + (q[2] - q[6]) * t, by = q[7] + (q[3] - q[7]) * t;
              ops += `${n(lw)} w ${n(ax)} ${n(ay)} m ${n(bx)} ${n(by)} l S `;
            }
          }
          const apRef = ap(ops, rect, gs(op, it.type === 'highlight' ? 'Multiply' : null));
          add(Object.assign({ Subtype: SUBTYPE[it.type], Rect: rect, QuadPoints: qp, C: color, CA: op }, contents(it.note)), apRef);
          break;
        }
        case 'note': {
          const S = 22;
          const rect = [it.x, it.y - S, it.x + S, it.y];
          const [x, y] = [rect[0], rect[1]];
          const ops = `${rgb(color)} rg 0.35 0.3 0.1 RG 1 w ${n(x + 1)} ${n(y + 5)} ${S - 2} ${S - 6} re B ` +
            `${n(x + 6)} ${n(y + 5)} m ${n(x + 5)} ${n(y + 1)} l ${n(x + 11)} ${n(y + 5)} l h B ` +
            `0.35 0.3 0.1 RG 1.2 w ${n(x + 5)} ${n(y + 16)} m ${n(x + 17)} ${n(y + 16)} l S ${n(x + 5)} ${n(y + 12.5)} m ${n(x + 17)} ${n(y + 12.5)} l S ${n(x + 5)} ${n(y + 9)} m ${n(x + 13)} ${n(y + 9)} l S`;
          const apRef = ap(ops, rect);
          const { ref } = add(Object.assign({ Subtype: 'Text', Rect: rect, C: color, Name: 'Comment', Open: false, F: 28 }, contents(it.text)), apRef);
          const pop = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Popup', Rect: [it.x + S, it.y - 120, it.x + S + 200, it.y], Parent: ref, Open: false, F: 28, P: page.ref }));
          page.node.addAnnot(pop);
          ctx.lookup(ref).set(L.PDFName.of('Popup'), pop);
          break;
        }
        case 'ink': {
          const all = [].concat(...it.paths);
          const rect = bounds(all, w);
          let ops = `/GS0 gs ${rgb(color)} RG ${n(w)} w 1 J 1 j `;
          for (const p of it.paths) ops += inkPath(p) + 'S ';
          const apRef = ap(ops, rect, gs(op));
          add(Object.assign({ Subtype: 'Ink', Rect: rect, InkList: it.paths, C: color, CA: op, BS: { W: w, S: 'S' } }, contents(it.note)), apRef);
          break;
        }
        case 'rect': case 'ellipse': {
          const [x1, y1, x2, y2] = it.rect;
          const rect = [x1 - w, y1 - w, x2 + w, y2 + w];
          const path = it.type === 'rect' ? `${n(x1)} ${n(y1)} ${n(x2 - x1)} ${n(y2 - y1)} re` : ellipsePath(x1, y1, x2, y2);
          const fill = it.fill ? `${rgb(it.fill)} rg ` : '';
          const ops = `/GS0 gs ${rgb(color)} RG ${fill}${n(w)} w ${path} ${it.fill ? 'B' : 'S'}`;
          const apRef = ap(ops, rect, gs(op));
          const d = { Subtype: SUBTYPE[it.type], Rect: rect, C: color, CA: op, BS: { W: w, S: 'S' }, RD: [w, w, w, w] };
          if (it.fill) d.IC = it.fill;
          add(Object.assign(d, contents(it.note)), apRef);
          break;
        }
        case 'line': case 'arrow': {
          const { p1, p2 } = it;
          const pts = [p1[0], p1[1], p2[0], p2[1]];
          let ops = `/GS0 gs ${rgb(color)} RG ${n(w)} w 1 J 1 j ${n(p1[0])} ${n(p1[1])} m ${n(p2[0])} ${n(p2[1])} l S `;
          if (it.type === 'arrow') {
            const [a, b] = arrowHead(p1, p2, w);
            pts.push(a[0], a[1], b[0], b[1]);
            ops += `${n(a[0])} ${n(a[1])} m ${n(p2[0])} ${n(p2[1])} l ${n(b[0])} ${n(b[1])} l S`;
          }
          const rect = bounds(pts, w * 2);
          const apRef = ap(ops, rect, gs(op));
          add(Object.assign({ Subtype: 'Line', Rect: rect, L: [p1[0], p1[1], p2[0], p2[1]], C: color, CA: op, BS: { W: w, S: 'S' }, LE: ['None', it.type === 'arrow' ? 'OpenArrow' : 'None'] }, contents(it.note)), apRef);
          break;
        }
        case 'text': {
          if (!helv) helv = await doc.embedFont(L.StandardFonts.Helvetica);
          const size = it.size || 12;
          const [x1, y1, x2, y2] = it.rect;
          const lines = String(it.text || '').split(/\r?\n/);
          let ops = `/Tx BMC q BT /Helv ${n(size)} Tf ${rgb(color)} rg `;
          lines.forEach((line, i) => {
            const enc = helv.encodeText(sanitize(line, helv)).toString();
            ops += `1 0 0 1 ${n(x1 + 2)} ${n(y2 - 2 - size * 0.9 - i * size * 1.2)} Tm ${enc} Tj `;
          });
          ops += 'ET Q EMC';
          const apRef = ap(ops, [x1, y1, x2, y2], { Font: { Helv: helv.ref } });
          add({ Subtype: 'FreeText', Rect: [x1, y1, x2, y2], Contents: L.PDFHexString.fromText(it.text || ''), DA: L.PDFString.of(`/Helv ${n(size)} Tf ${rgb(color)} rg`), C: [], BS: { W: 0 } }, apRef);
          break;
        }
        default: break;
      }
    }
    return count;
  }

  /** Replace characters the standard font can't encode. */
  function sanitize(text, font) {
    let out = '';
    for (const ch of String(text)) {
      try { font.encodeText(ch); out += ch; } catch (_) { out += '?'; }
    }
    return out;
  }

  PS.annots = { write, sanitize, SUBTYPE };
})(window);
