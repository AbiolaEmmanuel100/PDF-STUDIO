/**
 * PDF Studio — tool scaffolding (PS.kit)
 *
 * Most tools follow the same flow: drop one PDF -> see it -> tweak options -> export.
 * `PS.kit.pdfTool` implements that flow once (loading, errors, file bar, layout,
 * replacing/clearing the file, cleanup) so each tool only describes what is unique to it.
 */
(function (global) {
  'use strict';
  const PS = global.PS;
  const { h, icon, formatBytes, plural, isPdf } = PS.util;
  const ui = PS.ui;

  /** Workspace + options two-column layout. */
  function twoColumn() {
    const workspace = h('div', { class: 'workspace' });
    const options = h('aside', { class: 'options', 'aria-label': 'Options' });
    const el = h('div', { class: 'tool-body' }, workspace, options);
    return { el, workspace, options };
  }

  /** "file.pdf · 12 pages · 2.3 MB   [Change file] [Close]" */
  function fileBar(handle, { onReplace, onClear }) {
    return h('div', { class: 'panel', style: { padding: '12px 14px' } },
      h('div', { class: 'list-toolbar' },
        h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center', minWidth: '0' } },
          h('div', { class: 'tool-icon', style: { '--tool-color': 'var(--c-organize)' } }, icon('file')),
          h('div', { style: { minWidth: '0' } },
            h('div', { class: 'file-name' }, handle.name),
            h('div', { class: 'file-sub' }, `${plural(handle.pageCount, 'page')} · ${formatBytes(handle.size)}`))),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: onReplace }, icon('refresh', 'icon-sm'), 'Change file'),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close file', title: 'Close file', onclick: onClear }, icon('x')))));
  }

  /**
   * Open a PDF with the busy overlay and friendly errors; resolves to a handle or null.
   * Password-protected files prompt for their password (it never leaves the page).
   */
  async function openPdf(file) {
    let password;
    for (let attempt = 0; attempt < 5; attempt++) {
      ui.busy.start(`Opening ${file.name}…`);
      try {
        const handle = await PS.engine.openFile(file, { password });
        ui.busy.end();
        if (handle.encrypted) ui.toast(password ? 'Opened with password. Tools that change the file need the protection removed first (Unlock PDF).' : 'This PDF is encrypted. Viewing works, but tools that modify it may fail until the protection is removed (Unlock PDF).', 'warning', { timeout: 9000 });
        return handle;
      } catch (err) {
        ui.busy.end();
        if (err && err.name === 'PasswordException') {
          password = await ui.prompt({
            title: 'Password required', type: 'password', okLabel: 'Open',
            label: attempt ? 'Incorrect password — try again' : `“${file.name}” is password-protected. Enter its password to open it.`,
          });
          if (password == null) return null;
          continue;
        }
        ui.reportError(err, 'open');
        return null;
      }
    }
    ui.toast('Too many incorrect passwords.', 'error');
    return null;
  }

  /**
   * Single-PDF tool scaffold.
   * opts: { root, dropTitle, dropSubtitle, onLoad(handle, view) -> optional cleanup fn }
   * view: { workspace, options, result (slot), handle, actionButton(label, iconName, fn) }
   */
  function pdfTool(root, opts) {
    let handle = null;
    let cleanup = null;
    let picker = null;

    function showDrop() {
      teardown();
      const zone = ui.dropzone({
        title: opts.dropTitle || 'Choose a PDF file',
        subtitle: opts.dropSubtitle || 'or drop it here — it never leaves your device',
        accept: '.pdf,application/pdf',
        filter: isPdf,
        rejectHint: 'only PDF files are supported here',
        onFiles: ([file]) => load(file),
      });
      root.replaceChildren(h('div', { class: 'tool-body single' }, zone));
      PS.app.setDropHandler((files) => zone._accept(files));
    }

    async function load(file) {
      const next = await openPdf(file);
      if (!next) return;
      teardown();
      handle = next;
      const layout = twoColumn();
      const result = h('div', { class: 'result-slot', hidden: true, 'aria-live': 'polite' });
      // hidden picker used by "Change file"
      picker = ui.dropzone({ accept: '.pdf,application/pdf', filter: isPdf, onFiles: ([f]) => load(f) });
      layout.workspace.append(fileBar(handle, { onReplace: () => picker.open(), onClear: showDrop }), result);
      root.replaceChildren(layout.el);
      PS.app.setDropHandler((files) => picker._accept(files));
      const view = {
        handle, workspace: layout.workspace, options: layout.options, result,
        actionButton(label, iconName, fn) {
          const btn = h('button', { class: 'btn btn-lg', type: 'button', style: { width: '100%' }, onclick: fn }, icon(iconName || 'download'), label);
          return btn;
        },
      };
      try {
        cleanup = (await opts.onLoad(handle, view)) || null;
      } catch (err) {
        ui.reportError(err, 'tool');
      }
    }

    function teardown() {
      if (cleanup) { try { cleanup(); } catch (e) { console.warn(e); } cleanup = null; }
      if (handle) { handle.destroy(); handle = null; }
    }

    showDrop();
    return { destroy: teardown, load };
  }

  /** Panel with a heading. */
  function panel(title, ...children) {
    return h('section', { class: 'panel' }, title ? h('h2', null, title) : null, ...children);
  }

  PS.kit = { pdfTool, twoColumn, fileBar, openPdf, panel };
})(window);
