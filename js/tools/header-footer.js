/**
 * Tool: Header & footer (with Bates numbering)
 * Six text slots (left / centre / right, top and bottom) with tokens for page numbers, dates,
 * the file name and Bates numbers — the same model as Acrobat's “Add Header & Footer” and
 * “Bates Numbering”. Placed relative to the page as displayed, so rotated pages work.
 */
(function (global) {
  'use strict';
  const PS = global.PS;
  const { h, plural, baseName, hexToRgb01, debounce } = PS.util;
  const ui = PS.ui;
  const SLOTS = [['tl', 'Top left'], ['tc', 'Top centre'], ['tr', 'Top right'], ['bl', 'Bottom left'], ['bc', 'Bottom centre'], ['br', 'Bottom right']];
  const FONTS = [['Helvetica', 'Helvetica'], ['TimesRoman', 'Times'], ['Courier', 'Courier'], ['HelveticaBold', 'Helvetica Bold']];
  const CSS_FONT = { Helvetica: '{size} Helvetica, Arial, sans-serif', TimesRoman: '{size} "Times New Roman", Times, serif', Courier: '{size} "Courier New", Courier, monospace', HelveticaBold: 'bold {size} Helvetica, Arial, sans-serif' };

  PS.tools.register({
    id: 'header-footer',
    name: 'Header & footer',
    category: 'edit',
    icon: 'header',
    isNew: true,
    description: 'Add headers, footers and Bates numbers to every page.',
    longDescription: 'Add text to the top and bottom of pages — left, centre or right — with page numbers, dates, the file name and Bates numbers for legal documents.',
    keywords: ['header', 'footer', 'bates', 'bates numbering', 'legal', 'stamp', 'page x of y', 'date', 'running head'],
    mount(root) {
      return PS.kit.pdfTool(root, {
        dropTitle: 'Choose a PDF',
        async onLoad(handle, view) {
          const scratch = await global.PDFLib.PDFDocument.create();
          const measure = {};
          for (const [k] of FONTS) measure[k] = await scratch.embedFont(global.PDFLib.StandardFonts[k]);
          const slots = Object.fromEntries(SLOTS.map(([k, l]) => [k, h('input', { type: 'text', 'aria-label': l, placeholder: l, spellcheck: false })]));
          slots.bc.value = 'Page {page} of {pages}';
          const font = ui.select(FONTS, 'Helvetica');
          const size = ui.range({ min: 6, max: 24, value: 10, format: (v) => v + ' pt', label: 'Font size' });
          const color = h('input', { type: 'color', value: '#333333', 'aria-label': 'Text colour' });
          const margin = ui.range({ min: 10, max: 72, value: 24, format: (v) => v + ' pt', label: 'Distance from edge' });
          const bPrefix = h('input', { type: 'text', value: 'ABC', 'aria-label': 'Bates prefix' });
          const bStart = h('input', { type: 'number', value: 1, min: 0, 'aria-label': 'Bates start number' });
          const bDigits = h('input', { type: 'number', value: 6, min: 1, max: 12, 'aria-label': 'Bates digits' });
          const bSuffix = h('input', { type: 'text', value: '', 'aria-label': 'Bates suffix' });
          const startPage = h('input', { type: 'number', value: 1, min: 0, 'aria-label': 'First page number' });
          const pages = PS.stamp.pagePicker(handle.pageCount);
          const btn = view.actionButton('Add header & footer', 'header', run);
          const today = new Date();
          const dateStr = today.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
          const fname = baseName(handle.name);

          function bates(k) {
            const n = (parseInt(bStart.value, 10) || 0) + k;
            return `${bPrefix.value}${String(n).padStart(Math.min(12, Math.max(1, parseInt(bDigits.value, 10) || 6)), '0')}${bSuffix.value}`;
          }
          function expand(tpl, pageIndex, k, total) {
            const first = parseInt(startPage.value, 10);
            const pn = (Number.isFinite(first) ? first : 1) + k;
            return tpl.replace(/\{page\}/g, String(pn)).replace(/\{pages\}/g, String((Number.isFinite(first) ? first : 1) - 1 + total))
              .replace(/\{date\}/g, dateStr).replace(/\{file\}/g, fname).replace(/\{bates\}/g, bates(k)).replace(/\{n\}/g, String(pageIndex + 1));
          }
          function targets() { try { return pages.indices(); } catch (_) { return []; } }
          function placements(W, H, pageIndex, list) {
            const k = list.indexOf(pageIndex);
            if (k < 0) return [];
            const fs = +size.input.value, mg = +margin.input.value, f = measure[font.value];
            const out = [];
            for (const [key] of SLOTS) {
              const tpl = slots[key].value;
              if (!tpl.trim()) continue;
              const text = PS.annots.sanitize(expand(tpl, pageIndex, k, list.length), f);
              const w = f.widthOfTextAtSize(text, fs);
              const dx = key[1] === 'l' ? mg : key[1] === 'r' ? W - mg - w : (W - w) / 2;
              const dy = key[0] === 't' ? mg + fs * 0.75 : H - mg;
              out.push({ text, dx, dy });
            }
            return out;
          }

          const preview = PS.stamp.previewer(handle, (ctx, info) => {
            const fs = +size.input.value;
            placements(info.W, info.H, info.page - 1, targets()).forEach((p) =>
              PS.stamp.canvasText(ctx, p.text, { dx: p.dx, dy: p.dy, size: fs, cssFont: CSS_FONT[font.value], color: color.value, opacity: 1, angle: 0 }));
          });
          const refresh = debounce(() => preview.refresh(), 30);
          [...Object.values(slots), font, size.input, color, margin.input, bPrefix, bStart, bDigits, bSuffix, startPage, pages.mode, pages.custom]
            .forEach((el) => { el.addEventListener('input', refresh); el.addEventListener('change', refresh); });

          const tokenBtn = (tok, label) => h('button', { class: 'chip', type: 'button', title: 'Insert ' + tok, onmousedown: (e) => e.preventDefault(), onclick: () => insertToken(tok) }, label);
          let lastFocus = slots.bc;
          Object.values(slots).forEach((s) => s.addEventListener('focus', () => { lastFocus = s; }));
          function insertToken(tok) {
            const s = lastFocus;
            const a = s.selectionStart ?? s.value.length, b = s.selectionEnd ?? s.value.length;
            s.value = s.value.slice(0, a) + tok + s.value.slice(b);
            s.focus(); s.setSelectionRange(a + tok.length, a + tok.length);
            refresh();
          }

          view.workspace.insertBefore(PS.kit.panel('Text',
            h('div', { class: 'hf-grid' }, slots.tl, slots.tc, slots.tr), h('div', { class: 'hf-grid', style: { marginTop: '8px' } }, slots.bl, slots.bc, slots.br),
            h('div', { class: 'chip-row', style: { marginTop: '10px' } }, h('span', { class: 'hint' }, 'Insert:'),
              tokenBtn('{page}', 'Page number'), tokenBtn('{pages}', 'Total pages'), tokenBtn('{date}', 'Date'), tokenBtn('{file}', 'File name'), tokenBtn('{bates}', 'Bates number'))), view.result);
          view.workspace.insertBefore(preview.el, view.result);
          view.options.append(
            PS.kit.panel('Appearance', ui.field('Font', font), ui.field('Font size', size), ui.field('Distance from edge', margin), ui.field('Colour', color)),
            PS.kit.panel('Numbering', ui.field('First page number', startPage),
              h('div', { class: 'field-row' }, ui.field('Bates prefix', bPrefix), ui.field('Suffix', bSuffix)),
              h('div', { class: 'field-row' }, ui.field('Start at', bStart), ui.field('Digits', bDigits)),
              h('p', { class: 'hint' }, 'Use {bates} in any slot to stamp Bates numbers.')),
            PS.kit.panel('Pages', pages.el, h('div', { style: { marginTop: '16px' } }, btn)));

          async function run() {
            let list;
            try { list = pages.indices(); } catch (err) { ui.toast(err.message, 'error'); return; }
            if (!Object.values(slots).some((s) => s.value.trim())) { ui.toast('Type some header or footer text first.', 'warning'); slots.bc.focus(); return; }
            const blob = await ui.run('Adding header & footer…', async (busy) => {
              const doc = await PS.engine.loadPdfLib(handle.bytes);
              const f = await doc.embedFont(global.PDFLib.StandardFonts[font.value]);
              const [r, g, b] = hexToRgb01(color.value);
              const fs = +size.input.value;
              const all = doc.getPages();
              for (let k = 0; k < list.length; k++) {
                if (k % 25 === 0) { busy.progress(k, list.length); await PS.util.tick(); }
                const page = all[list[k]];
                const box = PS.engine.displayBox(page);
                placements(box.width, box.height, list[k], list).forEach((p) =>
                  PS.engine.drawTextDisplay(page, p.text, { dx: p.dx, dy: p.dy, size: fs, font: f, color: global.PDFLib.rgb(r, g, b) }));
              }
              return PS.engine.saveToBlob(doc);
            }, 'header-footer');
            const usesBates = Object.values(slots).some((s) => s.value.includes('{bates}'));
            if (blob) ui.showResult(view.result, { blob, filename: `${fname}_${usesBates ? 'bates' : 'header-footer'}.pdf`, detail: `${plural(list.length, 'page')}` + (usesBates ? ` · Bates ${bates(0)} – ${bates(list.length - 1)}` : '') });
          }
          return () => preview.destroy();
        },
      });
    },
  });
})(window);
