/**
 * Tool: Prepare form
 * Turn any PDF into a fillable form: draw text fields, multi-line text areas, checkboxes,
 * radio buttons, dropdowns and signature fields on the page, name them and set options.
 * Saved as standard AcroForm fields (pdf-lib), fillable in Acrobat, Preview, browsers and
 * in this app's “Fill form” tool.
 */
(function (global) {
  'use strict';
  const PS = global.PS;
  const { h, icon, baseName, plural } = PS.util;
  const ui = PS.ui;

  const TYPES = [
    ['text', 'Text', 'textbox', [160, 22]], ['multiline', 'Paragraph', 'file-text', [220, 70]], ['checkbox', 'Checkbox', 'checkbox', [14, 14]],
    ['radio', 'Radio', 'radio', [14, 14]], ['dropdown', 'Dropdown', 'dropdown', [140, 22]], ['signature', 'Signature', 'signature', [180, 46]],
  ];
  const LABEL = Object.fromEntries(TYPES.map((t) => [t[0], t[1]]));

  PS.tools.register({
    id: 'prepare-form',
    name: 'Prepare form',
    category: 'edit',
    icon: 'form-plus',
    isNew: true,
    description: 'Add fillable fields: text, checkboxes, radio buttons, dropdowns, signatures.',
    longDescription: 'Make any PDF fillable. Draw text fields, paragraphs, checkboxes, radio buttons, dropdowns and signature fields on the page, name them and set their options — saved as standard PDF form fields.',
    keywords: ['create form', 'fillable', 'acroform', 'form fields', 'make fillable', 'checkbox', 'dropdown', 'signature field', 'form builder'],
    mount(root) {
      return PS.kit.pdfTool(root, {
        dropTitle: 'Choose a PDF to turn into a form',
        async onLoad(handle, view) {
          view.workspace.parentElement.classList.add('viewer-tool');
          let existing = [];
          try { existing = (await PS.engine.loadPdfLib(handle.bytes)).getForm().getFields().map((f) => f.getName()); } catch (_) { /* encrypted: handled on save */ }
          const counters = {};
          let type = 'text';
          const viewer = PS.viewer.create(handle, { textLayer: false });
          view.workspace.insertBefore(viewer.el, view.result);
          const objs = PS.objects.create(viewer, {
            label: (o) => `${LABEL[o.type]} field ${o.name}`,
            render(o, body, pv) {
              body.className = 'obj-body form-field-preview ff-' + o.type;
              body.replaceChildren(...(o.type === 'checkbox' || o.type === 'radio' ? [] : [h('span', { class: 'ff-name', style: { fontSize: Math.max(9, Math.min(13, 11 * pv.scale)) + 'px' } }, o.type === 'signature' ? '✍ ' + o.name : o.type === 'dropdown' ? `${o.name} ▾` : o.name)]));
              body.title = `${LABEL[o.type]}: ${o.name}${o.type === 'radio' ? ` (group “${o.group}”, value “${o.value}”)` : ''}`;
            },
            onChange: changed, onSelect: selected,
          });

          const palette = h('div', { class: 'tool-palette', role: 'toolbar', 'aria-label': 'Field types', style: { gridTemplateColumns: 'repeat(3, 1fr)' } });
          TYPES.forEach(([id, label, ic]) => palette.append(h('button', { type: 'button', 'data-type': id, 'aria-pressed': String(id === type), onclick: () => setType(id) }, icon(ic), label)));
          const nameIn = h('input', { type: 'text', 'aria-label': 'Field name', spellcheck: false });
          const reqIn = h('input', { type: 'checkbox' });
          const optsIn = h('textarea', { rows: 4, 'aria-label': 'Dropdown options (one per line)' });
          const groupIn = h('input', { type: 'text', 'aria-label': 'Radio group name', spellcheck: false });
          const valueIn = h('input', { type: 'text', 'aria-label': 'Radio value', spellcheck: false });
          const sizeIn = h('input', { type: 'number', min: 0, max: 48, value: 0, 'aria-label': 'Font size (0 = auto)' });
          const fOpts = ui.field('Options (one per line)', optsIn), fGroup = ui.field('Radio group', groupIn, 'Radios with the same group are mutually exclusive.'), fValue = ui.field('Value when selected', valueIn), fSize = ui.field('Font size', sizeIn, '0 = auto-fit');
          const props = h('div', null, ui.field('Name', nameIn), fGroup, fValue, fOpts, fSize, h('label', { class: 'check' }, reqIn, 'Required'),
            h('button', { class: 'btn btn-secondary btn-sm', type: 'button', style: { marginTop: '10px' }, onclick: () => objs.selected && objs.remove(objs.selected.id) }, icon('trash', 'icon-sm'), 'Delete field'));
          const propsEmpty = h('p', { class: 'hint' }, 'Select a field to edit its name and options.');
          const list = h('ul', { class: 'item-list' });
          const save = view.actionButton('Save fillable PDF', 'download', run);
          view.options.append(
            PS.kit.panel('Add field', palette, h('p', { class: 'kbd-hint' }, 'Click on the page to place a field, or drag to draw its size. Arrow keys nudge the selected field.')),
            PS.kit.panel('Field properties', propsEmpty, props),
            PS.kit.panel('Fields', list, h('div', { style: { marginTop: '12px' } }, save)));
          if (existing.length) view.options.prepend(ui.note(`This PDF already has ${plural(existing.length, 'form field')}; new fields are added alongside them.`));

          function uniqueName(base) {
            const taken = new Set([...existing, ...objs.list().filter((o) => o.type !== 'radio').map((o) => o.name), ...objs.list().filter((o) => o.type === 'radio').map((o) => o.group)]);
            let n = counters[base] || 0, name;
            do { n++; name = `${base}_${n}`; } while (taken.has(name));
            counters[base] = n;
            return name;
          }
          function setType(t) {
            type = t;
            palette.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.type === t)));
            const def = TYPES.find((x) => x[0] === t)[3];
            objs.setCreate({
              cursor: 'crosshair', defaultSize: def, minPx: 8, noFocus: false,
              make(page, rect) {
                const o = { page, rect, type: t, required: false, fontSize: 0, cls: 'kind-field', keepAspect: t === 'checkbox' || t === 'radio' };
                if (t === 'radio') {
                  const last = objs.list().filter((x) => x.type === 'radio').pop();
                  o.group = last ? last.group : uniqueName('choice');
                  o.value = 'Option ' + (objs.list().filter((x) => x.type === 'radio' && x.group === o.group).length + 1);
                  o.name = o.group;
                } else o.name = uniqueName(t === 'multiline' ? 'paragraph' : t);
                if (t === 'dropdown') o.options = ['Option 1', 'Option 2', 'Option 3'];
                return o;
              },
            });
          }
          let syncing = false;
          function selected(o) {
            props.hidden = !o; propsEmpty.hidden = !!o;
            if (!o) return;
            syncing = true;
            nameIn.value = o.type === 'radio' ? o.group : o.name;
            nameIn.parentElement.hidden = o.type === 'radio';
            fGroup.hidden = fValue.hidden = o.type !== 'radio';
            groupIn.value = o.group || ''; valueIn.value = o.value || '';
            fOpts.hidden = o.type !== 'dropdown';
            optsIn.value = (o.options || []).join('\n');
            fSize.hidden = !['text', 'multiline', 'dropdown'].includes(o.type);
            sizeIn.value = o.fontSize || 0;
            reqIn.checked = !!o.required;
            reqIn.parentElement.hidden = o.type === 'signature';
            syncing = false;
          }
          const upd = () => {
            const o = objs.selected;
            if (!o || syncing) return;
            if (o.type === 'radio') { o.group = groupIn.value.trim() || o.group; o.name = o.group; o.value = valueIn.value.trim() || o.value; }
            else o.name = nameIn.value.trim().replace(/[.]/g, '_') || o.name;
            o.options = optsIn.value.split('\n').map((x) => x.trim()).filter(Boolean);
            o.fontSize = Math.max(0, +sizeIn.value || 0);
            o.required = reqIn.checked;
            objs.refresh(o);
            changed(objs.list());
          };
          [nameIn, groupIn, valueIn, optsIn, sizeIn].forEach((x) => x.addEventListener('input', upd));
          reqIn.addEventListener('change', upd);

          function changed(all) {
            list.replaceChildren(...(all.length ? all.map((o) => h('li', null,
              h('button', { class: 'link grow', type: 'button', onclick: () => { viewer.goTo(o.page); objs.select(o.id); const el = objs.element(o.id); if (el) el.focus({ preventScroll: true }); } }, `${LABEL[o.type]} — ${o.type === 'radio' ? `${o.group}: ${o.value}` : o.name}`),
              h('span', { class: 'muted' }, 'p. ' + o.page))) : [h('li', null, h('span', { class: 'muted' }, 'No fields yet.'))]));
            save.disabled = !all.length;
          }

          function validate(all) {
            const names = new Map();
            for (const o of all) {
              if (o.type === 'radio') continue;
              if (names.has(o.name) || existing.includes(o.name)) return `Two fields are named “${o.name}”. Field names must be unique.`;
              names.set(o.name, o);
            }
            const groups = new Set(all.filter((o) => o.type === 'radio').map((o) => o.group));
            for (const g of groups) {
              if (names.has(g) || existing.includes(g)) return `The radio group “${g}” has the same name as another field.`;
              const vals = all.filter((o) => o.type === 'radio' && o.group === g).map((o) => o.value);
              if (new Set(vals).size !== vals.length) return `Radio group “${g}” has duplicate values. Give each radio a different value.`;
            }
            for (const o of all) if (o.type === 'dropdown' && !(o.options || []).length) return `Dropdown “${o.name}” has no options.`;
            return null;
          }

          async function run() {
            const all = objs.list();
            const problem = validate(all);
            if (problem) { ui.toast(problem, 'warning', { timeout: 7000 }); return; }
            const blob = await ui.run('Creating form fields…', async () => {
              const L = global.PDFLib;
              const doc = await PS.engine.loadPdfLib(handle.bytes);
              const form = doc.getForm();
              const pages = doc.getPages();
              const helv = await doc.embedFont(L.StandardFonts.Helvetica);
              const border = L.rgb(0.36, 0.42, 0.55);
              const groups = new Map();
              for (const o of all) {
                const page = pages[o.page - 1];
                const R = PS.engine.displayBox(page).R;
                const [x1, y1, x2, y2] = o.rect;
                const box = { x: x1, y: y1, width: x2 - x1, height: y2 - y1, borderColor: border, borderWidth: 1, backgroundColor: L.rgb(1, 1, 1), rotate: L.degrees(R), font: helv };
                if (o.type === 'text' || o.type === 'multiline') {
                  const f = form.createTextField(o.name);
                  if (o.type === 'multiline') f.enableMultiline();
                  f.addToPage(page, box);
                  if (o.fontSize) f.setFontSize(o.fontSize);
                  if (o.required) f.enableRequired();
                } else if (o.type === 'checkbox') {
                  const f = form.createCheckBox(o.name);
                  f.addToPage(page, Object.assign({}, box, { textColor: L.rgb(0.1, 0.1, 0.1) }));
                  if (o.required) f.enableRequired();
                } else if (o.type === 'radio') {
                  let g = groups.get(o.group);
                  if (!g) { g = form.createRadioGroup(o.group); groups.set(o.group, g); }
                  g.addOptionToPage(o.value, page, box);
                  if (o.required) g.enableRequired();
                } else if (o.type === 'dropdown') {
                  const f = form.createDropdown(o.name);
                  f.addOptions(o.options);
                  f.addToPage(page, box);
                  if (o.fontSize) f.setFontSize(o.fontSize);
                  if (o.required) f.enableRequired();
                } else if (o.type === 'signature') {
                  const ctx = doc.context;
                  const w = x2 - x1, hh = y2 - y1;
                  const ap = ctx.register(ctx.stream(`q 0.36 0.42 0.55 RG 1 w 0.5 0.5 ${w - 1} ${hh - 1} re S 0.6 0.64 0.72 RG 6 ${hh * 0.28} m ${w - 6} ${hh * 0.28} l S Q`, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, w, hh], Resources: {} }));
                  const ref = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', T: L.PDFHexString.fromText(o.name), Rect: [x1, y1, x2, y2], F: 4, P: page.ref, AP: { N: ap }, MK: { BC: [0.36, 0.42, 0.55], R: R } }));
                  page.node.addAnnot(ref);
                  form.acroForm.addField(ref);
                }
              }
              form.updateFieldAppearances(helv);
              return PS.engine.saveToBlob(doc);
            }, 'prepare-form');
            if (blob) ui.showResult(view.result, { blob, filename: `${baseName(handle.name)}_form.pdf`, detail: `${plural(all.length, 'field')} added` });
          }

          setType('text');
          selected(null);
          changed([]);
          return () => viewer.destroy();
        },
      });
    },
  });
})(window);
