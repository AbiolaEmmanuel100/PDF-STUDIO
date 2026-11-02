/**
 * Tool: Rotate pages
 * Rotate all or selected pages by 90°, 180° or 270°. Thumbnails preview the result live.
 */
(function (global) {
  'use strict';
  const PS = global.PS;
  const { h, plural, baseName } = PS.util;
  const ui = PS.ui;

  PS.tools.register({
    id: 'rotate',
    name: 'Rotate pages',
    category: 'organize',
    icon: 'rotate-cw',
    description: 'Rotate all or selected pages — preview before saving.',
    longDescription: 'Rotate every page, or only the ones you select. The thumbnails show the result before you save.',
    keywords: ['turn', 'orientation', 'landscape', 'portrait'],
    mount(root) {
      return PS.kit.pdfTool(root, {
        dropTitle: 'Choose a PDF to rotate',
        onLoad(handle, view) {
          let ready = false;
          const sel = PS.kit.pageSelector(handle, { label: 'Pages — click to choose which to rotate (none = all)', onSelection: () => ready && preview() });
          const angle = ui.segmented('angle', [['90', '90° ⟳'], ['180', '180°'], ['270', '90° ⟲']], '90', 'Rotation angle');
          const summary = h('p', { class: 'hint', style: { marginTop: '10px' }, 'aria-live': 'polite' });
          const btn = view.actionButton('Rotate & download', 'rotate-cw', run);
          const rangeField = ui.field('Pages (blank = all)', sel.rangeInput);
          rangeField.appendChild(sel.rangeHint);
          angle.onChange(preview);
          view.workspace.insertBefore(sel.toolbar, view.result);
          view.workspace.insertBefore(sel.grid.el, view.result);
          view.options.append(
            PS.kit.panel('Rotation', angle.el, summary),
            PS.kit.panel('Pages', rangeField, h('div', { style: { marginTop: '16px' } }, btn)));

          function targets() {
            const idx = sel.indices();
            return idx.length ? idx : [...Array(handle.pageCount).keys()];
          }
          /** Live preview: show the chosen rotation on the affected thumbnails. */
          function preview() {
            const t = new Set(targets());
            const deg = parseInt(angle.value, 10);
            sel.grid.setItems(sel.grid.items.map((it, i) => Object.assign({}, it, { rotation: t.has(i) ? deg : 0 })));
            summary.textContent = `${t.size === handle.pageCount ? 'All ' + plural(t.size, 'page') : plural(t.size, 'page')} will be rotated ${deg === 270 ? '90° counter-clockwise' : deg + '° clockwise'}.`;
          }
          ready = true;
          preview();

          async function run() {
            const indices = targets();
            const deg = parseInt(angle.value, 10);
            const blob = await ui.run('Rotating…', async () => {
              const doc = await PS.engine.loadPdfLib(handle.bytes); // fresh copy: repeated runs never compound
              const pages = doc.getPages();
              indices.forEach((i) => pages[i].setRotation(global.PDFLib.degrees(PS.engine.normRotation(pages[i].getRotation().angle + deg))));
              return PS.engine.saveToBlob(doc);
            }, 'rotate');
            if (blob) ui.showResult(view.result, { blob, filename: `${baseName(handle.name)}_rotated.pdf`, detail: `${plural(indices.length, 'page')} rotated ${deg}°` });
          }
          return () => sel.grid.destroy();
        },
      });
    },
  });
})(window);
