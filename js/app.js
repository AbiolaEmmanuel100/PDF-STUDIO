/**
 * PDF Studio — application shell (PS.app, PS.tools)
 * Tool registry, hash router (works on file:// and GitHub Pages), home screen,
 * sidebar navigation, theme switching and offline (service worker) registration.
 */
(function (global) {
  'use strict';
  const PS = global.PS;
  const { h, icon } = PS.util;

  const CATEGORIES = [
    { id: 'organize', name: 'Organize', color: 'var(--c-organize)' },
    { id: 'convert', name: 'Convert', color: 'var(--c-convert)' },
    { id: 'edit', name: 'Edit & sign', color: 'var(--c-edit)' },
    { id: 'optimize', name: 'Optimize', color: 'var(--c-optimize)' },
    { id: 'inspect', name: 'Inspect', color: 'var(--c-inspect)' },
  ];

  /* ------------------------------------------------------------ Registry */
  const registry = [];
  PS.tools = {
    register(def) { registry.push(def); },
    all() { return registry.slice(); },
    get(id) { return registry.find((t) => t.id === id); },
  };

  /* --------------------------------------------------------------- State */
  let current = null;        // { def, instance }
  let dropHandler = null;    // page-level drop target for the active tool

  PS.app = {
    setDropHandler(fn) { dropHandler = fn; },
    navigate(id) { location.hash = id ? '#/' + id : '#/'; },
  };

  function categoryOf(def) { return CATEGORIES.find((c) => c.id === def.category) || CATEGORIES[0]; }

  /* ------------------------------------------------------------- Sidebar */
  function buildSidebar() {
    const nav = document.getElementById('sidebar-nav');
    nav.replaceChildren(
      h('div', { class: 'nav-group' },
        h('a', { class: 'nav-link', href: '#/', dataset: { tool: '' } }, icon('grid'), 'All tools')),
      ...CATEGORIES.map((cat) => {
        const tools = registry.filter((t) => t.category === cat.id);
        if (!tools.length) return null;
        return h('div', { class: 'nav-group' },
          h('div', { class: 'nav-group-title', id: 'nav-' + cat.id }, cat.name),
          h('div', { role: 'group', 'aria-labelledby': 'nav-' + cat.id },
            tools.map((t) => h('a', { class: 'nav-link', href: '#/' + t.id, dataset: { tool: t.id } },
              h('span', { style: { color: cat.color, display: 'contents' } }, icon(t.icon)), t.name))));
      }));
  }

  function markActive(id) {
    document.querySelectorAll('#sidebar-nav .nav-link').forEach((a) => {
      if (a.dataset.tool === (id || '')) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  /* ---------------------------------------------------------------- Home */
  function renderHome(main) {
    const search = h('input', { type: 'search', placeholder: 'Search tools…', 'aria-label': 'Search tools', 'aria-keyshortcuts': '/', id: 'tool-search' });
    const sections = h('div');
    function draw(q) {
      const query = q.trim().toLowerCase();
      const match = (t) => !query || [t.name, t.description, ...(t.keywords || [])].join(' ').toLowerCase().includes(query);
      const blocks = CATEGORIES.map((cat) => {
        const tools = registry.filter((t) => t.category === cat.id && match(t));
        if (!tools.length) return null;
        return h('section', { class: 'tool-section', 'aria-labelledby': 'sec-' + cat.id },
          h('h2', { id: 'sec-' + cat.id }, cat.name),
          h('div', { class: 'tool-grid' }, tools.map((t) =>
            h('a', { class: 'tool-card', href: '#/' + t.id, style: { '--tool-color': cat.color } },
              h('div', { class: 'tool-icon' }, icon(t.icon)),
              h('h3', null, t.name),
              h('p', null, t.description),
              t.isNew ? h('span', { class: 'badge-new' }, 'New') : null))));
      }).filter(Boolean);
      sections.replaceChildren(...(blocks.length ? blocks : [h('p', { class: 'empty-search' }, `No tools match “${q}”.`)]));
    }
    search.addEventListener('input', () => draw(search.value));
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const first = sections.querySelector('.tool-card'); if (first) first.click(); }
    });
    draw('');
    main.replaceChildren(
      h('section', { class: 'hero' },
        h('h1', { id: 'page-title', tabindex: '-1' }, 'Every PDF tool you need — private by design.'),
        h('p', null, 'Merge, split, convert, compress, sign and edit PDFs right in your browser. Nothing is uploaded: your files are processed on this device and never leave it.'),
        h('div', { class: 'hero-points' },
          h('span', null, icon('shield'), 'No uploads, no tracking'),
          h('span', null, icon('wifi-off'), 'Works offline'),
          h('span', null, icon('zap'), 'Free, no sign-up'))),
      h('div', { class: 'tool-search' }, icon('search'), search),
      sections);
    PS.app.setDropHandler(null);
  }

  /* ----------------------------------------------------------- Tool view */
  function renderTool(main, def) {
    const cat = categoryOf(def);
    const body = h('div', { class: 'tool-root' });
    main.replaceChildren(
      h('div', { class: 'tool-head' },
        h('div', { class: 'tool-icon', style: { '--tool-color': cat.color } }, icon(def.icon)),
        h('div', null,
          h('h1', { id: 'page-title', tabindex: '-1' }, def.name),
          h('p', null, def.longDescription || def.description))),
      body);
    PS.app.setDropHandler(null);
    let instance = null;
    try {
      instance = def.mount(body) || null;
    } catch (err) {
      PS.ui.reportError(err, def.id);
    }
    return instance;
  }

  /* -------------------------------------------------------------- Router */
  function route() {
    const id = (location.hash.match(/^#\/([\w-]+)/) || [])[1] || '';
    const def = id ? PS.tools.get(id) : null;
    if (id && !def) { location.replace('#/'); return; }
    if (current && current.instance && current.instance.destroy) {
      try { current.instance.destroy(); } catch (e) { console.warn(e); }
    }
    current = null;
    const main = document.getElementById('main');
    if (def) {
      current = { def, instance: renderTool(main, def) };
      document.title = `${def.name} — PDF Studio`;
    } else {
      renderHome(main);
      document.title = 'PDF Studio — private, offline PDF editor & converter';
    }
    markActive(id);
    document.body.classList.remove('nav-open');
    global.scrollTo(0, 0);
    // move focus to the new heading for screen-reader & keyboard users (not on first load)
    if (route.initialised) document.getElementById('page-title')?.focus({ preventScroll: true });
    route.initialised = true;
  }

  /* --------------------------------------------------------------- Theme */
  const THEMES = ['system', 'light', 'dark'];
  function applyTheme(pref) {
    const dark = pref === 'dark' || (pref === 'system' && global.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme-pref', pref);
    const btn = document.getElementById('theme-toggle');
    if (btn) {
      const label = { system: 'System', light: 'Light', dark: 'Dark' }[pref];
      btn.replaceChildren(icon({ system: 'monitor', light: 'sun', dark: 'moon' }[pref]));
      btn.setAttribute('aria-label', `Theme: ${label}. Click to change.`);
      btn.title = `Theme: ${label}`;
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = dark ? '#0d1117' : '#f5f7fb';
  }
  function initTheme() {
    let pref = document.documentElement.getAttribute('data-theme-pref') || 'system';
    applyTheme(pref);
    document.getElementById('theme-toggle').addEventListener('click', () => {
      pref = THEMES[(THEMES.indexOf(pref) + 1) % THEMES.length];
      try { localStorage.setItem('ps-theme', pref); } catch (_) { /* private mode */ }
      applyTheme(pref);
      PS.ui.toast(`Theme: ${pref === 'system' ? 'follow system' : pref}`, 'info', { timeout: 1600 });
    });
    global.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (pref === 'system') applyTheme(pref); });
  }

  /* ------------------------------------------------- Page-level drag/drop */
  function initGlobalDrop() {
    // Never let the browser navigate away to a dropped file (would lose the user's work).
    global.addEventListener('dragover', (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = dropHandler ? 'copy' : 'none'; });
    global.addEventListener('drop', (e) => {
      e.preventDefault();
      const files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) return;
      if (dropHandler) dropHandler(files);
      else PS.ui.toast('Open a tool first, then drop your files.', 'info');
    });
  }

  /* -------------------------------------------------------- Mobile nav */
  function initNav() {
    const btn = document.getElementById('menu-btn');
    const toggle = (open) => {
      document.body.classList.toggle('nav-open', open);
      btn.setAttribute('aria-expanded', String(open));
      if (open) document.querySelector('#sidebar-nav .nav-link')?.focus();
    };
    btn.addEventListener('click', () => toggle(!document.body.classList.contains('nav-open')));
    document.getElementById('sidebar-backdrop').addEventListener('click', () => toggle(false));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.body.classList.contains('nav-open')) { toggle(false); btn.focus(); }
      if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !document.activeElement.isContentEditable) {
        const s = document.getElementById('tool-search');
        if (s) { e.preventDefault(); s.focus(); }
      }
    });
  }

  /* ------------------------------------------------ Offline / installable */
  function initPwa() {
    // Service workers & manifests only work over http(s); on file:// we skip them silently.
    if (!/^https?:$/.test(location.protocol)) return;
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = 'manifest.webmanifest';
    document.head.appendChild(link);
    if ('serviceWorker' in navigator) {
      global.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Offline mode unavailable:', err.message));
      });
    }
  }

  function start() {
    buildSidebar();
    initTheme();
    initNav();
    initGlobalDrop();
    initPwa();
    global.addEventListener('hashchange', route);
    route();
    // Warm up pdf.js in the background so the first file opens faster.
    setTimeout(() => PS.engine.ensurePdfJs().catch(() => {}), 300);
  }

  PS.app.start = start;
})(window);
