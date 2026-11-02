/**
 * PDF Studio — core utilities (PS.util)
 * Pure helpers with no UI side-effects. Loaded first; every other script
 * attaches to the single global namespace `window.PS`.
 */
(function (global) {
  'use strict';
  const PS = (global.PS = global.PS || {});

  /**
   * Tiny DOM builder. h('button', {class: 'btn', onclick: fn}, 'Label', childNode)
   * Strings are always inserted as text (never HTML) so file names etc. can't inject markup.
   */
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (value == null || value === false) continue;
        if (key === 'class') el.className = value;
        else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
        else if (key === 'dataset') Object.assign(el.dataset, value);
        else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
        else if (key === 'html') el.innerHTML = value; // only used with trusted static markup
        else if (value === true) el.setAttribute(key, '');
        else if (key in el && !key.includes('-') && key !== 'list' && key !== 'form') {
          try { el[key] = value; } catch (_) { el.setAttribute(key, value); }
        } else el.setAttribute(key, value);
      }
    }
    appendChildren(el, children);
    return el;
  }
  function appendChildren(el, children) {
    for (const child of children.flat(Infinity)) {
      if (child == null || child === false) continue;
      el.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
    }
  }

  /** Inline SVG icon from the sprite in index.html. */
  function icon(name, cls) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'icon' + (cls ? ' ' + cls : ''));
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const use = document.createElementNS(ns, 'use');
    use.setAttribute('href', '#i-' + name);
    svg.appendChild(use);
    return svg;
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return '—';
    if (bytes < 1024) return bytes + ' B';
    const units = ['KB', 'MB', 'GB'];
    let v = bytes / 1024, i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return v.toFixed(v >= 100 ? 0 : 1) + ' ' + units[i];
  }

  function plural(n, word, pluralWord) {
    return n + ' ' + (n === 1 ? word : (pluralWord || word + 's'));
  }

  /** "My Report.final.pdf" -> "My Report.final" */
  function baseName(name) {
    return String(name || 'document').replace(/\.[a-z0-9]{1,5}$/i, '') || 'document';
  }

  /** Make a string safe to use as a download filename. */
  function safeFileName(name) {
    return String(name).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 150) || 'document';
  }

  /**
   * Parse "1-3, 5, 8-" style page ranges into sorted, unique, 0-based indices.
   * Empty input = all pages. Supports open ranges ("8-" / "-3"). Throws on garbage
   * so the UI can tell the user exactly what's wrong instead of silently ignoring it.
   */
  function parseRanges(str, max, { allowEmpty = true, keepOrder = false } = {}) {
    if (!str || !str.trim()) {
      if (allowEmpty) return Array.from({ length: max }, (_, i) => i);
      throw new Error('Enter at least one page.');
    }
    const out = [];
    for (let part of str.split(',')) {
      part = part.trim();
      if (!part) continue;
      const m = part.match(/^(\d*)\s*[-–]\s*(\d*)$/);
      let a, b;
      if (m && (m[1] || m[2])) {
        a = m[1] ? parseInt(m[1], 10) : 1;
        b = m[2] ? parseInt(m[2], 10) : max;
      } else if (/^\d+$/.test(part)) {
        a = b = parseInt(part, 10);
      } else {
        throw new Error(`"${part}" isn't a valid page or range.`);
      }
      if (a < 1 || b < 1 || a > max || b > max) throw new Error(`Page ${a > max || a < 1 ? a : b} is out of range (1–${max}).`);
      const step = a <= b ? 1 : -1;
      for (let i = a; step > 0 ? i <= b : i >= b; i += step) out.push(i - 1);
    }
    if (!out.length) throw new Error('No pages selected.');
    if (keepOrder) return out;
    return Array.from(new Set(out)).sort((x, y) => x - y);
  }

  /** Inverse of parseRanges: [0,1,2,4] -> "1-3, 5" */
  function formatRanges(indices) {
    const sorted = Array.from(new Set(indices)).sort((a, b) => a - b);
    const parts = [];
    for (let i = 0; i < sorted.length; i++) {
      const start = sorted[i];
      while (i + 1 < sorted.length && sorted[i + 1] === sorted[i] + 1) i++;
      parts.push(start === sorted[i] ? String(start + 1) : `${start + 1}-${sorted[i] + 1}`);
    }
    return parts.join(', ');
  }

  /** Yield to the event loop so the UI can paint between heavy steps. */
  function tick() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  function debounce(fn, ms) {
    let t;
    return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
  }

  function uid(prefix) {
    return (prefix || 'id') + '-' + Math.random().toString(36).slice(2, 9);
  }

  function readAsArrayBuffer(file) {
    if (file.arrayBuffer) return file.arrayBuffer();
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsArrayBuffer(file);
    });
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image (out of memory?)'))), type, quality);
    });
  }

  function isPdf(file) {
    return !!file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name));
  }
  function isImage(file) {
    return !!file && (/^image\//.test(file.type) || /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(file.name));
  }
  function isDocx(file) {
    return !!file && /\.docx$/i.test(file.name);
  }

  /** Turn any thrown value into a short, human-friendly message. */
  function errorMessage(err) {
    if (!err) return 'Something went wrong.';
    const name = err.name || '';
    const msg = String(err.message || err);
    if (name === 'EncryptedPDFError' || /encrypt/i.test(msg)) return 'This PDF is password-protected/encrypted. Remove the password first, then try again.';
    if (name === 'PasswordException') return 'This PDF requires a password to open.';
    if (name === 'InvalidPDFException' || /Invalid PDF|Failed to parse|No PDF header/i.test(msg)) return 'This file is not a valid PDF or is damaged.';
    if (/out of memory|allocation|RangeError/i.test(msg)) return 'Your browser ran out of memory. Try a smaller file or a lower quality setting.';
    return msg;
  }

  /**
   * Download a Blob with a temporary object URL (revoked afterwards to free memory).
   */
  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeFileName(filename);
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
  }

  /** Zip a list of {name, data:Uint8Array} with fflate (store mode for already-compressed data). */
  function zip(files, { level = 0 } = {}) {
    if (!global.fflate) throw new Error('Zip library failed to load.');
    const used = new Set();
    const input = {};
    for (const f of files) {
      let name = safeFileName(f.name);
      // de-duplicate names inside the archive
      if (used.has(name)) {
        const dot = name.lastIndexOf('.');
        let n = 2;
        while (used.has(`${name.slice(0, dot)} (${n})${name.slice(dot)}`)) n++;
        name = `${name.slice(0, dot)} (${n})${name.slice(dot)}`;
      }
      used.add(name);
      input[name] = [f.data, { level }];
    }
    return new Blob([global.fflate.zipSync(input)], { type: 'application/zip' });
  }

  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

  function hexToRgb01(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    const n = m ? parseInt(m[1], 16) : 0;
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  function formatDate(d) {
    if (!(d instanceof Date) || isNaN(d)) return '—';
    try { return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch (_) { return d.toISOString(); }
  }

  /** Load a classic script once (used to lazy-load heavy, rarely used libraries). */
  const scriptCache = {};
  function loadScript(src, globalName) {
    if (globalName && global[globalName]) return Promise.resolve();
    if (!scriptCache[src]) {
      scriptCache[src] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = () => resolve();
        s.onerror = () => { delete scriptCache[src]; reject(new Error(`Could not load ${src}`)); };
        document.head.appendChild(s);
      });
    }
    return scriptCache[src];
  }

  PS.util = {
    loadScript, h, icon, formatBytes, plural, baseName, safeFileName, parseRanges, formatRanges, tick, debounce, uid,
    readAsArrayBuffer, canvasToBlob, isPdf, isImage, isDocx, errorMessage, download, zip, clamp, hexToRgb01, formatDate,
  };
})(window);
