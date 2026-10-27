// Muxy doesn't keep top-bar icon changes across restarts, so show the icon of
// the app the Open in IDE button opens again.
(function () {
  try {
    const selected = muxy.storage.get("selected");
    if (!selected || !selected.topbarIcon) return;
    // Choices saved by 1.0.0 show Android Studio with the generic code icon.
    const android = [selected.id, selected.name].some(text => /android[\s._-]?studio/i.test(String(text || "")));
    muxy.topbar.set({ id: "open", icon: android ? { svg: "icons/android.svg" } : selected.topbarIcon });
  } catch (_) {
    // keep the default icon
  }
})();
