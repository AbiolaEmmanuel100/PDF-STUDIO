/**
 * PDF Studio — shared UI components (PS.ui)
 * Toasts, busy/progress overlay, dropzones, modals, result cards and form-field builders.
 */
(function (global) {
  'use strict';
  const PS = global.PS;
  const { h, icon, formatBytes, errorMessage } = PS.util;

  /* ---------------------------------------------------------------- Toasts */
  function toast(message, type = 'info', { timeout } = {}) {
    const region = document.getElementById('toast-region');
    if (!region) return;
    const iconName = { success: 'check-circle', error: 'alert', warning: 'alert', info: 'info' }[type] || 'info';
    const el = h('div', { class: 'toast ' + type, role: type === 'error' ? 'alert' : 'status' },
      icon(iconName),
      h('div', { class: 't-msg' }, message),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Dismiss notification', onclick: () => close() }, icon('x', 'icon-sm')));
    region.appendChild(el);
    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 200);
    }
    setTimeout(close, timeout || (type === 'error' ? 8000 : 4500));
    // keep at most 4 toasts
    while (region.children.length > 4) region.firstChild.remove();
    return close;
  }

  /** Standard error reporter used by every tool. */
  function reportError(err, context) {
    const msg = errorMessage(err);
    // Expected problems with the user's file are warnings; anything else is a real error.
    const expected = msg !== String((err && err.message) || err) || /InvalidPDF|EncryptedPDF|Password/.test((err && err.name) || '');
    (expected ? console.warn : console.error)(context ? `[${context}]` : '[PDF Studio]', err);
    toast(msg, 'error');
  }

  /* ------------------------------------------------------- Busy / progress */
  const busy = {
    depth: 0,
    start(message) {
      const root = document.getElementById('busy');
      this.depth++;
      root.hidden = false;
      root.querySelector('.busy-msg').textContent = message || 'Working…';
      this.progress(null);
      document.getElementById('app').setAttribute('aria-busy', 'true');
    },
    /** done/total -> determinate bar; null -> indeterminate. */
    progress(done, total, sub) {
      const root = document.getElementById('busy');
      const bar = root.querySelector('.progress');
      const fill = bar.firstElementChild;
      const subEl = root.querySelector('.busy-sub');
      if (done == null || !total) {
        bar.classList.add('indeterminate');
        bar.removeAttribute('aria-valuenow');
        fill.style.width = '';
        subEl.textContent = sub || '';
      } else {
        const pct = Math.round((done / total) * 100);
        bar.classList.remove('indeterminate');
        bar.setAttribute('aria-valuenow', String(pct));
        fill.style.width = pct + '%';
        subEl.textContent = sub || `${done} of ${total}`;
      }
    },
    message(msg) { document.querySelector('#busy .busy-msg').textContent = msg; },
    end() {
      this.depth = Math.max(0, this.depth - 1);
      if (this.depth) return;
      document.getElementById('busy').hidden = true;
      document.getElementById('app').removeAttribute('aria-busy');
    },
  };

  /** Run an async job with the busy overlay and unified error handling. Returns the job's result or undefined on error. */
  async function run(message, job, context) {
    busy.start(message);
    try {
      return await job(busy);
    } catch (err) {
      reportError(err, context);
      return undefined;
    } finally {
      busy.end();
    }
  }

  /* ------------------------------------------------------------- Dropzone */
  /**
   * Accessible drop target + file picker.
   * opts: { accept, multiple, title, subtitle, filter(file)->bool, onFiles(files), compact, label }
   */
  function dropzone(opts) {
    const input = h('input', { type: 'file', accept: opts.accept || '', multiple: !!opts.multiple, tabindex: '-1', 'aria-hidden': 'true' });
    const zone = h('div', {
      class: 'dropzone' + (opts.compact ? ' compact' : ''),
      role: 'button',
      tabindex: '0',
      'aria-label': opts.label || (opts.title + '. ' + (opts.subtitle || '')),
    },
      h('div', { class: 'dz-icon' }, icon(opts.icon || 'upload')),
      h('div', null,
        h('div', { class: 'dz-title' }, opts.title || 'Choose files'),
        h('div', { class: 'dz-sub' }, opts.subtitle || 'or drag and drop them here')),
      input);

    const accept = (list) => {
      const all = Array.from(list || []);
      if (!all.length) return;
      const ok = opts.filter ? all.filter(opts.filter) : all;
      const rejected = all.length - ok.length;
      if (rejected) toast(`${rejected === 1 ? 'One file was' : rejected + ' files were'} skipped — ${opts.rejectHint || 'unsupported type'}.`, 'warning');
      if (!ok.length) return;
      opts.onFiles(opts.multiple ? ok : [ok[0]]);
    };

    zone.addEventListener('click', () => input.click());
    zone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('change', () => { accept(input.files); input.value = ''; });

    // dragenter/leave counter avoids flicker when hovering child elements
    let depth = 0;
    zone.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; zone.classList.add('is-dragover'); });
    zone.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    zone.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) zone.classList.remove('is-dragover'); });
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      depth = 0;
      zone.classList.remove('is-dragover');
      accept(e.dataTransfer && e.dataTransfer.files);
    });
    zone._accept = accept; // used by the page-level drop fallback
    zone.open = () => input.click();
    return zone;
  }

  /* ---------------------------------------------------------------- Modal */
  /**
   * modal({title, body:Node, actions:[{label, primary, onClick -> false to keep open}], onClose})
   * Traps focus, closes with Esc, restores focus on close.
   */
  function modal({ title, body, actions = [], onClose }) {
    const previouslyFocused = document.activeElement;
    const titleId = PS.util.uid('mt');
    const foot = h('div', { class: 'modal-foot' });
    const dialog = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      h('div', { class: 'modal-head' },
        h('h2', { id: titleId }, title),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close dialog', onclick: () => close() }, icon('x'))),
      h('div', { class: 'modal-body' }, body),
      actions.length ? foot : null);
    const backdrop = h('div', { class: 'modal-backdrop' }, dialog);
    actions.forEach((a) => {
      foot.appendChild(h('button', {
        type: 'button', class: 'btn ' + (a.primary ? '' : 'btn-secondary'),
        onclick: async () => { const r = await a.onClick?.(); if (r !== false) close(); },
      }, a.label));
    });
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      if (e.key === 'Tab') {
        const f = dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        const list = Array.from(f).filter((x) => !x.disabled && x.offsetParent !== null);
        if (!list.length) return;
        const first = list[0], last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(backdrop);
    setTimeout(() => {
      const target = dialog.querySelector('.modal-body input, .modal-body textarea, .modal-body button, .modal-foot .btn:not(.btn-secondary)');
      (target || dialog.querySelector('.icon-btn')).focus();
    }, 0);
    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      onClose?.();
      if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
    }
    return { close, el: dialog };
  }

  /* ---------------------------------------------------------- Result card */
  /**
   * Shows the produced file with a Download button. Triggers the download once
   * automatically. Returns the element; mount it in the tool's workspace.
   */
  function resultCard({ blob, filename, detail, autoDownload = true }) {
    const card = h('div', { class: 'result', role: 'status' },
      h('div', { class: 'r-icon' }, icon('check')),
      h('div', { class: 'r-body' },
        h('div', { class: 'r-title' }, filename),
        h('div', { class: 'r-sub' }, [formatBytes(blob.size), detail].filter(Boolean).join(' · '))),
      h('button', { class: 'btn', type: 'button', onclick: () => PS.util.download(blob, filename) }, icon('download'), 'Download'));
    if (autoDownload) PS.util.download(blob, filename);
    return card;
  }

  /** Replace the contents of a "result slot" element with a fresh result card. */
  function showResult(slot, opts) {
    slot.replaceChildren(resultCard(opts));
    slot.hidden = false;
    slot.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    toast(`Done — ${opts.filename} is ready.`, 'success');
  }

  /* --------------------------------------------------------- Form helpers */
  function field(label, control, hint) {
    const id = control.id || (control.id = PS.util.uid('f'));
    return h('div', { class: 'field' },
      h('label', { for: id }, label),
      control,
      hint ? h('div', { class: 'hint' }, hint) : null);
  }

  function select(options, value) {
    const el = h('select');
    options.forEach(([v, label]) => el.appendChild(h('option', { value: v, selected: String(v) === String(value) }, label)));
    el.value = String(value);
    return el;
  }

  /** Segmented radio control. Returns {el, get value(), onChange(fn)} */
  function segmented(name, options, value, ariaLabel) {
    const group = PS.util.uid(name);
    const el = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': ariaLabel || name });
    options.forEach(([v, label]) => {
      el.appendChild(h('label', null,
        h('input', { type: 'radio', name: group, value: v, checked: String(v) === String(value) }),
        h('span', null, label)));
    });
    return {
      el,
      get value() { return el.querySelector('input:checked')?.value; },
      set value(v) { const r = el.querySelector(`input[value="${v}"]`); if (r) r.checked = true; },
      onChange(fn) { el.addEventListener('change', () => fn(this.value)); return this; },
    };
  }

  /** Range slider with live value output. */
  function range({ min, max, step = 1, value, format = (v) => v, label }) {
    const input = h('input', { type: 'range', min, max, step, value, 'aria-label': label });
    const out = h('output', null, format(Number(value)));
    input.addEventListener('input', () => { out.textContent = format(Number(input.value)); });
    const el = h('div', { class: 'range-wrap' }, input, out);
    el.input = input;
    return el;
  }

  /** 3×3 position picker (tl, tc, tr, ml, mc, mr, bl, bc, br). */
  function positionGrid(value, allowed, ariaLabel) {
    const group = PS.util.uid('pos');
    const names = { tl: 'Top left', tc: 'Top center', tr: 'Top right', ml: 'Middle left', mc: 'Center', mr: 'Middle right', bl: 'Bottom left', bc: 'Bottom center', br: 'Bottom right' };
    const el = h('div', { class: 'position-grid', role: 'radiogroup', 'aria-label': ariaLabel || 'Position' });
    Object.keys(names).forEach((k) => {
      const disabled = allowed && !allowed.includes(k);
      el.appendChild(h('label', { title: names[k], style: disabled ? { visibility: 'hidden' } : null },
        h('input', { type: 'radio', name: group, value: k, checked: k === value, disabled, 'aria-label': names[k] }),
        h('span')));
    });
    return { el, get value() { return el.querySelector('input:checked')?.value || value; } };
  }

  function note(text, type) {
    return h('div', { class: 'note' + (type ? ' ' + type : '') }, icon(type === 'warn' ? 'alert' : 'info'), h('p', null, text));
  }

  function emptyState(text, iconName) {
    return h('div', { class: 'empty' }, icon(iconName || 'file'), h('p', null, text));
  }

  PS.ui = { toast, reportError, busy, run, dropzone, modal, resultCard, showResult, field, select, segmented, range, positionGrid, note, emptyState };
})(window);
