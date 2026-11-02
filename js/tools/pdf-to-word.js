/**
 * Tool: PDF to Word / HTML / text
 * Rebuilds an editable document from the PDF's text: lines are joined into paragraphs,
 * larger text becomes headings, bold/italic is kept, and each PDF page starts a new page.
 * The .docx is written directly (Office Open XML + fflate), so no server or Office install
 * is involved. Scanned PDFs need OCR first. Images, tables and exact layout aren't recreated.
 */
(function (global) {
  'use strict';
  const PS = global.PS;
  const { h, icon, baseName, plural } = PS.util;
  const ui = PS.ui;

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // XML 1.0 forbids most control characters
  const clean = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '');

  /** Extract [{page, blocks:[{kind:'h1'|'h2'|'h3'|'p'|'li', spans:[{text,b,i,size}]}]}] */
  async function extract(handle, busy) {
    const pages = [];
    const hist = new Map();
    let pageSize = null;
    for (let n = 1; n <= handle.pageCount; n++) {
      busy.progress(n - 1, handle.pageCount, `Reading page ${n}`);
      const page = await handle.pdfjs.getPage(n);
      if (!pageSize) { const vp = page.getViewport({ scale: 1 }); pageSize = [vp.width, vp.height]; }
      try { await page.getOperatorList(); } catch (_) { /* fonts may stay unknown */ }
      const geo = await PS.textgeo.page(handle.pdfjs, n);
      const vp = page.getViewport({ scale: 1 });
      const lines = PS.textgeo.lines(geo).map((l) => {
        const [left, top, w, hh] = PS.textgeo.quadToViewport(vp, l.quad);
        const fontInfo = (run) => {
          let name = '';
          try { const f = page.commonObjs.get(run.fontName); name = (f && f.name) || ''; } catch (_) { /* not loaded */ }
          return { b: /bold|black|heavy|semibold|demi/i.test(name), i: /italic|oblique/i.test(name) };
        };
        const spans = l.runs.map((run, k) => {
          const nextStart = k + 1 < l.runs.length ? l.runs[k + 1].start : run.end;
          return Object.assign({ text: geo.text.slice(run.start, nextStart).replace(/\n/g, ' ') }, fontInfo(run));
        });
        return { text: l.text, size: l.size, left, top, bottom: top + hh, width: w, spans };
      });
      lines.forEach((l) => { const s = Math.round(l.size * 2) / 2; hist.set(s, (hist.get(s) || 0) + l.text.length); });
      pages.push({ n, lines });
      page.cleanup();
    }
    const body = hist.size ? [...hist.entries()].sort((a, b) => b[1] - a[1])[0][0] : 11;
    const bullet = /^\s*([•●▪◦‣\-–*]|\d{1,3}[.)]|[a-z][.)])\s+/;
    for (const p of pages) {
      const blocks = [];
      let cur = null;
      p.lines.forEach((l, i) => {
        const kind = l.size >= body * 1.6 ? 'h1' : l.size >= body * 1.25 ? 'h2' : (l.spans.every((s) => s.b || !s.text.trim()) && l.text.length < 90 && l.size >= body * 0.95 && /[A-Za-z]/.test(l.text)) ? 'h3' : bullet.test(l.text) ? 'li' : 'p';
        const prev = i > 0 ? p.lines[i - 1] : null;
        const gap = prev ? l.top - prev.bottom : Infinity;
        const canJoin = cur && prev && kind !== 'h3' && cur.kind !== 'h3' && kind !== 'li' && (cur.kind === kind || (cur.kind === 'li' && kind === 'p'));
        const continues = canJoin && Math.abs(l.size - prev.size) < 0.6 && gap > -l.size * 0.5 && gap < l.size * 0.5;
        if (continues) {
          const last = cur.spans[cur.spans.length - 1];
          if (/-$/.test(last.text.trimEnd()) && /^[a-z]/.test(l.text)) last.text = last.text.trimEnd().slice(0, -1);
          else if (!/\s$/.test(last.text)) last.text += ' ';
          cur.spans.push(...l.spans);
        } else {
          cur = { kind, size: l.size, spans: l.spans.map((s) => Object.assign({}, s)) };
          blocks.push(cur);
        }
      });
      p.blocks = blocks;
    }
    return { pages, body, pageSize: pageSize || [595, 842] };
  }

  function mergeSpans(spans) {
    const out = [];
    for (const s of spans) {
      const last = out[out.length - 1];
      if (last && last.b === s.b && last.i === s.i) last.text += s.text; else out.push(Object.assign({}, s));
    }
    if (out.length) out[out.length - 1].text = out[out.length - 1].text.replace(/\s+$/, '');
    return out.filter((s) => s.text);
  }

  function toDocx(doc, title) {
    const enc = (s) => new TextEncoder().encode(s);
    const STYLE = { h1: 'Heading1', h2: 'Heading2', h3: 'Heading3', li: 'ListParagraph', p: null };
    let body = '';
    doc.pages.forEach((p, pi) => {
      p.blocks.forEach((b) => {
        const st = STYLE[b.kind];
        const ppr = st ? `<w:pPr><w:pStyle w:val="${st}"/></w:pPr>` : '';
        const runs = mergeSpans(b.spans).map((s) => {
          const rpr = (s.b && b.kind === 'p' ? '<w:b/>' : '') + (s.i ? '<w:i/>' : '');
          return `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(clean(s.text))}</w:t></w:r>`;
        }).join('');
        body += `<w:p>${ppr}${runs}</w:p>`;
      });
      if (pi < doc.pages.length - 1) body += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    });
    const [pw, ph] = doc.pageSize.map((v) => Math.round(v * 20));
    const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    const half = Math.round(doc.body * 2);
    const files = {
      '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>',
      '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
      'word/_rels/document.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
      'docProps/core.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dc:creator>PDF Studio</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>`,
      'word/styles.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="${half}"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`
        + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
        + `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="${Math.max(32, half * 2)}"/></w:rPr></w:style>`
        + `<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="${Math.max(26, Math.round(half * 1.5))}"/></w:rPr></w:style>`
        + `<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="160" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>`
        + '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/><w:ind w:left="360"/></w:pPr></w:style></w:styles>',
      'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}<w:sectPr><w:pgSz w:w="${pw}" w:h="${ph}"${pw > ph ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`,
    };
    const zipped = global.fflate.zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, enc(v)])), { level: 6 });
    return new Blob([zipped], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  function toHtml(doc, title) {
    const TAG = { h1: 'h1', h2: 'h2', h3: 'h3', li: 'p class="li"', p: 'p' };
    const parts = doc.pages.map((p) => `<section class="page" id="page-${p.n}">\n` + p.blocks.map((b) => {
      const inner = mergeSpans(b.spans).map((s) => { let t = esc(s.text); if (s.i) t = `<em>${t}</em>`; if (s.b && b.kind === 'p') t = `<strong>${t}</strong>`; return t; }).join('');
      const tag = TAG[b.kind];
      return `<${tag}>${inner}</${tag.split(' ')[0]}>`;
    }).join('\n') + '\n</section>');
    return new Blob([`<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>body{font:16px/1.6 Georgia,serif;max-width:760px;margin:40px auto;padding:0 20px;color:#111}h1,h2,h3{font-family:system-ui,sans-serif;line-height:1.25}.page+.page{border-top:1px dashed #ccc;margin-top:32px;padding-top:24px}.li{margin:4px 0 4px 24px}</style></head>
<body>\n${parts.join('\n')}\n</body></html>\n`], { type: 'text/html;charset=utf-8' });
  }

  function toText(doc) {
    return new Blob([doc.pages.map((p) => p.blocks.map((b) => mergeSpans(b.spans).map((s) => s.text).join('')).join('\n\n')).join('\n\n\f\n')], { type: 'text/plain;charset=utf-8' });
  }

  PS.tools.register({
    id: 'pdf-to-word',
    name: 'PDF to Word',
    category: 'convert',
    icon: 'file-word',
    isNew: true,
    description: 'Convert a PDF to an editable Word (.docx), HTML or text file.',
    longDescription: 'Turn a PDF into an editable Word document: paragraphs are rebuilt, headings and bold/italic text are kept, and each page starts on a new page. Also exports HTML or plain text.',
    keywords: ['docx', 'word', 'pdf to doc', 'pdf to docx', 'editable', 'html', 'txt', 'export', 'convert'],
    mount(root) {
      return PS.kit.pdfTool(root, {
        dropTitle: 'Choose a PDF to convert',
        async onLoad(handle, view) {
          const fmt = ui.segmented('p2w-fmt', [['docx', 'Word (.docx)'], ['html', 'HTML'], ['txt', 'Text']], 'docx', 'Output format');
          const btn = view.actionButton('Convert', 'download', run);
          const previewPanel = PS.kit.panel('Preview', h('p', { class: 'hint' }, 'Reading the document…'));
          view.workspace.insertBefore(previewPanel, view.result);
          view.options.append(PS.kit.panel('Output', ui.field('Format', fmt.el), h('div', { style: { marginTop: '14px' } }, btn)),
            ui.note('Text, paragraphs, headings and bold/italic are converted. Images, tables, columns and exact positions are not recreated. Scanned PDFs need OCR first.'));
          let doc = null;
          async function ensure() {
            if (doc) return doc;
            doc = await ui.run('Analysing document…', (busy) => extract(handle, busy), 'pdf-to-word');
            return doc;
          }
          const d = await ensure();
          if (!d) return;
          const words = d.pages.reduce((s, p) => s + p.blocks.reduce((t, b) => t + b.spans.reduce((u, sp) => u + (sp.text.match(/\S+/g) || []).length, 0), 0), 0);
          if (!words) { previewPanel.replaceChildren(h('h2', null, 'Preview'), ui.note('This PDF has no text layer — it is probably a scan. Run “OCR (searchable PDF)” first, then convert the result.', 'warn')); btn.disabled = true; return; }
          const art = h('article', { class: 'doc-paper', style: { maxHeight: '560px', overflow: 'auto' } });
          d.pages.slice(0, 3).forEach((p) => p.blocks.forEach((b) => {
            const tag = b.kind === 'li' ? 'p' : b.kind;
            art.append(h(tag, b.kind === 'li' ? { style: { marginLeft: '20px' } } : null, ...mergeSpans(b.spans).map((s) => (s.b && b.kind === 'p' ? h('strong', null, s.text) : s.i ? h('em', null, s.text) : s.text))));
          }));
          previewPanel.replaceChildren(h('h2', null, `Preview${d.pages.length > 3 ? ' (first 3 pages)' : ''}`), h('p', { class: 'hint' }, `${plural(words, 'word')} · ${plural(d.pages.reduce((s, p) => s + p.blocks.filter((b) => b.kind[0] === 'h').length, 0), 'heading')} detected`), art);

          async function run() {
            const dd = await ensure();
            if (!dd) return;
            const name = baseName(handle.name);
            const out = fmt.value === 'docx' ? toDocx(dd, name) : fmt.value === 'html' ? toHtml(dd, name) : toText(dd);
            ui.showResult(view.result, { blob: out, filename: `${name}.${fmt.value}`, detail: `${plural(dd.pages.length, 'page')} converted` });
          }
        },
      });
    },
  });
  PS.pdfToDoc = { extract, toDocx, toHtml, toText };
})(window);
