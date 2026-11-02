/**
 * Tool: Text → PDF
 * Type, paste or open a .txt file and lay it out as a clean, paginated PDF.
 * Paragraphs and line breaks are preserved; long words are wrapped safely.
 */
(function (global) {
  'use strict';
  const PS = global.PS;
  const { h, icon, plural, safeFileName } = PS.util;
  const ui = PS.ui;

  const SIZES = { A4: [595.28, 841.89], Letter: [612, 792] };
  const FONTS = {
    Helvetica: ['Helvetica', 'HelveticaBold'],
    Times: ['TimesRoman', 'TimesRomanBold'],
    Courier: ['Courier', 'CourierBold'],
  };

  /** Replace characters the standard PDF fonts (WinAnsi) can't encode. Returns [text, replacedCount]. */
  function sanitizeFor(font, text) {
    const cache = new Map();
    let replaced = 0;
    const map = { '\t': '    ', '\u2028': '\n', '\u00a0': ' ' };
    let out = '';
    for (const ch of text) {
      if (map[ch] !== undefined) { out += map[ch]; continue; }
      if (ch === '\n' || ch === '\r') { out += ch; continue; }
      let ok = cache.get(ch);
      if (ok === undefined) { try { font.encodeText(ch); ok = true; } catch (_) { ok = false; } cache.set(ch, ok); }
      if (ok) out += ch; else { out += '?'; replaced++; }
    }
    return [out, replaced];
  }

  /** Greedy word-wrap of one paragraph; splits words longer than the line. */
  function wrap(font, size, text, maxWidth) {
    const words = text.split(/ +/);
    const lines = [];
    let line = '';
    const width = (s) => font.widthOfTextAtSize(s, size);
    for (let word of words) {
      while (width(word) > maxWidth) {
        // hard-break very long words/URLs
        let i = word.length;
        while (i > 1 && width(word.slice(0, i)) > maxWidth) i--;
        if (line) { lines.push(line); line = ''; }
        lines.push(word.slice(0, i));
        word = word.slice(i);
      }
      const test = line ? line + ' ' + word : word;
      if (width(test) > maxWidth && line) { lines.push(line); line = word; }
      else line = test;
    }
    lines.push(line);
    return lines;
  }

  PS.tools.register({
    id: 'text-to-pdf',
    name: 'Text to PDF',
    category: 'convert',
    icon: 'type',
    description: 'Create a clean PDF from typed or pasted text.',
    longDescription: 'Type, paste or open a plain-text file and turn it into a neatly paginated PDF with your choice of font and layout.',
    keywords: ['txt', 'notes', 'write', 'create', 'plain text'],
    mount(root) {
      const text = h('textarea', { placeholder: 'Type or paste your text here…\n\nBlank lines start new paragraphs.', 'aria-label': 'Document text', spellcheck: true, style: { minHeight: '420px' } });
      const title = h('input', { type: 'text', placeholder: 'Optional title' });
      const font = ui.select([['Helvetica', 'Sans-serif (Helvetica)'], ['Times', 'Serif (Times)'], ['Courier', 'Monospace (Courier)']], 'Helvetica');
      const size = ui.select([[10, '10 pt'], [11, '11 pt'], [12, '12 pt'], [14, '14 pt'], [16, '16 pt']], 12);
      const page = ui.segmented('pg', [['A4', 'A4'], ['Letter', 'Letter']], 'A4', 'Page size');
      const spacing = ui.segmented('sp', [['1.25', 'Compact'], ['1.45', 'Normal'], ['1.8', 'Relaxed']], '1.45', 'Line spacing');
      const pageNums = h('input', { type: 'checkbox', checked: true });
      const stats = h('span', { class: 'hint', 'aria-live': 'polite' });
      const result = h('div', { hidden: true, 'aria-live': 'polite' });
      const btn = h('button', { class: 'btn btn-lg', type: 'button', style: { width: '100%' }, onclick: build }, icon('download'), 'Create PDF');
      const opener = ui.dropzone({
        compact: true, title: 'Open a .txt file', subtitle: 'or drop it here', accept: '.txt,.md,.csv,.log,text/plain', icon: 'file-text',
        filter: (f) => /^text\//.test(f.type) || /\.(txt|md|csv|log|json|xml)$/i.test(f.name), rejectHint: 'choose a plain-text file',
        onFiles: async ([f]) => { text.value = await f.text(); if (!title.value) title.value = PS.util.baseName(f.name); updateStats(); },
      });
      const updateStats = () => { const t = text.value; stats.textContent = t ? `${t.trim().split(/\s+/).filter(Boolean).length} words · ${t.length} characters` : ''; };
      text.addEventListener('input', PS.util.debounce(updateStats, 200));

      const layout = PS.kit.twoColumn();
      layout.workspace.append(opener, h('section', { class: 'panel' },
        h('div', { class: 'list-toolbar', style: { marginBottom: '10px' } }, h('h2', null, 'Text'), stats), text), result);
      layout.options.append(
        PS.kit.panel('Document', ui.field('Title', title, 'Shown at the top of the first page and used as the file name.')),
        PS.kit.panel('Layout', ui.field('Font', font), ui.field('Font size', size), ui.field('Page size', page.el), ui.field('Line spacing', spacing.el),
          h('label', { class: 'check', style: { marginTop: '14px' } }, pageNums, 'Add page numbers')),
        h('div', null, btn));
      root.replaceChildren(layout.el);
      PS.app.setDropHandler((files) => opener._accept(files));

      async function build() {
        if (!text.value.trim()) { ui.toast('Please enter some text first.', 'error'); text.focus(); return; }
        const out = await ui.run('Creating PDF…', async () => {
          const doc = await PS.engine.createPdfLib();
          const [regularName, boldName] = FONTS[font.value];
          const regular = await doc.embedFont(global.PDFLib.StandardFonts[regularName]);
          const bold = await doc.embedFont(global.PDFLib.StandardFonts[boldName]);
          const fs = parseInt(size.value, 10);
          const lh = fs * parseFloat(spacing.value);
          const [pw, ph] = SIZES[page.value];
          const margin = 64;
          const maxW = pw - margin * 2;
          const [body, replaced] = sanitizeFor(regular, text.value.replace(/\r\n?/g, '\n'));
          const [heading] = sanitizeFor(bold, title.value.trim());
          let p = doc.addPage([pw, ph]);
          let y = ph - margin;
          const newPage = () => { p = doc.addPage([pw, ph]); y = ph - margin; };
          if (heading) {
            const hs = Math.round(fs * 1.7);
            for (const line of wrap(bold, hs, heading, maxW)) { p.drawText(line, { x: margin, y: y - hs, size: hs, font: bold }); y -= hs * 1.25; }
            y -= fs;
            doc.setTitle(heading);
          }
          const paragraphs = body.split('\n');
          for (const para of paragraphs) {
            const lines = para.trim() === '' ? [''] : wrap(regular, fs, para.replace(/\s+$/, ''), maxW);
            for (const line of lines) {
              if (y - lh < margin) newPage();
              if (line) p.drawText(line, { x: margin, y: y - fs, size: fs, font: regular });
              y -= lh;
            }
          }
          if (pageNums.checked && doc.getPageCount() > 1) {
            const n = doc.getPageCount();
            doc.getPages().forEach((pg, i) => {
              const label = `${i + 1} / ${n}`;
              pg.drawText(label, { x: (pw - regular.widthOfTextAtSize(label, 9)) / 2, y: margin / 2 - 3, size: 9, font: regular, color: global.PDFLib.rgb(0.45, 0.45, 0.45) });
            });
          }
          if (replaced) ui.toast(`${plural(replaced, 'character')} not supported by standard PDF fonts were replaced with “?”. For other scripts, use Word to PDF › Print.`, 'warning', { timeout: 9000 });
          return { blob: await PS.engine.saveToBlob(doc), pages: doc.getPageCount() };
        }, 'text');
        if (!out) return;
        ui.showResult(result, { blob: out.blob, filename: safeFileName((title.value.trim() || 'document').replace(/\s+/g, '_')) + '.pdf', detail: plural(out.pages, 'page') });
      }
      return null;
    },
  });
})(window);
