// "Open in IDE…" in the command palette, like Muxy 1.x's File → Open in IDE
// menu: a window listing Finder and every editor; clicking one opens the
// project there. The window can't be resized later, so it's sized from the
// last list of apps (the page finds them again and scrolls if needed).
(function () {
  let count = 4;
  try {
    const cache = muxy.storage.get("apps");
    if (cache && Array.isArray(cache.apps)) count = cache.apps.length;
  } catch (_) {
    // the page finds the apps itself
  }
  // Padding, header, Finder, divider, then 29px per app (see menu/menu.css).
  const height = Math.min(560, Math.max(120, 100 + 29 * Math.max(1, count)));
  muxy.modal.openWebview({ entry: "menu/index.html", width: 320, height, data: { mode: "open" } });
})();
