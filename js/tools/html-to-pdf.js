/**
 * Tool: HTML / Markdown → PDF
 * Write or drop Markdown (.md) or HTML (.html) and turn it into a PDF. Markdown is rendered
 * with marked (lazy-loaded); all HTML is sanitised first — scripts, event handlers, forms and
 * remote resources are removed, so nothing is executed or fetched.
 */
(function (global) {
  'use strict';
  const PS = global.PS;
  const { h, icon, baseName, loadScript, debounce } = PS.util;
  const ui = PS.ui;
  const isSource = (f) => /\.(md|markdown|mdown|html?|txt)$/i.test(f.name) || /^text\/(markdown|html|plain)/.test(f.type);
  const SAMPLE = '# My document\n\nWrite **Markdown** here — or drop a `.md` / `.html` file.\n\n## Features\n\n- Headings, lists and links\n- Tables, quotes and code\n\n| Item | Qty |\n|------|----:|\n| Apples | 3 |\n| Pears | 5 |\n\n> Everything is converted on your device.\n';

  PS.tools.register({
    id: 'html-to-pdf',
    name: 'HTML / Markdown to PDF',
    category: 'convert',
    icon: 'code',
    isNew: true,
    description: 'Turn Markdown or HTML into a clean PDF.',
    longDescription: 'Write or drop Markdown (.md) or HTML files and convert them to PDF with a live preview. Scripts and remote content are stripped, so nothing runs or loads from the internet.',
    keywords: ['markdown', 'md', 'html', 'web page', 'htm', 'readme', 'convert', 'notes'],
    mount(root) {
      let name = 'document';
      const libs = Promise.all([loadScript('vendor/marked.umd.js', 'marked'), PS.htmlpdf.loadLibs()]).catch((err) => { ui.reportError(err, 'html-to-pdf'); throw err; });
      const mode = ui.segmented('h2p-mode', [['md', 'Markdown'], ['html', 'HTML']], 'md', 'Input type');
      const src = h('textarea', { class: 'text-output', spellcheck: false, 'aria-label': 'Source', style: { minHeight: '320px' } });
      src.value = SAMPLE;
      const paper = h('article', { class: 'doc-paper', 'aria-label': 'Preview', style: { maxHeight: '640px', overflow: 'auto' } });
      const pageSize = ui.segmented('h2p-ps', [['a4', 'A4'], ['letter', 'Letter']], 'a4', 'Page size');
      const margin = ui.segmented('h2p-mg', [['36', 'Narrow'], ['56', 'Normal'], ['72', 'Wide']], '56', 'Margins');
      const result = h('div', { class: 'result-slot', hidden: true, 'aria-live': 'polite' });
      const picker = ui.dropzone({ title: 'Open a .md or .html file', subtitle: 'or drop it anywhere on this page', accept: '.md,.markdown,.html,.htm,.txt,text/markdown,text/html', filter: isSource, compact: true, icon: 'code', rejectHint: 'only .md, .html and .txt files', onFiles: ([f]) => open(f) });
      let html = '';

      async function render() {
        try {
          await libs;
          const raw = mode.value === 'md' ? global.marked.parse(src.value, { gfm: true, breaks: false }) : src.value;
          html = PS.htmlpdf.clean(raw);
          paper.innerHTML = html;
        } catch (err) { console.warn('render', err); }
      }
      const rerender = debounce(render, 200);
      src.addEventListener('input', rerender);
      mode.onChange(render);

      async function open(f) {
        try {
          const text = await f.text();
          src.value = text;
          name = baseName(f.name);
          const isHtml = /\.html?$/i.test(f.name) || /<\/?(html|body|div|p|h1|table)[\s>]/i.test(text.slice(0, 2000)) && !/\.(md|markdown)$/i.test(f.name);
          mode.el.querySelector(`input[value="${isHtml ? 'html' : 'md'}"]`).checked = true;
          await render();
          ui.toast(`Loaded ${f.name}`, 'success');
        } catch (err) { ui.reportError(err, 'html-to-pdf'); }
      }

      const layout = PS.kit.twoColumn();
      layout.workspace.append(
        picker,
        PS.kit.panel('Source', ui.field('Type', mode.el), src),
        PS.kit.panel('Preview', paper),
        result);
      layout.options.append(
        PS.kit.panel('Page setup', ui.field('Page size', pageSize.el), ui.field('Margins', margin.el)),
        PS.kit.panel('Export', h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
          h('button', { class: 'btn btn-lg', type: 'button', onclick: exportPdf }, icon('download'), 'Download PDF'),
          h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => { render().then(() => PS.htmlpdf.print(html, { size: pageSize.value, margin: +margin.value, title: name })); } }, icon('file-text'), 'Print / Save as PDF')),
        h('p', { class: 'hint', style: { marginTop: '10px' } }, '“Print / Save as PDF” gives the sharpest text and full Unicode support.')),
        ui.note('Scripts, forms, embedded frames and images from the internet are removed for your safety. Use images embedded as data URIs.'));
      root.replaceChildren(layout.el);
      PS.app.setDropHandler((files) => picker._accept(files));

      async function exportPdf() {
        await render();
        if (!paper.textContent.trim()) { ui.toast('There is nothing to convert yet.', 'warning'); return; }
        const blob = await ui.run('Creating PDF…', async () => { await libs; return PS.htmlpdf.exportPdf(html, { size: pageSize.value, margin: +margin.value, title: name, fontFamily: 'Helvetica, Arial, sans-serif' }); }, 'html-to-pdf');
        if (blob) ui.showResult(result, { blob, filename: name + '.pdf', detail: mode.value === 'md' ? 'Converted from Markdown' : 'Converted from HTML' });
      }
      render();
      return { destroy() {} };
    },
  });
})(window);
