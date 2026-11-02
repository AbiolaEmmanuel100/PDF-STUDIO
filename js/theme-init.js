/* Applies the saved/system colour theme before first paint (avoids a flash of the wrong theme). */
(function () {
  'use strict';
  var pref = 'system';
  try { pref = localStorage.getItem('ps-theme') || 'system'; } catch (e) { /* storage may be disabled */ }
  var dark = pref === 'dark' || (pref === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme-pref', pref);
})();
