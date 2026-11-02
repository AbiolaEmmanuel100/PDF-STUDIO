/**
 * Tool: Edit metadata
 * View and change the document properties (title, author, subject, keywords, creator, producer)
 * or strip all metadata — including the XMP stream — before sharing a file.
 */
(function (global) {
  'use strict';
  const PS = global.PS;
  const { h, icon, baseName, formatDate } = PS.util;
  const ui = PS.ui;

  PS.tools.register({
    id: 'metadata',
    name: 'Edit metadata',
    category: 'edit',
    icon: 'tag',
    isNew: true,
    description: 'Change title, author, keywords — or strip all metadata.',
    longDescription: 'Edit the document properties shown by PDF readers and search engines, or remove all hidden metadata before sharing.',
    keywords: ['properties', 'title', 'author', 'privacy', 'remove metadata', 'xmp'],
    mount(root) {
      return PS.kit.pdfTool(root, {
        dropTitle: 'Choose a PDF to edit its properties',
        async onLoad(handle, view) {
          let doc;
          try { doc = await PS.engine.loadPdfLib(handle.bytes); }
          catch (err) { ui.reportError(err, 'metadata'); return; }
          const get = (fn) => { try { return doc[fn]() || ''; } catch (_) { return ''; } };
          const fields = {
            title: h('input', { type: 'text', value: get('getTitle') }),
            author: h('input', { type: 'text', value: get('getAuthor') }),
            subject: h('input', { type: 'text', value: get('getSubject') }),
            keywords: h('input', { type: 'text', value: get('getKeywords'), placeholder: 'Comma or space separated' }),
            creator: h('input', { type: 'text', value: get('getCreator') }),
            producer: h('input', { type: 'text', value: get('getProducer') }),
          };
          const created = (() => { try { return doc.getCreationDate(); } catch (_) { return null; } })();
          const modified = (() => { try { return doc.getModificationDate(); } catch (_) { return null; } })();
          const hasXmp = !!doc.catalog.get(global.PDFLib.PDFName.of('Metadata'));

          const form = h('form', { onsubmit: (e) => { e.preventDefault(); save(false); } },
            ui.field('Title', fields.title),
            ui.field('Author', fields.author),
            ui.field('Subject', fields.subject),
            ui.field('Keywords', fields.keywords),
            h('div', { class: 'field-row' }, ui.field('Creator (app)', fields.creator), ui.field('Producer', fields.producer)));
          view.workspace.insertBefore(PS.kit.panel('Document properties', form,
            h('table', { class: 'meta-table', style: { marginTop: '16px' } },
              h('tbody', null,
                h('tr', null, h('th', null, 'Created'), h('td', null, formatDate(created))),
                h('tr', null, h('th', null, 'Modified'), h('td', null, formatDate(modified))),
                h('tr', null, h('th', null, 'XMP metadata stream'), h('td', null, hasXmp ? 'Present' : 'None'))))), view.result);
          view.options.append(
            PS.kit.panel('Save',
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
                view.actionButton('Save changes', 'download', () => save(false)),
                h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => save(true) }, icon('trash', 'icon-sm'), 'Remove all metadata')),
              h('p', { class: 'hint', style: { marginTop: '10px' } }, '“Remove all metadata” clears every property, dates and the XMP stream — useful before sharing a document publicly.')));

          async function save(strip) {
            const blob = await ui.run(strip ? 'Removing metadata…' : 'Saving…', async () => {
              const d = await PS.engine.loadPdfLib(handle.bytes);
              const { PDFName } = global.PDFLib;
              if (strip) {
                const info = d.getInfoDict();
                for (const key of info.keys()) info.delete(key);
                d.catalog.delete(PDFName.of('Metadata'));
                return new Blob([await d.save({ useObjectStreams: true })], { type: 'application/pdf' });
              }
              d.setTitle(fields.title.value.trim(), { showInWindowTitleBar: !!fields.title.value.trim() });
              d.setAuthor(fields.author.value.trim());
              d.setSubject(fields.subject.value.trim());
              d.setKeywords(fields.keywords.value.split(/[,;]+|\s{2,}/).map((s) => s.trim()).filter(Boolean));
              d.setCreator(fields.creator.value.trim());
              d.setProducer(fields.producer.value.trim());
              // stale XMP would contradict the new values in some readers — drop it
              d.catalog.delete(PDFName.of('Metadata'));
              return PS.engine.saveToBlob(d);
            }, 'metadata');
            if (blob) ui.showResult(view.result, { blob, filename: `${baseName(handle.name)}${strip ? '_clean' : ''}.pdf`, detail: strip ? 'All metadata removed' : 'Properties updated' });
            if (blob && strip) Object.values(fields).forEach((f) => { f.value = ''; });
          }
          return null;
        },
      });
    },
  });
})(window);
