// Sets the stored theme before the first paint, so the window never shows another theme.
// A classic script from the app origin: the CSP of the desktop app blocks inline scripts.
// The key repeats the storage prefix of src/app/storage.ts and the theme ids of src/app/theme.svelte.ts.
(function () {
  try {
    var stored = localStorage.getItem('mini-image-editor:theme');
    if (/^(musgo|menta|grafite|papel|neon|sorvete)$/.test(stored || '')) document.documentElement.dataset.theme = stored;
  } catch (error) {
    // Storage can be blocked: the default theme stays.
  }
})();
