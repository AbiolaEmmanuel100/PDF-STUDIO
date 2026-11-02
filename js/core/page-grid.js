/**
 * PDF Studio — thumbnail page grid (PS.pageGrid)
 *
 * A keyboard-accessible, multi-select listbox of page thumbnails with optional
 * drag-to-reorder and per-page actions (rotate / duplicate / delete).
 * Thumbnails are rendered lazily (IntersectionObserver) through the engine's
 * render queue, so documents with hundreds of pages stay responsive.
 *
 * Item model: { id, srcId, index (0-based page in source), rotation (extra degrees), blank?: {width,height} }
 */
(function (global) {
  'use strict';
  const PS = global.PS;
  const { h, icon, uid } = PS.util;

  function pageGrid(opts) {
    const {
      sources,                 // Map srcId -> engine handle
      selectable = true,
      sortable = false,
      actions = [],            // subset of ['rotate', 'duplicate', 'delete']
      label = 'Pages',
      thumbWidth = 150,
      showSource = false,
      onChange = () => {},
      onSelect = () => {},
    } = opts;
    let items = (opts.items || []).map((it) => Object.assign({ rotation: 0 }, it));
    const selected = new Set(opts.selected || []);
    const els = new Map();
    let anchorId = null;   // for shift-click range selection
    let focusId = null;

    const list = h('ul', {
      class: 'page-grid', role: 'listbox', 'aria-label': label,
      'aria-multiselectable': selectable ? 'true' : 'false',
      style: { '--thumb-w': thumbWidth + 'px' },
    });

    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) renderThumb(entry.target);
    }, { rootMargin: '400px 0px' });

    /* ---------------------------------------------------------- rendering */
    function sourceName(item) {
      const src = sources.get(item.srcId);
      return src ? src.name : '';
    }

    function createCard(item) {
      const card = h('li', {
        class: 'page-card' + (item.blank ? ' is-blank' : ''), role: 'option', tabindex: '-1',
        dataset: { id: item.id },
      });
      if (selectable) card.appendChild(h('span', { class: 'page-check', 'aria-hidden': 'true' }, icon('check')));
      if (actions.length) {
        const bar = h('div', { class: 'page-actions' });
        if (actions.includes('rotate')) {
          bar.appendChild(actionBtn('rotate-ccw', 'Rotate left', () => rotate([item.id], -90)));
          bar.appendChild(actionBtn('rotate-cw', 'Rotate right', () => rotate([item.id], 90)));
        }
        if (actions.includes('duplicate')) bar.appendChild(actionBtn('copy', 'Duplicate page', () => duplicate([item.id])));
        if (actions.includes('delete')) bar.appendChild(actionBtn('trash', 'Delete page', () => remove([item.id])));
        card.appendChild(bar);
      }
      card.appendChild(h('div', { class: 'page-thumb' }, h('div', { class: 'spinner', 'aria-hidden': 'true' })));
      card.appendChild(h('div', { class: 'page-label' }, h('span', { class: 'num' }), h('span', { class: 'src' })));
      card.addEventListener('click', (e) => onCardClick(e, item.id));
      card.addEventListener('focus', () => { focusId = item.id; updateTabStops(); });
      els.set(item.id, card);
      io.observe(card);
      return card;
    }

    function actionBtn(iconName, text, fn) {
      return h('button', {
        type: 'button', class: 'icon-btn sm', 'aria-label': text, title: text, tabindex: '-1',
        onclick: (e) => { e.stopPropagation(); fn(); },
      }, icon(iconName));
    }

    function renderKey(item) { return `${item.srcId}:${item.index}:${item.rotation}`; }

    async function renderThumb(card) {
      const item = items.find((it) => it.id === card.dataset.id);
      if (!item) return;
      const key = renderKey(item);
      if (card._key === key || card._pending === key) return;
      card._pending = key;
      const box = card.querySelector('.page-thumb');
      try {
        let canvas;
        if (item.blank) {
          canvas = document.createElement('canvas');
          const rot = item.rotation % 180 !== 0;
          const w = rot ? item.blank.height : item.blank.width, hh = rot ? item.blank.width : item.blank.height;
          canvas.width = 120; canvas.height = Math.round((120 * hh) / w);
          const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        } else {
          const src = sources.get(item.srcId);
          canvas = await PS.engine.renderPage(src.pdfjs, item.index + 1, { width: thumbWidth, extraRotation: item.rotation, hidpi: true });
        }
        if (card._pending !== key) { PS.engine.releaseCanvas(canvas); return; }
        canvas.setAttribute('aria-hidden', 'true');
        const old = box.querySelector('canvas');
        if (old) PS.engine.releaseCanvas(old);
        box.replaceChildren(canvas);
        card._key = key;
      } catch (err) {
        if (card._pending === key) box.replaceChildren(h('span', { class: 'hint' }, 'Preview unavailable'));
        console.warn('Thumbnail failed', err);
      } finally {
        if (card._pending === key) card._pending = null;
      }
    }

    function updateCard(item, position) {
      const card = els.get(item.id);
      const isSel = selected.has(item.id);
      card.setAttribute('aria-selected', selectable ? String(isSel) : 'false');
      const rot = ((item.rotation % 360) + 360) % 360;
      const srcLabel = showSource ? `${sourceName(item)} · p${item.index + 1}` : (item.blank ? 'Blank' : '');
      card.querySelector('.num').textContent = item.blank ? `${position}` : (showSource ? `${position}` : `Page ${item.index + 1}`);
      card.querySelector('.src').textContent = srcLabel;
      card.setAttribute('aria-label', `${item.blank ? 'Blank page' : 'Page ' + (item.index + 1)}${showSource ? ' of ' + sourceName(item) : ''}, position ${position}${rot ? ', rotated ' + rot + '°' : ''}`);
      let badge = card.querySelector('.rot-badge');
      if (rot) {
        if (!badge) card.querySelector('.page-thumb').after(badge = h('span', { class: 'rot-badge' }));
        badge.textContent = rot + '°';
      } else if (badge) badge.remove();
      if (card._key && card._key !== renderKey(item)) renderThumb(card);
    }

    function sync() {
      // keep DOM order == items order, create missing cards, drop removed ones
      const ids = new Set(items.map((it) => it.id));
      for (const [id, el] of els) if (!ids.has(id)) { io.unobserve(el); PS.engine.releaseCanvas(el.querySelector('canvas')); el.remove(); els.delete(id); selected.delete(id); }
      items.forEach((item, i) => {
        const el = els.get(item.id) || createCard(item);
        if (list.children[i] !== el) list.insertBefore(el, list.children[i] || null);
        updateCard(item, i + 1);
      });
      if (!items.some((it) => it.id === focusId)) focusId = items[0]?.id || null;
      updateTabStops();
    }

    function updateTabStops() {
      for (const [id, el] of els) el.tabIndex = id === focusId ? 0 : -1;
    }

    /* ---------------------------------------------------------- selection */
    function onCardClick(e, id) {
      if (!selectable) return;
      if (e.shiftKey && anchorId) {
        const a = items.findIndex((it) => it.id === anchorId), b = items.findIndex((it) => it.id === id);
        const [lo, hi] = a < b ? [a, b] : [b, a];
        for (let i = lo; i <= hi; i++) selected.add(items[i].id);
      } else {
        if (selected.has(id)) selected.delete(id); else selected.add(id);
        anchorId = id;
      }
      focusId = id;
      sync();
      onSelect(getSelected());
    }

    function getSelected() { return items.filter((it) => selected.has(it.id)).map((it) => it.id); }

    function setSelected(ids) {
      selected.clear();
      ids.forEach((id) => selected.add(id));
      sync();
      onSelect(getSelected());
    }

    /* ------------------------------------------------------------ actions */
    function rotate(ids, delta) {
      ids.forEach((id) => { const it = items.find((x) => x.id === id); if (it) it.rotation = (((it.rotation + delta) % 360) + 360) % 360; });
      sync();
      onChange(items, 'rotate');
    }

    function duplicate(ids) {
      const next = [];
      items.forEach((it) => {
        next.push(it);
        if (ids.includes(it.id)) {
          const copy = Object.assign({}, it, { id: uid('pg') });
          next.push(copy);
        }
      });
      const fresh = next.filter((it) => !els.has(it.id));
      items = next;
      sync();
      // reuse the original's pixels for the copy's thumbnail (no re-render needed)
      fresh.forEach((copy) => {
        const orig = items[items.indexOf(copy) - 1];
        const srcCanvas = els.get(orig.id)?.querySelector('canvas');
        if (srcCanvas && srcCanvas.width) {
          const c = document.createElement('canvas');
          c.width = srcCanvas.width; c.height = srcCanvas.height; c.style.cssText = srcCanvas.style.cssText;
          c.getContext('2d').drawImage(srcCanvas, 0, 0);
          const card = els.get(copy.id);
          card.querySelector('.page-thumb').replaceChildren(c);
          card._key = renderKey(copy);
        }
      });
      onChange(items, 'duplicate');
    }

    function remove(ids) {
      items = items.filter((it) => !ids.includes(it.id));
      sync();
      onChange(items, 'delete');
      onSelect(getSelected());
    }

    function move(id, delta) {
      const i = items.findIndex((it) => it.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= items.length) return;
      [items[i], items[j]] = [items[j], items[i]];
      sync();
      els.get(id).focus();
      onChange(items, 'move');
    }

    /* ----------------------------------------------------------- keyboard */
    function columns() {
      const cards = Array.from(list.children);
      if (cards.length < 2) return 1;
      const top = cards[0].offsetTop;
      const n = cards.findIndex((c) => c.offsetTop !== top);
      return n === -1 ? cards.length : n;
    }

    list.addEventListener('keydown', (e) => {
      const card = e.target.closest('.page-card');
      if (!card) return;
      const id = card.dataset.id;
      const i = items.findIndex((it) => it.id === id);
      const cols = columns();
      let next = null;
      if (e.altKey && sortable && (e.key === 'ArrowLeft' || e.key === 'ArrowUp')) { e.preventDefault(); move(id, -1); return; }
      if (e.altKey && sortable && (e.key === 'ArrowRight' || e.key === 'ArrowDown')) { e.preventDefault(); move(id, 1); return; }
      switch (e.key) {
        case 'ArrowRight': next = i + 1; break;
        case 'ArrowLeft': next = i - 1; break;
        case 'ArrowDown': next = i + cols; break;
        case 'ArrowUp': next = i - cols; break;
        case 'Home': next = 0; break;
        case 'End': next = items.length - 1; break;
        case ' ': case 'Enter':
          e.preventDefault(); onCardClick({ shiftKey: e.shiftKey }, id); card.focus(); return;
        case 'Delete': case 'Backspace':
          if (actions.includes('delete')) { e.preventDefault(); const nid = items[i + 1]?.id || items[i - 1]?.id; remove(selected.has(id) ? getSelected() : [id]); if (nid) els.get(nid)?.focus(); }
          return;
        case 'r': case 'R':
          if (actions.includes('rotate')) { e.preventDefault(); rotate(selected.has(id) ? getSelected() : [id], e.shiftKey ? -90 : 90); }
          return;
        case 'a': case 'A':
          if ((e.ctrlKey || e.metaKey) && selectable) { e.preventDefault(); setSelected(items.map((it) => it.id)); }
          return;
        default: return;
      }
      e.preventDefault();
      next = Math.max(0, Math.min(items.length - 1, next));
      const target = els.get(items[next].id);
      focusId = items[next].id;
      updateTabStops();
      target.focus();
    });

    let sorter = null;
    if (sortable) {
      sorter = PS.sortable(list, {
        itemSelector: '.page-card',
        onEnd(order) {
          const byId = new Map(items.map((it) => [it.id, it]));
          items = order.map((id) => byId.get(id)).filter(Boolean);
          sync();
          onChange(items, 'move');
        },
      });
    }

    sync();

    return {
      el: list,
      get items() { return items.slice(); },
      setItems(next) { items = next.map((it) => Object.assign({ rotation: 0 }, it)); sync(); onChange(items, 'set'); },
      addItems(more) { items = items.concat(more.map((it) => Object.assign({ rotation: 0 }, it))); sync(); onChange(items, 'add'); },
      selected: getSelected,
      setSelected,
      selectAll() { setSelected(items.map((it) => it.id)); },
      clearSelection() { setSelected([]); },
      invertSelection() { setSelected(items.filter((it) => !selected.has(it.id)).map((it) => it.id)); },
      rotate, duplicate, remove,
      destroy() {
        io.disconnect();
        sorter?.destroy();
        for (const el of els.values()) PS.engine.releaseCanvas(el.querySelector('canvas'));
        els.clear();
        list.remove();
      },
    };
  }

  /** Build grid items for every page of a source document. */
  function itemsFor(handle) {
    return Array.from({ length: handle.pageCount }, (_, i) => ({ id: uid('pg'), srcId: handle.id, index: i, rotation: 0 }));
  }

  PS.pageGrid = pageGrid;
  PS.pageGrid.itemsFor = itemsFor;
})(window);
