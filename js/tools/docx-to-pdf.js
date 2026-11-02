/**
 * Tool: Word (DOCX) → PDF
 * mammoth.js converts the .docx to clean HTML; the PDF is then produced either by
 *  - jsPDF + html2canvas ("Download PDF", fully automatic), or
 *  - the browser's own print engine ("Print / Save as PDF", best fidelity & selectable text).
 * The three libraries (~1.2 MB) are lazy-loaded the first time this tool is opened.
 */
(function (global) {
  'use strict';
  const PS = global.PS;
  const { h, icon, baseName, isDocx, loadScript, formatBytes } = PS.util;
  const ui = PS.ui;

  function loadLibs() {
    return Promise.all([loadScript('vendor/mammoth.browser.min.js', 'mammoth'), PS.htmlpdf.loadLibs()]);
  }

  PS.tools.register({
    id: 'docx-to-pdf',
    name: 'Word to PDF',
    category: 'convert',
    icon: 'file-word',
    description: 'Convert .docx documents to PDF.',
    longDescription: 'Convert Microsoft Word (.docx) documents to PDF. Headings, lists, tables, links and images are preserved; complex layouts are simplified.',
    keywords: ['docx', 'word', 'doc to pdf', 'microsoft', 'convert'],
    mount(root) {
      let html = '';
      let fileName = 'document';
      const libs = loadLibs().catch((err) => { ui.reportError(err, 'docx'); throw err; });

      function showDrop() {
        const zone = ui.dropzone({
          title: 'Choose a Word document', subtitle: '.docx files — or drop one here', accept: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          filter: isDocx, rejectHint: 'only .docx files are supported (save older .doc files as .docx first)', icon: 'file-word', onFiles: ([f]) => load(f),
        });
        root.replaceChildren(h('div', { class: 'tool-body single' }, zone));
        PS.app.setDropHandler((files) => zone._accept(files));
      }

      async function load(file) {
        const res = await ui.run('Reading document…', async () => {
          await libs;
          const arrayBuffer = await file.arrayBuffer();
          return global.mammoth.convertToHtml({ arrayBuffer });
        }, 'docx');
        if (!res) return;
        fileName = baseName(file.name);
        html = PS.htmlpdf.clean(res.value || '');
        const tmp = document.createElement('template');
        tmp.innerHTML = html;
        const textCheck = tmp.content;
        if (!textCheck.textContent.trim() && !textCheck.querySelector('img')) ui.toast('The document appears to be empty.', 'warning');
        buildEditor(file, res.messages || []);
      }

      function buildEditor(file, messages) {
        const paper = h('article', { class: 'doc-paper', 'aria-label': 'Document preview', html });
        const pageSize = ui.segmented('ps', [['a4', 'A4'], ['letter', 'Letter']], 'a4', 'Page size');
        const margin = ui.segmented('mg', [['36', 'Narrow'], ['56', 'Normal'], ['72', 'Wide']], '56', 'Margins');
        const result = h('div', { hidden: true, 'aria-live': 'polite' });
        const picker = ui.dropzone({ accept: '.docx', filter: isDocx, onFiles: ([f]) => load(f) });
        const layout = PS.kit.twoColumn();
        layout.workspace.append(
          h('div', { class: 'panel', style: { padding: '12px 14px' } },
            h('div', { class: 'list-toolbar' },
              h('div', null, h('div', { class: 'file-name' }, file.name), h('div', { class: 'file-sub' }, formatBytes(file.size) + (messages.length ? ` · ${messages.length} formatting note(s)` : ''))),
              h('div', { class: 'btn-row' },
                h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => picker.open() }, icon('refresh', 'icon-sm'), 'Change file'),
                h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close file', onclick: showDrop }, icon('x'))))),
          paper, result);
        layout.options.append(
          PS.kit.panel('Page setup', ui.field('Page size', pageSize.el), ui.field('Margins', margin.el)),
          PS.kit.panel('Export',
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
              h('button', { class: 'btn btn-lg', type: 'button', onclick: () => exportPdf(pageSize.value, parseInt(margin.value, 10), result) }, icon('download'), 'Download PDF'),
              h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => printPdf(pageSize.value, parseInt(margin.value, 10)) }, icon('file-text'), 'Print / Save as PDF')),
            h('p', { class: 'hint', style: { marginTop: '10px' } }, '“Print / Save as PDF” uses your browser’s print engine: sharpest output, selectable text and full Unicode support. Choose “Save as PDF” as the printer.')),
          ui.note('Word features such as headers/footers, text boxes and exact fonts are simplified. For pixel-perfect conversions use LibreOffice or Word itself.'));
        root.replaceChildren(layout.el);
        PS.app.setDropHandler((files) => picker._accept(files));
      }

      async function exportPdf(size, margin, result) {
        const blob = await ui.run('Creating PDF…', async () => { await libs; return PS.htmlpdf.exportPdf(html, { size, margin, title: fileName }); }, 'docx-export');
        if (blob) ui.showResult(result, { blob, filename: fileName + '.pdf', detail: 'Converted from Word' });
      }

      function printPdf(size, margin) { PS.htmlpdf.print(html, { size, margin, title: fileName }); }

      showDrop();
      return { destroy() { html = ''; } };
    },
  });
})(window);
