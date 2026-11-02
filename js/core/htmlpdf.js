/**
 * PDF Studio — HTML → PDF pipeline (PS.htmlpdf)
 * Shared by Word → PDF and HTML/Markdown → PDF.
 *  - exportPdf(): jsPDF + html2canvas, fully automatic download
 *  - print():     the browser's own print engine ("Save as PDF"): best fidelity, selectable text
 * Libraries (~1 MB) are lazy-loaded on first use. sanitize() strips anything executable or
 * remote from untrusted HTML before it is shown (the CSP blocks it too — defence in depth).
 */
(function (global) {
  'use strict';
  const PS = global.PS;
  const { h, loadScript } = PS.util;
  const PAGE = { a4: { w: 595.28, h: 841.89, css: 'A4' }, letter: { w: 612, h: 792, css: 'letter' } };

  function loadLibs() {
    return Promise.all([loadScript('vendor/jspdf.umd.min.js', 'jspdf'), loadScript('vendor/html2canvas.min.js', 'html2canvas')]);
  }

  function sanitize(container) {
    container.querySelectorAll('script, iframe, frame, frameset, object, embed, link, meta, style, base, form, input, button, textarea, select, noscript, template, svg foreignObject').forEach((n) => n.remove());
    container.querySelectorAll('*').forEach((el) => {
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on') || name === 'srcset' || name === 'formaction' || name === 'background' || name === 'ping') el.removeAttribute(attr.name);
        else if ((name === 'href' || name === 'src' || name === 'xlink:href' || name === 'action') && /^\s*(javascript|vbscript|data:text\/html)/i.test(attr.value)) el.removeAttribute(attr.name);
        else if (name === 'style' && /url\s*\(|expression\s*\(/i.test(attr.value)) el.removeAttribute(attr.name);
      }
    });
    // Remote images would be a network request (and are blocked by the CSP): show their alt text instead.
    container.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src') || '';
      if (!/^(data:image\/|blob:)/i.test(src)) {
        const ph = img.ownerDocument.createElement('span');
        ph.className = 'img-placeholder';
        ph.textContent = `[image${img.alt ? ': ' + img.alt : ''}]`;
        img.replaceWith(ph);
      }
    });
    container.querySelectorAll('a[href]').forEach((a) => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
    return container;
  }

  /**
   * Parse untrusted HTML inertly (inside a <template>, where nothing loads or runs), sanitise it
   * there, and return the cleaned markup.
   */
  function clean(rawHtml) {
    const tpl = document.createElement('template');
    const body = /<body[\s>]/i.test(rawHtml) ? ((rawHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [null, rawHtml])[1]) : rawHtml;
    // Strip inline event handlers textually first: Chrome reports (blocks) them against the CSP
    // even while parsing into an inert template.
    let src = body.replace(/<script[\s\S]*?<\/script\s*>/gi, '');
    for (let prev = ''; prev !== src;) { prev = src; src = src.replace(/(<[^>]*?)\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '$1'); }
    tpl.innerHTML = src;
    sanitize(tpl.content);
    const box = tpl.content.ownerDocument.createElement('div');
    box.append(tpl.content);
    return box.innerHTML;
  }

  async function exportPdf(html, { size = 'a4', margin = 56, title = 'document', fontFamily = 'Georgia, "Times New Roman", serif' } = {}) {
    await loadLibs();
    const page = PAGE[size];
    const contentW = page.w - margin * 2;
    const windowWidth = 720; // CSS px the document is laid out at before scaling to the page
    const { jsPDF } = global.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: size, compress: true });
    const node = h('div', { html, style: { width: windowWidth + 'px', background: '#fff', color: '#111', fontFamily, fontSize: '16px', lineHeight: '1.55' } });
    node.querySelectorAll('img').forEach((img) => { img.style.maxWidth = '100%'; img.style.height = 'auto'; });
    node.querySelectorAll('table').forEach((t) => { t.style.borderCollapse = 'collapse'; t.style.width = '100%'; });
    node.querySelectorAll('td, th').forEach((c) => { c.style.border = '1px solid #999'; c.style.padding = '4px 6px'; });
    node.querySelectorAll('p').forEach((p) => { p.style.margin = '0 0 10px'; });
    node.querySelectorAll('pre, code').forEach((c) => { c.style.fontFamily = 'Courier, monospace'; c.style.background = '#f3f4f6'; });
    node.querySelectorAll('pre').forEach((c) => { c.style.padding = '8px'; c.style.whiteSpace = 'pre-wrap'; });
    node.querySelectorAll('blockquote').forEach((c) => { c.style.borderLeft = '4px solid #ccc'; c.style.margin = '0 0 10px'; c.style.padding = '2px 12px'; c.style.color = '#444'; });
    await doc.html(node, {
      x: margin, y: margin, width: contentW, windowWidth,
      margin: [margin, margin, margin, margin],
      autoPaging: 'text',
      html2canvas: { scale: 1, logging: false, useCORS: false, backgroundColor: '#ffffff' },
    });
    doc.setProperties({ title, creator: 'PDF Studio' });
    return doc.output('blob');
  }

  function print(html, { size = 'a4', margin = 56, title = 'document' } = {}) {
    const rootEl = document.getElementById('print-root');
    rootEl.replaceChildren(h('style', null, `@page { size: ${PAGE[size].css}; margin: ${margin}pt; }`), h('article', { class: 'doc-paper', html }));
    document.body.classList.add('print-doc');
    const done = () => { document.body.classList.remove('print-doc'); rootEl.replaceChildren(); global.removeEventListener('afterprint', done); };
    global.addEventListener('afterprint', done);
    const prevTitle = document.title;
    document.title = title; // becomes the default PDF file name
    try { global.print(); } finally { document.title = prevTitle; }
  }

  PS.htmlpdf = { PAGE, loadLibs, sanitize, clean, exportPdf, print };
})(window);
