/**
 * Tool: Comment & markup
 * Highlight, underline and strike out text, add sticky notes and text boxes, draw freehand,
 * rectangles, ellipses and arrows. Everything is saved as standard PDF annotations, so the
 * comments stay editable in Acrobat, Preview, Chrome and other viewers.
 */
(function (global) {
  'use strict';
  const PS = global.PS;
  const { h, icon, baseName, plural, hexToRgb01 } = PS.util;
  const ui = PS.ui;
  const TG = () => PS.textgeo;

  const TOOLS = [
    ['select', 'Select', 'pointer'], ['highlight', 'Highlight', 'highlighter'], ['underline', 'Underline', 'underline'], ['strikeout', 'Strike', 'strike'],
    ['note', 'Note', 'message'], ['text', 'Text box', 'type'], ['ink', 'Draw', 'pencil'], ['rect', 'Rectangle', 'square'],
    ['ellipse', 'Ellipse', 'circle'], ['arrow', 'Arrow', 'arrow'],
  ];
  const COLORS = [['#ffd400', 'Yellow'], ['#5fd35f', 'Green'], ['#4aa8ff', 'Blue'], ['#ff6fa8', 'Pink'], ['#e5383b', 'Red'], ['#111111', 'Black']];
  const DEFAULT_COLOR = { highlight: '#ffd400', underline: '#4aa8ff', strikeout: '#e5383b', note: '#ffd400', text: '#111111', ink: '#e5383b', rect: '#e5383b', ellipse: '#e5383b', arrow: '#e5383b' };
  const LABEL = { highlight: 'Highlight', underline: 'Underline', strikeout: 'Strike-out', note: 'Sticky note', text: 'Text box', ink: 'Drawing', rect: 'Rectangle', ellipse: 'Ellipse', arrow: 'Arrow' };

  /** Character offset in a page's text nearest to user-space point (x, y), or -1. */
  function hitOffset(geo, x, y) {
    let best = -1, bestD = Infinity;
    for (const run of geo.runs) {
      const g = run.g;
      const along = (x - g.x) * g.ux + (y - g.y) * g.uy;
      const perp = (x - g.x) * g.vx + (y - g.y) * g.vy;
      const mid = g.size * (TG().ASC - TG().DESC) / 2;
      const dPerp = Math.max(0, Math.abs(perp - mid) - g.size * 0.6);
      const dAlong = along < 0 ? -along : along > g.width ? along - g.width : 0;
      const d = dPerp * 3 + dAlong;
      if (d < bestD) {
        bestD = d;
        const frac = Math.max(0, Math.min(1, along / (g.width || 1)));
        best = run.start + Math.round(frac * run.str.length);
      }
    }
    return bestD < 40 ? best : -1;
  }

  PS.tools.register({
    id: 'comment',
    name: 'Comment & markup',
    category: 'review',
    icon: 'message',
    isNew: true,
    description: 'Highlight text, add sticky notes, text boxes, drawings and shapes.',
    longDescription: 'Review a PDF like in Acrobat: highlight, underline and strike out text, add sticky notes and text boxes, draw freehand, and add rectangles, ellipses and arrows. Saved as real PDF comments that other apps can read and edit.',
    keywords: ['annotate', 'annotation', 'highlight', 'underline', 'strikethrough', 'sticky note', 'comment', 'markup', 'draw', 'ink', 'shapes', 'arrow', 'review'],
    mount(root) {
      return PS.kit.pdfTool(root, {
        dropTitle: 'Choose a PDF to comment on',
        async onLoad(handle, view) {
          view.workspace.parentElement.classList.add('viewer-tool');
          const items = [];          // pending annotations {id, type, page, ...geometry in user space}
          let tool = 'select';
          const viewer = PS.viewer.create(handle, {});
          view.workspace.insertBefore(viewer.el, view.result);

          /* ---------------- options */
          const palette = h('div', { class: 'tool-palette', role: 'toolbar', 'aria-label': 'Comment tools' });
          TOOLS.forEach(([id, label, ic]) => palette.append(h('button', { type: 'button', 'data-tool': id, 'aria-pressed': String(id === tool), title: label, onclick: () => setTool(id) }, icon(ic), label)));
          const colors = ui.swatches(COLORS, DEFAULT_COLOR.highlight, 'Comment colour');
          const width = ui.range({ min: 1, max: 12, value: 2, format: (v) => v + ' pt', label: 'Line width' });
          const opacity = ui.range({ min: 10, max: 100, value: 100, step: 5, format: (v) => v + '%', label: 'Opacity' });
          const fontSize = ui.range({ min: 8, max: 36, value: 12, format: (v) => v + ' pt', label: 'Text size' });
          const author = h('input', { type: 'text', value: localStorage.getItem('ps-author') || '', placeholder: 'Your name (optional)', 'aria-label': 'Author name' });
          author.addEventListener('change', () => { try { localStorage.setItem('ps-author', author.value.trim()); } catch (_) { /* private mode */ } });
          const hint = h('p', { class: 'kbd-hint' });
          const widthField = ui.field('Line width', width);
          const sizeField = ui.field('Text size', fontSize);
          const list = h('ul', { class: 'item-list', 'aria-live': 'polite' });
          const btnUndo = h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: undo }, icon('undo', 'icon-sm'), 'Undo');
          const btnClear = h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => { items.length = 0; changed(); } }, icon('trash', 'icon-sm'), 'Clear');
          const save = view.actionButton('Save comments', 'download', run);
          view.options.append(
            PS.kit.panel('Tools', palette, hint),
            PS.kit.panel('Style', ui.field('Colour', colors.el), widthField, ui.field('Opacity', opacity), sizeField),
            PS.kit.panel('Comments', list, h('div', { class: 'btn-row', style: { marginTop: '10px' } }, btnUndo, btnClear),
              ui.field('Author', author, 'Shown as the comment author in other PDF apps.'), h('div', { style: { marginTop: '14px' } }, save)));

          const HINTS = {
            select: 'Select and copy text, or scroll and zoom. Pick a tool to start commenting.',
            highlight: 'Drag across text to highlight it.', underline: 'Drag across text to underline it.', strikeout: 'Drag across text to strike it out.',
            note: 'Click where the note should go.', text: 'Click (or drag a box) where the text should go.', ink: 'Draw with the mouse, pen or finger.',
            rect: 'Drag to draw a rectangle.', ellipse: 'Drag to draw an ellipse.', arrow: 'Drag from the tail to the tip of the arrow.',
          };
          function setTool(id) {
            tool = id;
            palette.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === id)));
            viewer.setInteractive(id !== 'select', ['highlight', 'underline', 'strikeout'].includes(id) ? 'text' : 'crosshair');
            if (DEFAULT_COLOR[id]) colorsSet(DEFAULT_COLOR[id]);
            widthField.hidden = !['ink', 'rect', 'ellipse', 'arrow'].includes(id);
            sizeField.hidden = id !== 'text';
            hint.textContent = HINTS[id];
          }
          function colorsSet(hex) { const b = [...colors.el.children].find((x) => x.title === COLORS.find((c) => c[0] === hex)?.[1]); if (b) b.click(); }

          /* ---------------- drawing pending items */
          const svgs = new Map();
          function svgFor(pv) {
            let s = svgs.get(pv.num);
            if (!s || s.parentNode !== pv.overlay) {
              s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
              s.setAttribute('class', 'svg-layer');
              pv.overlay.prepend(s);
              svgs.set(pv.num, s);
              bindPage(pv);
            }
            return s;
          }
          const NS = 'http://www.w3.org/2000/svg';
          function el(tag, attrs) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }
          function drawItem(svg, pv, it, preview) {
            const P = (x, y) => pv.toPx(x, y);
            const col = it.color, op = it.opacity;
            const g = el('g', { opacity: String(op), 'data-id': it.id || '' });
            if (it.type === 'highlight' || it.type === 'underline' || it.type === 'strikeout') {
              for (const q of it.quads) {
                const pts = [P(q[0], q[1]), P(q[2], q[3]), P(q[6], q[7]), P(q[4], q[5])];
                if (it.type === 'highlight') g.append(el('polygon', { points: pts.map((p) => p.join(',')).join(' '), fill: col, style: 'mix-blend-mode:multiply' }));
                else {
                  const t = it.type === 'underline' ? 0.14 : 0.48;
                  const a = [pts[3][0] + (pts[0][0] - pts[3][0]) * t, pts[3][1] + (pts[0][1] - pts[3][1]) * t];
                  const b = [pts[2][0] + (pts[1][0] - pts[2][0]) * t, pts[2][1] + (pts[1][1] - pts[2][1]) * t];
                  const hh = Math.hypot(pts[0][0] - pts[3][0], pts[0][1] - pts[3][1]);
                  g.append(el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: col, 'stroke-width': Math.max(1, hh * 0.07) }));
                }
              }
            } else if (it.type === 'note') {
              const [x, y] = P(it.x, it.y); const s = 22 * pv.scale;
              g.append(el('rect', { x, y, width: s, height: s * 0.8, rx: 2, fill: col, stroke: '#5a4a1a' }), el('path', { d: `M${x + s * .25} ${y + s * .3}h${s * .5}M${x + s * .25} ${y + s * .5}h${s * .4}`, stroke: '#5a4a1a', 'stroke-width': 1.4 }));
            } else if (it.type === 'ink') {
              for (const p of it.paths) {
                let d = '';
                for (let i = 0; i < p.length; i += 2) { const [x, y] = P(p[i], p[i + 1]); d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1); }
                g.append(el('path', { d, fill: 'none', stroke: col, 'stroke-width': it.width * pv.scale, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
              }
            } else if (it.type === 'rect' || it.type === 'ellipse') {
              const r = pv.rectToPx(it.rect);
              const attrs = { fill: 'none', stroke: col, 'stroke-width': it.width * pv.scale };
              if (it.type === 'rect') g.append(el('rect', Object.assign({ x: r.left, y: r.top, width: r.width, height: r.height }, attrs)));
              else g.append(el('ellipse', Object.assign({ cx: r.left + r.width / 2, cy: r.top + r.height / 2, rx: r.width / 2, ry: r.height / 2 }, attrs)));
            } else if (it.type === 'arrow') {
              const a = P(...it.p1), b = P(...it.p2);
              const w = it.width * pv.scale, len = Math.max(6, it.width * 4.5) * pv.scale;
              const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
              const h1 = [b[0] - len * Math.cos(ang - 0.45), b[1] - len * Math.sin(ang - 0.45)], h2 = [b[0] - len * Math.cos(ang + 0.45), b[1] - len * Math.sin(ang + 0.45)];
              g.append(el('path', { d: `M${a.join(' ')}L${b.join(' ')}M${h1.join(' ')}L${b.join(' ')}L${h2.join(' ')}`, fill: 'none', stroke: col, 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
            } else if (it.type === 'text') {
              const r = pv.rectToPx(it.rect);
              g.append(el('rect', { x: r.left, y: r.top, width: r.width, height: r.height, fill: 'none', stroke: preview ? '#2f5bea' : 'rgba(47,91,234,.35)', 'stroke-dasharray': '4 3' }));
              String(it.text).split(/\n/).forEach((line, i) => {
                const t = el('text', { x: r.left + 2 * pv.scale, y: r.top + (2 + it.size * 0.9 + i * it.size * 1.2) * pv.scale, fill: col, 'font-size': it.size * pv.scale, 'font-family': 'Helvetica, Arial, sans-serif' });
                t.textContent = line; g.append(t);
              });
            }
            svg.append(g);
            return g;
          }
          function paint(pv) {
            if (!pv.viewport) return;
            const svg = svgFor(pv);
            svg.replaceChildren();
            items.filter((it) => it.page === pv.num).forEach((it) => drawItem(svg, pv, it));
          }
          viewer.onPage(paint);

          function changed() {
            viewer.pages.forEach(paint);
            list.replaceChildren(...(items.length ? items.map((it) => h('li', null,
              h('span', { class: 'swatch', style: { background: it.color, width: '14px', height: '14px', flex: 'none' }, 'aria-hidden': 'true' }),
              h('button', { class: 'link grow', type: 'button', onclick: () => viewer.goTo(it.page) }, LABEL[it.type] + (it.text ? ` — ${it.text}` : it.snippet ? ` — “${it.snippet}”` : '')),
              h('span', { class: 'muted' }, 'p. ' + it.page),
              h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Remove ' + LABEL[it.type], onclick: () => { items.splice(items.indexOf(it), 1); changed(); } }, icon('x', 'icon-sm'))))
              : [h('li', null, h('span', { class: 'muted' }, 'No comments yet.'))]));
            save.disabled = !items.length;
            btnUndo.disabled = btnClear.disabled = !items.length;
          }
          function undo() { if (items.length) { items.pop(); changed(); } }
          function push(it) { it.id = PS.util.uid('c'); items.push(it); changed(); }
          const style = () => ({ color: colors.value, opacity: +opacity.input.value / 100, rgb: hexToRgb01(colors.value) });

          /* ---------------- interaction */
          function bindPage(pv) {
            pv.overlay.addEventListener('pointerdown', (e) => onDown(e, pv));
          }
          async function onDown(e, pv) {
            if (tool === 'select' || e.button !== 0 || e.target.closest('.annot')) return;
            e.preventDefault();
            const svg = svgFor(pv);
            const p0 = pv.toPdf(...pv.eventPoint(e));
            const st = style();
            let temp = null;
            const redraw = (it) => { if (temp) temp.remove(); temp = it ? drawItem(svg, pv, it, true) : null; };
            pv.overlay.setPointerCapture(e.pointerId);
            let finish;
            if (['highlight', 'underline', 'strikeout'].includes(tool)) {
              const geo = await TG().page(handle.pdfjs, pv.num);
              if (!geo.runs.length) { ui.toast('This page has no selectable text. Run “OCR” first, or use a rectangle instead.', 'warning'); return; }
              const a = hitOffset(geo, p0[0], p0[1]);
              let range = null;
              const type = tool;
              const update = (pt) => {
                const b = hitOffset(geo, pt[0], pt[1]);
                if (a < 0 || b < 0) { range = null; redraw(null); return; }
                let s = Math.min(a, b), en = Math.max(a, b);
                while (s < en && /\s/.test(geo.text[s])) s++;
                while (en > s && /\s/.test(geo.text[en - 1])) en--;
                if (en <= s) { range = null; redraw(null); return; }
                range = [s, en];
                redraw({ type, quads: TG().quadsForRange(geo, s, en), color: st.color, opacity: type === 'highlight' ? Math.min(st.opacity, 0.55) : st.opacity });
              };
              finish = (pt) => {
                update(pt); redraw(null);
                if (!range) return;
                const snippet = geo.text.slice(range[0], range[1]).replace(/\s+/g, ' ');
                push({ type, page: pv.num, quads: TG().quadsForRange(geo, range[0], range[1]), color: st.color, opacity: type === 'highlight' ? Math.min(st.opacity, 0.55) : st.opacity, snippet: snippet.length > 40 ? snippet.slice(0, 40) + '…' : snippet });
              };
              moveTo(update);
            } else if (tool === 'ink') {
              const path = [p0[0], p0[1]];
              const it = { type: 'ink', paths: [path], color: st.color, opacity: st.opacity, width: +width.input.value };
              moveTo((pt) => { const lx = path[path.length - 2], ly = path[path.length - 1]; if (Math.hypot(pt[0] - lx, pt[1] - ly) * pv.scale > 1.5) { path.push(pt[0], pt[1]); redraw(it); } });
              finish = () => { redraw(null); if (path.length >= 4) push(Object.assign(it, { page: pv.num })); };
            } else if (tool === 'rect' || tool === 'ellipse' || tool === 'arrow') {
              const type = tool;
              let p1 = p0;
              const make = () => (type === 'arrow' ? { type, p1: p0, p2: p1 } : { type, rect: [Math.min(p0[0], p1[0]), Math.min(p0[1], p1[1]), Math.max(p0[0], p1[0]), Math.max(p0[1], p1[1])] });
              moveTo((pt) => { p1 = pt; redraw(Object.assign(make(), { color: st.color, opacity: st.opacity, width: +width.input.value })); });
              finish = () => {
                redraw(null);
                if (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) * pv.scale < 6) return;
                push(Object.assign(make(), { page: pv.num, color: st.color, opacity: st.opacity, width: +width.input.value }));
              };
            } else if (tool === 'note' || tool === 'text') {
              let p1 = p0;
              moveTo((pt) => { p1 = pt; });
              finish = async () => {
                const type = tool;
                const text = await ui.prompt({ title: type === 'note' ? 'Sticky note' : 'Text box', label: type === 'note' ? 'Note' : 'Text', multiline: true, okLabel: 'Add', placeholder: type === 'note' ? 'Write your comment…' : 'Type your text…' });
                if (!text || !text.trim()) return;
                if (type === 'note') { push({ type, page: pv.num, x: p0[0], y: p0[1], text: text.trim(), color: st.color, opacity: 1 }); return; }
                const size = +fontSize.input.value;
                const lines = text.split(/\n/);
                let rect;
                const dragged = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) * pv.scale > 12;
                if (dragged) rect = [Math.min(p0[0], p1[0]), Math.min(p0[1], p1[1]), Math.max(p0[0], p1[0]), Math.max(p0[1], p1[1])];
                else {
                  const w = Math.max(...lines.map((l) => l.length)) * size * 0.55 + 8, hh = lines.length * size * 1.2 + 6;
                  // anchor at click as top-left in display; convert via px
                  const [px, py] = pv.toPx(p0[0], p0[1]);
                  rect = pv.pxToRect(px, py, w * pv.scale, hh * pv.scale);
                }
                push({ type, page: pv.num, rect, text, size, color: st.color, opacity: 1 });
              };
            }
            function moveTo(fn) {
              const mv = (ev) => fn(pv.toPdf(...pv.eventPoint(ev)));
              const upFn = (ev) => {
                pv.overlay.removeEventListener('pointermove', mv);
                pv.overlay.removeEventListener('pointerup', upFn);
                pv.overlay.removeEventListener('pointercancel', upFn);
                finish(pv.toPdf(...pv.eventPoint(ev)));
              };
              pv.overlay.addEventListener('pointermove', mv);
              pv.overlay.addEventListener('pointerup', upFn);
              pv.overlay.addEventListener('pointercancel', upFn);
            }
          }

          const onKey = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); undo(); }
            if (e.key === 'Escape' && tool !== 'select' && !document.querySelector('.modal')) setTool('select');
          };
          document.addEventListener('keydown', onKey);

          async function run() {
            if (!items.length) return;
            const blob = await ui.run('Saving comments…', async () => {
              const doc = await PS.engine.loadPdfLib(handle.bytes);
              const byPage = new Map();
              items.forEach((it) => { if (!byPage.has(it.page)) byPage.set(it.page, []); byPage.get(it.page).push(Object.assign({}, it, { color: hexToRgb01(it.color), note: it.type === 'text' || it.type === 'note' ? undefined : undefined })); });
              let n = 0;
              for (const [p, list2] of byPage) n += await PS.annots.write(doc, p - 1, list2, { author: author.value.trim() || 'PDF Studio' });
              return { blob: await PS.engine.saveToBlob(doc), n };
            }, 'comment');
            if (blob) ui.showResult(view.result, { blob: blob.blob, filename: `${baseName(handle.name)}_commented.pdf`, detail: `${plural(items.length, 'comment')} saved as PDF annotations` });
          }

          setTool('select');
          changed();
          return () => { document.removeEventListener('keydown', onKey); viewer.destroy(); };
        },
      });
    },
  });
})(window);
