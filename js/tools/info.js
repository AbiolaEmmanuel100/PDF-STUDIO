/**
 * Tool: PDF info & text extraction
 * Shows document properties (version, page size, producer, dates, fonts/forms flags…),
 * page thumbnails, and extracts all text with line breaks preserved (copy or save as .txt).
 */
(function (global) {
  'use strict';
  const PS = global.PS;
  const { h, icon, baseName, formatBytes, plural } = PS.util;
  const ui = PS.ui;

  const PAPER = [['A3', 841.89, 1190.55], ['A4', 595.28, 841.89], ['A5', 419.53, 595.28], ['Letter', 612, 792], ['Legal', 612, 1008], ['Tabloid', 792, 1224]];
  function paperName(w, hgt) {
    const [a, b] = w < hgt ? [w, hgt] : [hgt, w];
    const m = PAPER.find(([, pw, ph]) => Math.abs(pw - a) < 3 && Math.abs(ph - b) < 3);
    const orient = w > hgt ? 'landscape' : 'portrait';
    const mm = (v) => Math.round((v / 72) * 25.4);
    return `${m ? m[0] + ' ' + orient + ' · ' : ''}${mm(w)} × ${mm(hgt)} mm (${(w / 72).toFixed(2)} × ${(hgt / 72).toFixed(2)} in)`;
  }
  function pdfDate(s) {
    if (!s) return '—';
    const d = global.pdfjsLib.PDFDateString ? global.pdfjsLib.PDFDateString.toDateObject(s) : null;
    return d ? PS.util.formatDate(d) : String(s);
  }

  PS.tools.register({
    id: 'info',
    name: 'Info & extract text',
    category: 'inspect',
    icon: 'eye',
    description: 'View properties, preview pages and extract all text.',
    longDescription: 'Inspect a PDF’s properties and pages, and extract its text to copy or save as a .txt file.',
    keywords: ['properties', 'text', 'ocr', 'copy', 'inspect', 'read', 'metadata', 'view'],
    mount(root) {
      return PS.kit.pdfTool(root, {
        dropTitle: 'Choose a PDF to inspect',
        async onLoad(handle, view) {
          const { info = {}, metadata } = await handle.pdfjs.getMetadata().catch(() => ({}));
          const first = await handle.pdfjs.getPage(1);
          const vp = first.getViewport({ scale: 1 });
          const rows = [
            ['File name', handle.name], ['File size', formatBytes(handle.size)], ['Pages', String(handle.pageCount)],
            ['Page size (p. 1)', paperName(vp.width, vp.height)], ['PDF version', info.PDFFormatVersion || '—'],
            ['Title', info.Title || metadata?.get?.('dc:title') || '—'], ['Author', info.Author || '—'], ['Subject', info.Subject || '—'],
            ['Keywords', info.Keywords || '—'], ['Creator', info.Creator || '—'], ['Producer', info.Producer || '—'],
            ['Created', pdfDate(info.CreationDate)], ['Modified', pdfDate(info.ModDate)],
            ['Fast web view', info.IsLinearized ? 'Yes' : 'No'], ['Interactive form', info.IsAcroFormPresent ? 'Yes' : 'No'],
            ['Encrypted', handle.encrypted ? 'Yes' : 'No'],
          ];
          const table = h('table', { class: 'meta-table' }, h('tbody', null, rows.map(([k, v]) => h('tr', null, h('th', { scope: 'row' }, k), h('td', null, String(v))))));
          const grid = PS.pageGrid({ sources: new Map([[handle.id, handle]]), items: PS.pageGrid.itemsFor(handle), selectable: false, label: 'Page previews', thumbWidth: 130 });
          const output = h('textarea', { class: 'text-output', readonly: true, 'aria-label': 'Extracted text', placeholder: 'Click “Extract text” to pull all text out of this PDF.' });
          const outStats = h('span', { class: 'hint', 'aria-live': 'polite' });
          const copyBtn = h('button', { class: 'btn btn-secondary btn-sm', type: 'button', disabled: true, onclick: copy }, icon('clipboard', 'icon-sm'), 'Copy');
          const saveBtn = h('button', { class: 'btn btn-secondary btn-sm', type: 'button', disabled: true, onclick: () => PS.util.download(new Blob([output.value], { type: 'text/plain;charset=utf-8' }), baseName(handle.name) + '.txt') }, icon('download', 'icon-sm'), 'Save .txt');
          const textPanel = h('section', { class: 'panel' },
            h('div', { class: 'list-toolbar', style: { marginBottom: '10px' } }, h('h2', null, 'Text'), outStats, h('div', { class: 'btn-row' }, copyBtn, saveBtn)),
            output);
          view.workspace.insertBefore(PS.kit.panel('Pages', grid.el), view.result);
          view.workspace.insertBefore(textPanel, view.result);
          view.options.append(PS.kit.panel('Properties', table),
            PS.kit.panel('Text', view.actionButton('Extract text', 'file-text', extract), h('p', { class: 'hint', style: { marginTop: '10px' } }, 'Scanned PDFs contain images of text, which can’t be extracted without OCR.')));

          async function extract() {
            const text = await ui.run('Extracting text…', async (busy) => {
              const parts = [];
              for (let i = 1; i <= handle.pageCount; i++) {
                if (i % 5 === 1) { busy.progress(i - 1, handle.pageCount); await PS.util.tick(); }
                const page = await handle.pdfjs.getPage(i);
                const content = await page.getTextContent();
                let s = '';
                for (const item of content.items) { s += item.str || ''; if (item.hasEOL) s += '\n'; }
                parts.push(`--- Page ${i} ---\n${s.replace(/[ \t]+\n/g, '\n').trim()}`);
                page.cleanup();
              }
              return parts.join('\n\n');
            }, 'info');
            if (text == null) return;
            const chars = text.replace(/--- Page \d+ ---/g, '').replace(/\s/g, '').length;
            output.value = chars ? text : '(No extractable text — this may be a scanned document.)';
            outStats.textContent = chars ? `${plural(chars, 'character')} from ${plural(handle.pageCount, 'page')}` : '';
            copyBtn.disabled = saveBtn.disabled = !chars;
            ui.toast(chars ? 'Text extracted.' : 'No text found in this PDF.', chars ? 'success' : 'warning');
            textPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
          async function copy() {
            try { await navigator.clipboard.writeText(output.value); ui.toast('Copied to clipboard.', 'success'); }
            catch (_) { output.select(); document.execCommand('copy'); ui.toast('Copied to clipboard.', 'success'); }
          }
          return () => grid.destroy();
        },
      });
    },
  });
})(window);
