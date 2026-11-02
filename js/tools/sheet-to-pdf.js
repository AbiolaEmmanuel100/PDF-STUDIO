/**
 * Tool: Excel / CSV → PDF
 * Reads .xlsx (Office Open XML, parsed here with fflate + DOMParser — no extra library),
 * .csv and .tsv files and lays the cells out as a paginated table PDF with repeated header
 * rows, gridlines and automatic fit-to-width.
 */
(function (global) {
  'use strict';
  const PS = global.PS;
  const { h, icon, baseName, plural } = PS.util;
  const ui = PS.ui;
  const isSheet = (f) => /\.(xlsx|xlsm|csv|tsv|txt)$/i.test(f.name);

  /* ------------------------------------------------------------ CSV */
  function parseCsv(text) {
    text = text.replace(/^\uFEFF/, '');
    const first = text.split(/\r?\n/, 1)[0] || '';
    const delim = ['\t', ';', ',', '|'].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
      } else if (c === '"' && cell === '') q = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((x) => x !== ''));
  }

  /* ----------------------------------------------------------- XLSX */
  const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
  function colIndex(ref) { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }
  function serialToDate(v, withTime) {
    const ms = Math.round((v - 25569) * 86400000);
    const d = new Date(ms);
    const iso = d.toISOString();
    return withTime && v % 1 ? iso.slice(0, 16).replace('T', ' ') : iso.slice(0, 10);
  }
  function parseXlsx(bytes) {
    const files = global.fflate.unzipSync(new Uint8Array(bytes));
    const dec = new TextDecoder();
    const xml = (p) => { const f = files[p]; return f ? new DOMParser().parseFromString(dec.decode(f), 'application/xml') : null; };
    const wb = xml('xl/workbook.xml');
    if (!wb) throw new Error('This doesn’t look like an Excel .xlsx file.');
    const rels = xml('xl/_rels/workbook.xml.rels');
    const relMap = {};
    if (rels) [...rels.getElementsByTagName('Relationship')].forEach((r) => { relMap[r.getAttribute('Id')] = r.getAttribute('Target'); });
    const ss = xml('xl/sharedStrings.xml');
    const shared = ss ? [...ss.getElementsByTagName('si')].map((si) => [...si.getElementsByTagName('t')].map((t) => t.textContent).join('')) : [];
    // date styles
    const st = xml('xl/styles.xml');
    const dateStyle = [];
    if (st) {
      const custom = {};
      [...st.getElementsByTagName('numFmt')].forEach((n) => { custom[n.getAttribute('numFmtId')] = n.getAttribute('formatCode') || ''; });
      const xfs = st.getElementsByTagName('cellXfs')[0];
      if (xfs) [...xfs.getElementsByTagName('xf')].forEach((xf, i) => {
        const id = +xf.getAttribute('numFmtId');
        const code = (custom[id] || '').replace(/"[^"]*"|\[[^\]]*\]/g, '');
        dateStyle[i] = BUILTIN_DATE.has(id) || (/[dmy]/i.test(code) && !/^[#0.,%\s]+$/.test(code)) ? (/h|s/i.test(code) || id === 22 ? 'datetime' : 'date') : null;
      });
    }
    const sheets = [...wb.getElementsByTagName('sheet')].map((s) => {
      const rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      let target = relMap[rid] || '';
      target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
      const doc = xml(target);
      const rows = [];
      if (doc) {
        for (const r of doc.getElementsByTagName('row')) {
          const ri = (+r.getAttribute('r') || rows.length + 1) - 1;
          const row = rows[ri] = rows[ri] || [];
          let auto = 0;
          for (const c of r.getElementsByTagName('c')) {
            const ref = c.getAttribute('r');
            const ci = ref ? colIndex(ref) : auto;
            auto = ci + 1;
            const t = c.getAttribute('t');
            const vEl = c.getElementsByTagName('v')[0];
            const v = vEl ? vEl.textContent : '';
            let val = '';
            if (t === 's') val = shared[+v] ?? '';
            else if (t === 'inlineStr') val = [...c.getElementsByTagName('t')].map((x) => x.textContent).join('');
            else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
            else if (t === 'str' || t === 'e') val = v;
            else if (v !== '') {
              const num = Number(v);
              const ds = dateStyle[+c.getAttribute('s') || 0];
              val = ds && Number.isFinite(num) ? serialToDate(num, ds === 'datetime') : String(+num.toPrecision(12));
            } else {
              const f = c.getElementsByTagName('f')[0];
              if (f) val = '=' + f.textContent; // formula without a cached result
            }
            row[ci] = val;
          }
        }
      }
      const width = Math.max(0, ...rows.filter(Boolean).map((r) => r.length));
      const out = [];
      for (let i = 0; i < rows.length; i++) { const r = rows[i] || []; out.push(Array.from({ length: width }, (_, k) => (r[k] == null ? '' : String(r[k])))); }
      // drop trailing empty rows
      while (out.length && out[out.length - 1].every((x) => !x)) out.pop();
      return { name: s.getAttribute('name') || 'Sheet', rows: out };
    });
    return sheets;
  }

  /* -------------------------------------------------------- Layout */
  async function buildPdf(sheets, o) {
    const L = global.PDFLib;
    const doc = await PS.engine.createPdfLib();
    const font = await doc.embedFont(L.StandardFonts.Helvetica);
    const bold = await doc.embedFont(L.StandardFonts.HelveticaBold);
    const SIZES = { a4: [595.28, 841.89], letter: [612, 792] };
    const fit = (f, text, size, maxW) => {
      if (f.widthOfTextAtSize(text, size) <= maxW) return text;
      let lo = 0, hi = text.length;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (f.widthOfTextAtSize(text.slice(0, mid) + '…', size) <= maxW) lo = mid; else hi = mid - 1; }
      return text.slice(0, lo) + '…';
    };
    const isNum = (s) => /^-?[\d,]*\.?\d+(e[+-]?\d+)?%?$/i.test(s.trim()) && s.trim() !== '';
    for (const sheet of sheets) {
      const rows = sheet.rows.map((r) => r.map((c) => PS.annots.sanitize(c.replace(/\s+/g, ' ').trim(), font)));
      if (!rows.length) continue;
      const ncol = Math.max(...rows.map((r) => r.length));
      const base = o.fontSize;
      const natural = Array.from({ length: ncol }, (_, ci) => Math.min(260, Math.max(18, ...rows.slice(0, 2000).map((r, ri) => ((ri === 0 && o.header) ? bold : font).widthOfTextAtSize(r[ci] || '', base) + 8))));
      const totalNat = natural.reduce((a, b) => a + b, 0);
      let [pw, ph] = SIZES[o.size];
      const margin = 36;
      let landscape = o.orientation === 'landscape' || (o.orientation === 'auto' && totalNat > pw - margin * 2);
      if (landscape) [pw, ph] = [ph, pw];
      const avail = pw - margin * 2;
      let fs = base, widths = natural.slice();
      if (totalNat > avail) {
        fs = Math.max(5, base * (avail / totalNat));
        const k = fs / base;
        widths = natural.map((w) => w * k);
        const tot = widths.reduce((a, b) => a + b, 0);
        if (tot > avail) widths = widths.map((w) => w * (avail / tot)); // at min font: shrink columns, truncate text
      }
      const rowH = fs * 1.55;
      const headerRow = o.header ? rows[0] : null;
      const body = o.header ? rows.slice(1) : rows;
      const titleH = o.title ? fs * 1.6 + 8 : 0;
      let page = null, y = 0, pageNo = 0;
      const tableW = widths.reduce((a, b) => a + b, 0);
      const newPage = () => {
        page = doc.addPage([pw, ph]);
        pageNo++;
        y = ph - margin;
        if (o.title) { page.drawText(fit(bold, `${sheet.name}${pageNo > 1 ? ' (continued)' : ''}`, fs * 1.4, avail), { x: margin, y: y - fs * 1.3, size: fs * 1.4, font: bold, color: L.rgb(0.1, 0.1, 0.12) }); y -= titleH; }
        if (headerRow) drawRow(headerRow, true, -1);
      };
      const drawRow = (r, isHead, idx) => {
        if (isHead) page.drawRectangle({ x: margin, y: y - rowH, width: tableW, height: rowH, color: L.rgb(0.9, 0.92, 0.96) });
        else if (o.zebra && idx % 2 === 1) page.drawRectangle({ x: margin, y: y - rowH, width: tableW, height: rowH, color: L.rgb(0.965, 0.97, 0.98) });
        let x = margin;
        widths.forEach((w, ci) => {
          const raw = r[ci] || '';
          const f = isHead ? bold : font;
          const text = fit(f, raw, fs, w - 6);
          const tw = f.widthOfTextAtSize(text, fs);
          const tx = !isHead && isNum(raw) ? x + w - 3 - tw : x + 3;
          if (text) page.drawText(text, { x: tx, y: y - rowH + fs * 0.45, size: fs, font: f, color: L.rgb(0.07, 0.07, 0.09) });
          if (o.grid) page.drawRectangle({ x, y: y - rowH, width: w, height: rowH, borderColor: L.rgb(0.75, 0.78, 0.83), borderWidth: 0.4 });
          x += w;
        });
        y -= rowH;
      };
      newPage();
      body.forEach((r, i) => {
        if (y - rowH < margin + 14) newPage();
        drawRow(r, false, i);
      });
    }
    // page numbers
    const pages = doc.getPages();
    pages.forEach((p, i) => { const t = `${i + 1} / ${pages.length}`; const w = font.widthOfTextAtSize(t, 8); p.drawText(t, { x: p.getWidth() / 2 - w / 2, y: 18, size: 8, font, color: L.rgb(0.45, 0.45, 0.5) }); });
    if (!pages.length) throw new Error('The spreadsheet is empty.');
    return PS.engine.saveToBlob(doc);
  }

  PS.tools.register({
    id: 'sheet-to-pdf',
    name: 'Excel / CSV to PDF',
    category: 'convert',
    icon: 'table',
    isNew: true,
    description: 'Convert spreadsheets (.xlsx, .csv) into printable PDF tables.',
    longDescription: 'Turn Excel workbooks (.xlsx) and CSV/TSV files into tidy PDF tables: header rows repeat on every page, wide sheets switch to landscape and shrink to fit, numbers are right-aligned.',
    keywords: ['excel', 'xlsx', 'spreadsheet', 'csv', 'tsv', 'table', 'sheet', 'convert', 'workbook'],
    mount(root) {
      let sheets = null, fileName = 'spreadsheet';
      function showDrop() {
        const zone = ui.dropzone({ title: 'Choose a spreadsheet', subtitle: '.xlsx, .csv or .tsv — or drop it here', accept: '.xlsx,.xlsm,.csv,.tsv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filter: isSheet, icon: 'table', rejectHint: 'only .xlsx, .csv and .tsv files (save .xls as .xlsx first)', onFiles: ([f]) => load(f) });
        root.replaceChildren(h('div', { class: 'tool-body single' }, zone));
        PS.app.setDropHandler((files) => zone._accept(files));
      }
      async function load(file) {
        const res = await ui.run('Reading spreadsheet…', async () => {
          if (/\.xls[xm]$/i.test(file.name)) return parseXlsx(await file.arrayBuffer());
          return [{ name: baseName(file.name), rows: parseCsv(await file.text()) }];
        }, 'sheet');
        if (!res) return;
        if (!res.some((s) => s.rows.length)) { ui.toast('The spreadsheet is empty.', 'warning'); return; }
        sheets = res; fileName = baseName(file.name);
        editor(file);
      }
      function editor(file) {
        const which = ui.select([['all', 'All sheets'], ...sheets.map((s, i) => [String(i), s.name])], sheets.length > 1 ? 'all' : '0');
        const orient = ui.segmented('sp-or', [['auto', 'Auto'], ['portrait', 'Portrait'], ['landscape', 'Landscape']], 'auto', 'Orientation');
        const size = ui.segmented('sp-sz', [['a4', 'A4'], ['letter', 'Letter']], 'a4', 'Page size');
        const fs = ui.range({ min: 6, max: 14, value: 9, format: (v) => v + ' pt', label: 'Font size' });
        const header = h('input', { type: 'checkbox', checked: true }), grid = h('input', { type: 'checkbox', checked: true }), zebra = h('input', { type: 'checkbox', checked: true }), title = h('input', { type: 'checkbox', checked: true });
        const table = h('div', { class: 'table-wrap' });
        const result = h('div', { class: 'result-slot', hidden: true, 'aria-live': 'polite' });
        const picker = ui.dropzone({ accept: '.xlsx,.xlsm,.csv,.tsv,.txt', filter: isSheet, onFiles: ([f]) => load(f) });
        const preview = () => {
          const s = sheets[which.value === 'all' ? 0 : +which.value];
          const rows = s.rows.slice(0, 60);
          table.replaceChildren(h('table', { class: 'data-table' }, ...rows.map((r, i) => h('tr', null, ...r.map((c) => h(i === 0 && header.checked ? 'th' : 'td', { title: c }, c))))));
        };
        which.addEventListener('change', preview); header.addEventListener('change', preview);
        const layout = PS.kit.twoColumn();
        const total = sheets.reduce((a, s) => a + s.rows.length, 0);
        layout.workspace.append(
          h('div', { class: 'panel', style: { padding: '12px 14px' } }, h('div', { class: 'list-toolbar' },
            h('div', null, h('div', { class: 'file-name' }, file.name), h('div', { class: 'file-sub' }, `${plural(sheets.length, 'sheet')} · ${plural(total, 'row')}`)),
            h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => picker.open() }, icon('refresh', 'icon-sm'), 'Change file'),
              h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close file', onclick: showDrop }, icon('x'))))),
          PS.kit.panel('Preview (first 60 rows)', table), result);
        layout.options.append(
          PS.kit.panel('Content', sheets.length > 1 ? ui.field('Sheets', which) : null,
            h('label', { class: 'check' }, header, 'First row is a header (repeat on each page)'),
            h('label', { class: 'check' }, title, 'Print sheet name as title')),
          PS.kit.panel('Layout', ui.field('Page size', size.el), ui.field('Orientation', orient.el), ui.field('Font size', fs, 'Shrinks automatically if the table is too wide.'),
            h('label', { class: 'check' }, grid, 'Gridlines'), h('label', { class: 'check' }, zebra, 'Shade alternate rows')),
          PS.kit.panel('Export', h('button', { class: 'btn btn-lg', type: 'button', style: { width: '100%' }, onclick: run }, icon('download'), 'Create PDF')));
        root.replaceChildren(layout.el);
        PS.app.setDropHandler((files) => picker._accept(files));
        preview();
        async function run() {
          const chosen = which.value === 'all' ? sheets : [sheets[+which.value]];
          const blob = await ui.run('Creating PDF…', () => buildPdf(chosen.filter((s) => s.rows.length), { size: size.value, orientation: orient.value, fontSize: +fs.input.value, header: header.checked, grid: grid.checked, zebra: zebra.checked, title: title.checked }), 'sheet');
          if (blob) ui.showResult(result, { blob, filename: fileName + '.pdf', detail: `${plural(chosen.length, 'sheet')} converted` });
        }
      }
      showDrop();
      return { destroy() { sheets = null; } };
    },
  });
  PS.sheets = { parseCsv, parseXlsx };
})(window);
