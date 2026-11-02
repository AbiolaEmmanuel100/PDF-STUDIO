/**
 * Tools: Protect PDF (add a password + permissions) and Unlock PDF (remove them).
 *
 * Encryption uses @cantoo/pdf-lib (a maintained pdf-lib fork with AES-256 / RC4 support),
 * lazy-loaded the first time one of these tools is used. It is loaded under its own name so
 * the regular pdf-lib build used by every other tool is left untouched.
 */
(function (global) {
  'use strict';
  const PS = global.PS;
  const { h, icon, baseName, isPdf, formatBytes, readAsArrayBuffer } = PS.util;
  const ui = PS.ui;

  let cantooPromise = null;
  /** Load the encryption-capable pdf-lib build without replacing window.PDFLib. */
  function loadCantoo() {
    if (cantooPromise) return cantooPromise;
    cantooPromise = new Promise((resolve, reject) => {
      const original = global.PDFLib;
      const s = document.createElement('script');
      s.src = 'vendor/pdf-lib-cantoo.min.js';
      s.onload = () => { const lib = global.PDFLib; global.PDFLib = original; resolve(lib); };
      s.onerror = () => { global.PDFLib = original; cantooPromise = null; reject(new Error('Could not load the encryption engine (vendor/pdf-lib-cantoo.min.js).')); };
      document.head.appendChild(s);
    });
    return cantooPromise;
  }
  PS.loadCantoo = loadCantoo;

  /** Rough password strength 0–4 with a label. */
  function strength(pw) {
    let s = 0;
    if (pw.length >= 8) s++;
    if (pw.length >= 12) s++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
    if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
    if (pw.length < 6) s = Math.min(s, 1);
    return { score: s, label: ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'][s] };
  }

  function randomPassword() {
    const a = new Uint8Array(24);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  /** Does pdf.js need a password for these bytes? */
  async function needsPassword(bytes, password) {
    try { const d = await PS.engine.openPdfJs(bytes, password); d.destroy(); return false; } catch (err) { if (err && err.name === 'PasswordException') return true; throw err; }
  }

  PS.tools.register({
    id: 'protect',
    name: 'Protect PDF',
    category: 'review',
    icon: 'lock',
    isNew: true,
    description: 'Add a password and restrict printing, copying or editing.',
    longDescription: 'Encrypt a PDF with AES-256 so it needs a password to open, and optionally restrict printing, copying text, editing and commenting with a separate permissions password.',
    keywords: ['password', 'encrypt', 'encryption', 'secure', 'aes', 'permissions', 'restrict', 'lock'],
    mount(root) {
      const libs = loadCantoo().catch((err) => { ui.reportError(err, 'protect'); throw err; });
      return PS.kit.pdfTool(root, {
        dropTitle: 'Choose a PDF to protect',
        async onLoad(handle, view) {
          const pw = h('input', { type: 'password', autocomplete: 'new-password', 'aria-label': 'Password', placeholder: 'At least 6 characters' });
          const pw2 = h('input', { type: 'password', autocomplete: 'new-password', 'aria-label': 'Confirm password' });
          const show = h('input', { type: 'checkbox' });
          show.addEventListener('change', () => { pw.type = pw2.type = show.checked ? 'text' : 'password'; });
          const meter = h('div', { class: 'progress', style: { height: '6px', marginTop: '8px' } }, h('div', { class: 'progress-fill' }));
          const meterLabel = h('span', { class: 'hint' });
          pw.addEventListener('input', () => { const s = strength(pw.value); meter.firstChild.style.width = (pw.value ? (s.score + 1) * 20 : 0) + '%'; meter.firstChild.style.background = ['#c62f3a', '#d9534f', '#d98e04', '#2f9e5f', '#0f8a5f'][s.score]; meterLabel.textContent = pw.value ? s.label : ''; });
          const restrict = h('input', { type: 'checkbox' });
          const owner = h('input', { type: 'password', autocomplete: 'new-password', 'aria-label': 'Permissions password', placeholder: 'Leave empty to generate one' });
          const printing = ui.select([['highResolution', 'Allowed'], ['lowResolution', 'Low resolution only'], ['none', 'Not allowed']], 'highResolution');
          const perms = { copying: 'Copy text and images', modifying: 'Edit the document', annotating: 'Add comments', fillingForms: 'Fill in forms', documentAssembly: 'Insert, delete or rotate pages' };
          const permBoxes = Object.fromEntries(Object.keys(perms).map((k) => [k, h('input', { type: 'checkbox', checked: k === 'fillingForms' || k === 'annotating' })]));
          const permPanel = h('div', { hidden: true },
            ui.field('Permissions password', owner, 'Needed to change these restrictions later. Not needed to open the file.'),
            ui.field('Printing', printing),
            h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Allow'), ...Object.entries(perms).map(([k, l]) => h('label', { class: 'check' }, permBoxes[k], l))));
          restrict.addEventListener('change', () => { permPanel.hidden = !restrict.checked; });
          const btn = view.actionButton('Protect PDF', 'lock', run);
          if (handle.encrypted) view.workspace.insertBefore(ui.note('This PDF is already encrypted. Remove the existing protection with “Unlock PDF” first.', 'warn'), view.result);
          view.workspace.insertBefore(PS.kit.panel('Password to open',
            ui.field('Password', pw), meter, meterLabel, ui.field('Confirm password', pw2), h('label', { class: 'check' }, show, 'Show passwords')), view.result);
          view.options.append(
            PS.kit.panel('Restrictions', h('label', { class: 'check' }, restrict, 'Restrict printing, copying and editing'), permPanel),
            PS.kit.panel('Encrypt', h('p', { class: 'hint' }, 'AES-256 encryption (PDF 2.0 / Acrobat X and later). Keep the password safe — it can’t be recovered.'), h('div', { style: { marginTop: '12px' } }, btn)));

          async function run() {
            if (pw.value.length < 1) { ui.toast('Enter a password.', 'warning'); pw.focus(); return; }
            if (pw.value !== pw2.value) { ui.toast('The passwords don’t match.', 'warning'); pw2.focus(); return; }
            if (pw.value.length < 6) ui.toast('That’s a short password — anyone determined could guess it.', 'warning');
            const out = await ui.run('Encrypting…', async () => {
              const C = await libs;
              const doc = await C.PDFDocument.load(handle.bytes, { updateMetadata: false });
              const ownerPw = restrict.checked ? (owner.value || randomPassword()) : (owner.value || randomPassword());
              const permissions = restrict.checked
                ? Object.assign({ printing: printing.value === 'none' ? false : printing.value, contentAccessibility: true },
                  Object.fromEntries(Object.entries(permBoxes).map(([k, b]) => [k, b.checked])))
                : { printing: 'highResolution', modifying: true, copying: true, annotating: true, fillingForms: true, contentAccessibility: true, documentAssembly: true };
              doc.encrypt({ userPassword: pw.value, ownerPassword: ownerPw, permissions });
              const bytes = await doc.save({ useObjectStreams: false });
              // Verify the result really is locked and opens with the password.
              if (!(await needsPassword(bytes))) throw new Error('Encryption check failed: the output opened without a password.');
              if (await needsPassword(bytes, pw.value)) throw new Error('Encryption check failed: the output did not open with the password.');
              return new Blob([bytes], { type: 'application/pdf' });
            }, 'protect');
            if (out) ui.showResult(view.result, { blob: out, filename: `${baseName(handle.name)}_protected.pdf`, detail: 'AES-256 · verified: needs the password to open' + (restrict.checked ? ' · restrictions applied' : '') });
          }
        },
      });
    },
  });

  PS.tools.register({
    id: 'unlock',
    name: 'Unlock PDF',
    category: 'review',
    icon: 'unlock',
    isNew: true,
    description: 'Remove the password and restrictions from a PDF you can open.',
    longDescription: 'Remove password protection and printing/copying/editing restrictions from a PDF. You need to know the password to open it — this tool does not crack passwords.',
    keywords: ['remove password', 'decrypt', 'unprotect', 'unsecure', 'permissions', 'restrictions'],
    mount(root) {
      const libs = loadCantoo().catch((err) => { ui.reportError(err, 'unlock'); throw err; });
      const result = h('div', { class: 'result-slot', hidden: true, 'aria-live': 'polite' });
      function showDrop() {
        const zone = ui.dropzone({ title: 'Choose a protected PDF', subtitle: 'or drop it here — it never leaves your device', accept: '.pdf,application/pdf', filter: isPdf, rejectHint: 'only PDF files are supported here', icon: 'unlock', onFiles: ([f]) => unlock(f) });
        root.replaceChildren(h('div', { class: 'tool-body single' }, zone, result));
        PS.app.setDropHandler((files) => zone._accept(files));
      }
      async function unlock(file) {
        let bytes;
        try { bytes = await readAsArrayBuffer(file); } catch (err) { ui.reportError(err, 'unlock'); return; }
        const C = await libs.catch(() => null);
        if (!C) return;
        let password = '';
        let note = '';
        for (let attempt = 0; attempt < 6; attempt++) {
          try {
            ui.busy.start('Unlocking…');
            let doc;
            try { doc = await C.PDFDocument.load(bytes, { updateMetadata: false }); } catch (err) {
              if (!/encrypted/i.test(String(err.message))) throw err;
              doc = await C.PDFDocument.load(bytes, { updateMetadata: false, password });
              note = password ? 'password removed' : 'restrictions removed (no open password was set)';
              if (!doc.isEncrypted && note) { /* decrypted in memory */ }
            }
            if (!note) { ui.busy.end(); ui.toast(`“${file.name}” isn’t password-protected.`, 'info'); return; }
            const out = await doc.save({ useObjectStreams: true });
            ui.busy.end();
            if (await needsPassword(out)) throw new Error('The file is still protected after unlocking.');
            const blob = new Blob([out], { type: 'application/pdf' });
            ui.showResult(result, { blob, filename: `${baseName(file.name)}_unlocked.pdf`, detail: `${formatBytes(blob.size)} · ${note}` });
            return;
          } catch (err) {
            ui.busy.end();
            if (/password/i.test(String(err.message))) {
              password = await ui.prompt({ title: 'Password required', type: 'password', okLabel: 'Unlock', label: attempt && password ? 'Incorrect password — try again' : `Enter the password for “${file.name}”.` });
              if (password == null) return;
              continue;
            }
            ui.reportError(err, 'unlock');
            return;
          }
        }
      }
      showDrop();
      return { destroy() {} };
    },
  });
})(window);
