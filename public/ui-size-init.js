// Sets the stored interface size before the first paint, so the page never shows another size first.
// A classic script from the app origin: the CSP of the desktop app blocks inline scripts.
// The desktop app zooms its webview from src/app/ui-size.svelte.ts instead, before the first render.
// The key repeats the storage prefix of src/app/storage.ts; the steps and the minimum layout repeat TUNING.ui.uiSize.
(function () {
  if (window.isTauri) return;
  try {
    var stored = JSON.parse(localStorage.getItem('mini-image-editor:ui-size') || 'null');
    if (!stored || stored.v !== 1 || typeof stored.size !== 'number') return;
    var steps = [80, 90, 100, 110, 125, 150];
    var chosen = steps.reduce(function (best, step) {
      return Math.abs(step - stored.size) < Math.abs(best - stored.size) ? step : best;
    }, 100);
    var size = chosen;
    if (chosen > 100) {
      var fit = Math.min(window.innerWidth / 960, window.innerHeight / 640) * 100 + 0.01;
      size = 100;
      for (var i = 0; i < steps.length; i++) if (steps[i] > 100 && steps[i] <= chosen && steps[i] <= fit) size = steps[i];
    }
    if (size === 100) return;
    var root = document.documentElement.style;
    root.setProperty('zoom', String(size / 100));
    root.setProperty('--ui-zoom', String(size / 100));
  } catch (error) {
    // Storage can be blocked: the default size stays.
  }
})();
