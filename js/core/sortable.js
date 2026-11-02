/**
 * PDF Studio — pointer-based drag-to-reorder (PS.sortable)
 *
 * Works with mouse, pen and touch (touch uses a long-press so normal scrolling still works).
 * The DOM is reordered live for feedback; when the drag ends `onEnd(orderedIds)` is called with
 * the new order of the items' `data-id` attributes so the owner can sync its data model.
 * Keyboard users get the same capability through Alt+Arrow keys (handled by owners) and buttons.
 */
(function (global) {
  'use strict';
  const PS = global.PS;

  function sortable(container, { itemSelector, handleSelector, onEnd, axis = 'grid' }) {
    let state = null;

    function items() { return Array.from(container.querySelectorAll(itemSelector)); }

    function onPointerDown(e) {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      const item = e.target.closest(itemSelector);
      if (!item || !container.contains(item)) return;
      if (e.target.closest('button, input, select, textarea, a') && !(handleSelector && e.target.closest(handleSelector))) return;
      if (handleSelector && !e.target.closest(handleSelector)) {
        // whole-item drag is allowed only when no handle is configured
        return;
      }
      const onHandle = handleSelector && e.target.closest(handleSelector);
      state = {
        item, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY,
        dragging: false, touch: e.pointerType === 'touch' && !onHandle, timer: null,
      };
      if (state.touch) {
        // long-press to start dragging on touch screens
        state.timer = setTimeout(() => { if (state) begin(); }, 380);
      }
      document.addEventListener('pointermove', onPointerMove, { passive: false });
      document.addEventListener('pointerup', onPointerUp);
      document.addEventListener('pointercancel', onCancel);
    }

    function begin() {
      const { item } = state;
      const rect = item.getBoundingClientRect();
      state.dragging = true;
      state.offsetX = state.x - rect.left;
      state.offsetY = state.y - rect.top;
      const ghost = item.cloneNode(true);
      ghost.classList.add('drag-ghost');
      ghost.removeAttribute('id');
      ghost.style.width = rect.width + 'px';
      ghost.style.height = rect.height + 'px';
      ghost.setAttribute('aria-hidden', 'true');
      // cloned canvases are blank; copy pixels of the first canvas for a faithful ghost
      const srcCanvas = item.querySelector('canvas');
      const dstCanvas = ghost.querySelector('canvas');
      if (srcCanvas && dstCanvas && srcCanvas.width) {
        dstCanvas.width = srcCanvas.width; dstCanvas.height = srcCanvas.height;
        dstCanvas.getContext('2d').drawImage(srcCanvas, 0, 0);
      }
      document.body.appendChild(ghost);
      state.ghost = ghost;
      item.classList.add('is-dragging');
      document.addEventListener('touchmove', preventTouch, { passive: false });
      document.addEventListener('contextmenu', preventDefault, true);
      if (navigator.vibrate && state.touch) try { navigator.vibrate(10); } catch (_) {}
      moveGhost();
    }

    function preventTouch(e) { if (state && state.dragging) e.preventDefault(); }
    function preventDefault(e) { e.preventDefault(); }

    function moveGhost() {
      state.ghost.style.left = state.x - state.offsetX + 'px';
      state.ghost.style.top = state.y - state.offsetY + 'px';
    }

    function onPointerMove(e) {
      if (!state || e.pointerId !== state.pointerId) return;
      state.x = e.clientX; state.y = e.clientY;
      const dist = Math.hypot(state.x - state.startX, state.y - state.startY);
      if (!state.dragging) {
        if (state.touch) {
          if (dist > 8) cleanup(); // the user is scrolling, not dragging
          return;
        }
        if (dist < 6) return;
        begin();
      }
      e.preventDefault();
      moveGhost();
      reposition();
      autoScroll();
    }

    function reposition() {
      const list = items().filter((el) => el !== state.item);
      let target = null, after = false;
      for (const el of list) {
        const r = el.getBoundingClientRect();
        if (state.x >= r.left && state.x <= r.right && state.y >= r.top && state.y <= r.bottom) {
          target = el;
          after = axis === 'y' ? state.y > r.top + r.height / 2 : state.x > r.left + r.width / 2;
          break;
        }
      }
      if (!target) return;
      const ref = after ? target.nextSibling : target;
      if (ref !== state.item) container.insertBefore(state.item, ref);
    }

    function autoScroll() {
      const edge = 70;
      const vh = global.innerHeight;
      if (state.y < edge) global.scrollBy(0, -Math.ceil((edge - state.y) / 4));
      else if (state.y > vh - edge) global.scrollBy(0, Math.ceil((state.y - (vh - edge)) / 4));
    }

    function onPointerUp(e) {
      if (!state || e.pointerId !== state.pointerId) return;
      const wasDragging = state.dragging;
      const item = state.item;
      cleanup();
      if (wasDragging) {
        // swallow the click that follows a drag so it doesn't toggle selection
        const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
        item.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => item.removeEventListener('click', swallow, { capture: true }), 50);
        onEnd(items().map((el) => el.dataset.id));
        item.focus?.({ preventScroll: true });
      }
    }

    function onCancel() { cleanup(); }

    function cleanup() {
      if (!state) return;
      clearTimeout(state.timer);
      if (state.ghost) state.ghost.remove();
      state.item.classList.remove('is-dragging');
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', onCancel);
      document.removeEventListener('touchmove', preventTouch);
      document.removeEventListener('contextmenu', preventDefault, true);
      state = null;
    }

    container.addEventListener('pointerdown', onPointerDown);
    return { destroy() { cleanup(); container.removeEventListener('pointerdown', onPointerDown); } };
  }

  PS.sortable = sortable;
})(window);
