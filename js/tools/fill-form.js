/**
 * Tool: Fill form
 * Fill in interactive PDF forms (AcroForm): text fields, checkboxes, radio buttons, dropdowns
 * and list boxes are overlaid on the page as real inputs. Values are written back with
 * pdf-lib (appearances regenerated) and can optionally be flattened into the page.
 */
(function (global) {
  'use strict';
  const PS = global.PS;
  const { h, icon, baseName, plural } = PS.util;
  const ui = PS.ui;

  PS.tools.register({
    id: 'fill-form',
    name: 'Fill form',
    category: 'edit',
    icon: 'form',
    isNew: true,
    description: 'Fill in PDF forms: text fields, checkboxes, radio buttons, dropdowns.',
    longDescription: 'Type into fillable PDF forms right on the page — text fields, checkboxes, radio buttons, dropdowns and lists — then save the filled PDF, optionally flattened so it can’t be changed.',
    keywords: ['acroform', 'fillable', 'fill and sign', 'form filler', 'checkbox', 'flatten', 'fields'],
    mount(root) {
      return PS.kit.pdfTool(root, {
        dropTitle: 'Choose a PDF form to fill',
        async onLoad(handle, view) {
          view.workspace.parentElement.classList.add('viewer-tool');
          const values = new Map();     // fieldName -> value (string | boolean | string[])
          const widgets = [];           // {page, ann}
          const inputs = new Map();     // fieldName -> [elements]
          for (let n = 1; n <= handle.pageCount; n++) {
            const page = await handle.pdfjs.getPage(n);
            const anns = await page.getAnnotations({ intent: 'display' });
            anns.filter((a) => a.subtype === 'Widget' && a.fieldName && !a.hidden).forEach((a) => widgets.push({ page: n, ann: a }));
          }
          const fieldNames = [...new Set(widgets.filter((w) => w.ann.fieldType !== 'Sig' && !w.ann.pushButton).map((w) => w.ann.fieldName))];
          // initial values
          widgets.forEach(({ ann }) => {
            if (values.has(ann.fieldName)) return;
            if (ann.checkBox) values.set(ann.fieldName, ann.fieldValue && ann.fieldValue !== 'Off' ? ann.fieldValue : 'Off');
            else if (ann.radioButton) values.set(ann.fieldName, ann.fieldValue && ann.fieldValue !== 'Off' ? ann.fieldValue : 'Off');
            else if (ann.fieldType === 'Ch') values.set(ann.fieldName, Array.isArray(ann.fieldValue) ? ann.fieldValue : ann.fieldValue ? [ann.fieldValue] : []);
            else values.set(ann.fieldName, ann.fieldValue || '');
          });

          // Radio groups with /Opt use index export values ("0", "1"…); get readable labels from pdf-lib.
          const radioLabels = new Map();
          try {
            const form = (await PS.engine.loadPdfLib(handle.bytes)).getForm();
            form.getFields().forEach((f) => { if (f instanceof global.PDFLib.PDFRadioGroup) radioLabels.set(f.getName(), f.getOptions()); });
          } catch (_) { /* encrypted or unusual form: fall back to raw export values */ }
          const radioLabel = (name, v) => { const o = radioLabels.get(name); return o && /^\d+$/.test(v) && o[+v] != null && !o.includes(v) ? o[+v] : v; };

          const viewer = PS.viewer.create(handle, { textLayer: false });
          view.workspace.insertBefore(viewer.el, view.result);
          const flatten = h('input', { type: 'checkbox' });
          const summary = h('p', { class: 'hint' });
          const save = view.actionButton('Save filled PDF', 'download', run);
          const reset = h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => { values.forEach((v, k) => values.set(k, Array.isArray(v) ? [] : typeof v === 'string' && (v === 'Off' || isToggle(k)) ? 'Off' : '')); syncAll(); } }, icon('refresh', 'icon-sm'), 'Clear all');
          view.options.append(
            PS.kit.panel('Form', summary, h('div', { class: 'btn-row' }, reset)),
            PS.kit.panel('Save', h('label', { class: 'check' }, flatten, 'Flatten (make the filled form non-editable)'), h('div', { style: { marginTop: '14px' } }, save)));
          if (handle.pdfjs.isPureXfa) view.options.prepend(ui.note('This is an XFA form (Adobe LiveCycle). XFA forms can only be filled in Adobe Acrobat/Reader; most other apps — including this one — can’t render them.', 'warn'));
          if (!fieldNames.length) {
            summary.textContent = 'This PDF has no fillable fields.';
            view.options.prepend(ui.note('No fillable fields found. Use “Prepare form” to add fields, or “Sign & annotate” to type text anywhere on the page.'));
            save.disabled = true; reset.disabled = true;
          } else summary.textContent = `${plural(fieldNames.length, 'field')} on ${plural(new Set(widgets.map((w) => w.page)).size, 'page')}. Press Tab to move between fields.`;

          function isToggle(name) { return widgets.some((w) => w.ann.fieldName === name && (w.ann.checkBox || w.ann.radioButton)); }
          function track(name, el) { if (!inputs.has(name)) inputs.set(name, []); inputs.get(name).push(el); }
          function syncAll() { inputs.forEach((els, name) => els.forEach((el) => sync(el, name))); }
          function sync(el, name) {
            const v = values.get(name);
            if (el.type === 'checkbox' || el.type === 'radio') el.checked = v === el.dataset.on;
            else if (el.tagName === 'SELECT') [...el.options].forEach((o) => { o.selected = (v || []).includes(o.value); });
            else if (el.value !== v) el.value = v || '';
          }

          viewer.onPage((pv) => {
            let layer = pv.overlay.querySelector('.form-layer');
            if (!layer) { layer = h('div', { class: 'obj-layer form-layer' }); pv.overlay.append(layer); }
            layer.replaceChildren();
            widgets.filter((w) => w.page === pv.num).forEach(({ ann }) => {
              if (ann.fieldType === 'Sig' || ann.pushButton) return;
              const r = pv.rectToPx(ann.rect);
              const name = ann.fieldName;
              const fs = ann.textFontSize || (ann.defaultAppearanceData && ann.defaultAppearanceData.fontSize) || 0;
              const hPt = ann.rect[3] - ann.rect[1];
              const auto = ann.multiLine ? 11 : Math.max(7, Math.min(12, hPt * 0.62));
              const fontPx = (fs > 0 && fs <= hPt * 0.9 && fs <= 24 ? fs : auto) * pv.scale;
              let el;
              const label = ann.alternativeText || name;
              if (ann.checkBox || ann.radioButton) {
                el = h('input', { type: ann.checkBox ? 'checkbox' : 'radio', class: 'form-input', name: 'ps-' + name, 'aria-label': label + (ann.radioButton ? ` — ${radioLabel(name, ann.buttonValue)}` : '') });
                el.dataset.on = ann.checkBox ? (ann.exportValue || 'Yes') : ann.buttonValue;
                el.addEventListener('change', () => {
                  if (ann.checkBox) values.set(name, el.checked ? el.dataset.on : 'Off');
                  else if (el.checked) values.set(name, el.dataset.on);
                  inputs.get(name).forEach((x) => sync(x, name));
                });
              } else if (ann.fieldType === 'Ch') {
                el = h('select', { class: 'form-input', 'aria-label': label, multiple: !ann.combo && ann.multiSelect }, ann.combo ? h('option', { value: '' }, '') : null,
                  ...(ann.options || []).map((o) => h('option', { value: o.exportValue }, o.displayValue)));
                if (!ann.combo) el.size = Math.max(2, Math.floor((ann.rect[3] - ann.rect[1]) / (fontPx / pv.scale * 1.25)));
                el.addEventListener('change', () => { values.set(name, [...el.selectedOptions].map((o) => o.value).filter(Boolean)); inputs.get(name).forEach((x) => x !== el && sync(x, name)); });
              } else {
                el = ann.multiLine ? h('textarea', { class: 'form-input', 'aria-label': label }) : h('input', { type: ann.password ? 'password' : 'text', class: 'form-input', 'aria-label': label });
                if (ann.maxLen) el.maxLength = ann.maxLen;
                el.addEventListener('input', () => { values.set(name, el.value); inputs.get(name).forEach((x) => x !== el && sync(x, name)); });
              }
              if (ann.readOnly) el.disabled = true;
              if (ann.required) el.required = true;
              Object.assign(el.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', fontSize: fontPx + 'px' });
              if (ann.textAlignment === 1) el.style.textAlign = 'center'; else if (ann.textAlignment === 2) el.style.textAlign = 'right';
              track(name, el);
              sync(el, name);
              layer.append(el);
            });
            // drop references to elements that are no longer in the DOM
            inputs.forEach((els, k) => inputs.set(k, els.filter((x) => x.isConnected)));
          });

          async function run() {
            const out = await ui.run('Saving form…', async () => {
              const doc = await PS.engine.loadPdfLib(handle.bytes);
              const form = doc.getForm();
              const L = global.PDFLib;
              const problems = [];
              let filled = 0;
              for (const [name, v] of values) {
                let f;
                try { f = form.getField(name); } catch (_) { problems.push(name); continue; }
                try {
                  if (f instanceof L.PDFCheckBox) { if (v && v !== 'Off') f.check(); else f.uncheck(); }
                  else if (f instanceof L.PDFRadioGroup) { if (v && v !== 'Off') f.select(matchOption(f.getOptions(), v)); else f.clear(); }
                  else if (f instanceof L.PDFDropdown || f instanceof L.PDFOptionList) {
                    const opts = f.getOptions();
                    const sel = (v || []).map((x) => matchOption(opts, x, widgets.find((w) => w.ann.fieldName === name))).filter((x) => x != null);
                    if (sel.length) f.select(f instanceof L.PDFDropdown ? sel[0] : sel); else f.clear();
                  } else if (f instanceof L.PDFTextField) f.setText(v || undefined);
                  else continue;
                  if ((Array.isArray(v) ? v.length : v && v !== 'Off')) filled++;
                } catch (err) { console.warn('field', name, err); problems.push(name); }
              }
              try {
                const helv = await doc.embedFont(L.StandardFonts.Helvetica);
                form.updateFieldAppearances(helv);
              } catch (err) {
                if (/encode|WinAnsi/i.test(String(err.message))) throw new Error('A value contains characters the standard PDF font can’t show (e.g. non-Latin script). Remove them or use “Sign & annotate” to add that text as an image.');
                throw err;
              }
              if (flatten.checked) form.flatten();
              return { blob: await PS.engine.saveToBlob(doc), filled, problems };
            }, 'fill-form');
            if (!out) return;
            if (out.problems.length) ui.toast(`Couldn’t set: ${out.problems.join(', ')}`, 'warning');
            ui.showResult(view.result, { blob: out.blob, filename: `${baseName(handle.name)}_filled.pdf`, detail: `${plural(out.filled, 'field')} filled${flatten.checked ? ' · flattened' : ''}` });
          }

          /** Map a pdf.js export/display value onto a pdf-lib option value. */
          function matchOption(opts, v, w) {
            if (opts.includes(v)) return v;
            if (/^\d+$/.test(String(v)) && opts[+v] != null) return opts[+v]; // /Opt-indexed radio export values
            if (w && w.ann.options) { const o = w.ann.options.find((x) => x.exportValue === v); if (o && opts.includes(o.displayValue)) return o.displayValue; }
            return opts.find((o) => String(o).toLowerCase() === String(v).toLowerCase()) ?? null;
          }

          return () => viewer.destroy();
        },
      });
    },
  });
})(window);
