/**
 * PDF Studio — movable / resizable page objects on top of a viewer (PS.objects)
 *
 * Shared by Edit PDF (text boxes, images, white-out), Prepare form (fields) and Redact (boxes).
 * Objects are stored in PDF user space ({ id, page, rect:[x1,y1,x2,y2] }) so they stay put
 * when zooming and map 1:1 to what gets written into the PDF — on rotated pages too.
 *
 * create(viewer, { render(obj, el), onChange(list), onSelect(obj|null), label(obj) })
 *   .add(obj) .update(obj) .remove(id) .clear() .list() .select(id) .selected
 *   .setCreate({ cursor, minPx, defaultSize:[w,h] (pt), make(page, rect) -> obj|null } | null)
 */
(function (global) {
  'use strict';
  const PS = global.PS;
  const { h, icon, clamp, uid } = PS.util;

  function create(viewer, opts = {}) {
    const objs = new Map();
    const els = new Map();
    let selectedId = null;
    let creator = null;
    const layers = new Map(); // page -> layer div

    function layerFor(pv) {
      let l = layers.get(pv.num);
      if (!l || l.parentNode !== pv.overlay) {
        l = h('div', { class: 'obj-layer' });
        pv.overlay.append(l);
        layers.set(pv.num, l);
        bindCreate(pv, l);
      }
      return l;
    }

    function place(obj) {
      const pv = viewer.pages[obj.page - 1];
      if (!pv || !pv.viewport) return;
      let el = els.get(obj.id);
      if (!el) el = makeEl(obj);
      const layer = layerFor(pv);
      if (el.parentNode !== layer) layer.append(el);
      const r = pv.rectToPx(obj.rect);
      Object.assign(el.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
      el.style.setProperty('--obj-scale', String(pv.scale));
      if (opts.render) opts.render(obj, el.querySelector('.obj-body'), pv);
    }

    function makeEl(obj) {
      const body = h('div', { class: 'obj-body' });
      const del = h('button', { class: 'annot-del', type: 'button', 'aria-label': 'Delete', title: 'Delete', onclick: (e) => { e.stopPropagation(); remove(obj.id); } }, icon('x'));
      const handle = h('span', { class: 'handle', 'aria-hidden': 'true' });
      const el = h('div', { class: 'annot obj ' + (obj.cls || '') + (obj.locked ? ' is-locked' : ''), tabindex: '0', role: 'button', 'aria-label': (opts.label ? opts.label(obj) : 'Object') + ' — arrow keys move, Delete removes' }, body, handle, del);
      els.set(obj.id, el);
      bindDrag(el, handle, obj.id);
      el.addEventListener('keydown', (e) => onKey(e, obj.id));
      el.addEventListener('focus', () => select(obj.id));
      if (opts.onDblClick) el.addEventListener('dblclick', (e) => { e.stopPropagation(); opts.onDblClick(objs.get(obj.id)); });
      return el;
    }

    function bindDrag(el, handle, id) {
      el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || e.target.closest('.annot-del') || e.target.closest('[contenteditable="true"], input, textarea, select')) return;
        e.preventDefault(); e.stopPropagation();
        select(id);
        const obj = objs.get(id);
        if (obj.locked) { el.focus({ preventScroll: true }); return; }
        const pv = viewer.pages[obj.page - 1];
        const resizing = e.target === handle;
        const start = pv.eventPoint(e);
        const r0 = pv.rectToPx(obj.rect);
        const W = pv.el.clientWidth, H = pv.el.clientHeight;
        const aspect = r0.width / (r0.height || 1);
        el.setPointerCapture(e.pointerId);
        let moved = false;
        function move(ev) {
          const p = pv.eventPoint(ev);
          const dx = p[0] - start[0], dy = p[1] - start[1];
          if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
          let { left, top, width, height } = r0;
          if (resizing) {
            width = clamp(r0.width + dx, 8, W - left);
            height = obj.keepAspect ? width / aspect : clamp(r0.height + dy, 8, H - top);
            if (top + height > H) { height = H - top; if (obj.keepAspect) width = height * aspect; }
          } else {
            left = clamp(r0.left + dx, 0, W - width);
            top = clamp(r0.top + dy, 0, H - height);
          }
          Object.assign(el.style, { left: left + 'px', top: top + 'px', width: width + 'px', height: height + 'px' });
          obj.rect = pv.pxToRect(left, top, width, height);
          if (resizing && opts.render) opts.render(obj, el.querySelector('.obj-body'), pv);
        }
        function up() {
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
          el.removeEventListener('pointercancel', up);
          if (moved) changed();
        }
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
      });
    }

    function onKey(e, id) {
      const obj = objs.get(id);
      if (!obj || e.target !== els.get(id)) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(id); return; }
      if (obj.locked) return;
      const d = e.shiftKey ? 10 : 1;
      const mv = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[e.key];
      if (!mv) return;
      e.preventDefault();
      const pv = viewer.pages[obj.page - 1];
      const r = pv.rectToPx(obj.rect);
      const left = clamp(r.left + mv[0], 0, pv.el.clientWidth - r.width);
      const top = clamp(r.top + mv[1], 0, pv.el.clientHeight - r.height);
      obj.rect = pv.pxToRect(left, top, r.width, r.height);
      place(obj); changed();
    }

    function bindCreate(pv, layer) {
      pv.overlay.addEventListener('pointerdown', (e) => {
        if (!creator || e.button !== 0 || e.target.closest('.obj')) return;
        e.preventDefault();
        select(null);
        const start = pv.eventPoint(e);
        const band = h('div', { class: 'obj-band' });
        layer.append(band);
        pv.overlay.setPointerCapture(e.pointerId);
        let cur = start;
        function move(ev) {
          cur = pv.eventPoint(ev);
          const l = Math.min(start[0], cur[0]), t = Math.min(start[1], cur[1]);
          Object.assign(band.style, { left: l + 'px', top: t + 'px', width: Math.abs(cur[0] - start[0]) + 'px', height: Math.abs(cur[1] - start[1]) + 'px' });
        }
        function up() {
          pv.overlay.removeEventListener('pointermove', move);
          pv.overlay.removeEventListener('pointerup', up);
          pv.overlay.removeEventListener('pointercancel', up);
          band.remove();
          let l = Math.min(start[0], cur[0]), t = Math.min(start[1], cur[1]);
          let w = Math.abs(cur[0] - start[0]), hh = Math.abs(cur[1] - start[1]);
          if (w < (creator.minPx || 6) || hh < (creator.minPx || 6)) {
            if (!creator.defaultSize) return;
            w = creator.defaultSize[0] * pv.scale; hh = creator.defaultSize[1] * pv.scale;
            l = clamp(start[0], 0, pv.el.clientWidth - w); t = clamp(start[1] - hh / 2, 0, pv.el.clientHeight - hh);
          }
          const obj = creator.make(pv.num, pv.pxToRect(l, t, w, hh), pv);
          if (obj) { add(obj); select(obj.id); const el = els.get(obj.id); if (el && !creator.noFocus) el.focus({ preventScroll: true }); }
        }
        pv.overlay.addEventListener('pointermove', move);
        pv.overlay.addEventListener('pointerup', up);
        pv.overlay.addEventListener('pointercancel', up);
      });
    }

    function add(obj) {
      if (!obj.id) obj.id = uid('obj');
      objs.set(obj.id, obj);
      place(obj);
      changed();
      return obj;
    }
    function update(obj) { if (objs.has(obj.id)) { objs.set(obj.id, obj); place(obj); changed(); } }
    function remove(id) {
      const el = els.get(id);
      if (el) el.remove();
      els.delete(id); objs.delete(id);
      if (selectedId === id) { selectedId = null; if (opts.onSelect) opts.onSelect(null); }
      changed();
    }
    function clear() { [...objs.keys()].forEach((id) => { const el = els.get(id); if (el) el.remove(); }); objs.clear(); els.clear(); selectedId = null; changed(); }
    function select(id) {
      if (selectedId === id) return;
      selectedId = id;
      els.forEach((el, k) => el.classList.toggle('is-selected', k === id));
      if (opts.onSelect) opts.onSelect(id ? objs.get(id) : null);
    }
    function changed() { if (opts.onChange) opts.onChange(list()); }
    function list() { return [...objs.values()]; }

    viewer.onPage((pv) => { layerFor(pv); objs.forEach((o) => { if (o.page === pv.num) place(o); }); });

    return {
      add, update, remove, clear, list, select,
      get selected() { return selectedId ? objs.get(selectedId) : null; },
      element(id) { return els.get(id); },
      setCreate(c) { creator = c; viewer.setInteractive(true, c ? (c.cursor || 'crosshair') : 'default'); },
      refresh(obj) { place(obj); },
    };
  }

  PS.objects = { create };
})(window);
