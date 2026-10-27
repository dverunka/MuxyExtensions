// Two menus, like Muxy 1.x:
//   - mode "select": the ▾ popover next to the button. Choosing an app makes
//     it the one the button opens (1.x's project-target menu).
//   - mode "open": the "Open in IDE…" window from the command palette.
//     Choosing an app opens the project there (1.x's File → Open in IDE).
(function () {
  "use strict";

  const lib = window.OpenInIDE;
  const opening = Boolean(muxy.data && muxy.data.mode === "open");
  const root = document.getElementById("root");
  document.body.classList.add(opening ? "modal" : "popover");

  const svg = body => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + "</svg>";
  const GLYPHS = {
    code: svg('<path d="M8 6.5 2.5 12 8 17.5M16 6.5 21.5 12 16 17.5M14 4 10 20"/>'),
    folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
    sparkles: svg('<path d="m10 3.5 1.6 4.4L16 9.5l-4.4 1.6L10 15.5l-1.6-4.4L4 9.5l4.4-1.6zM18 14l.9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9z"/>'),
    check: svg('<path d="m4.5 12.5 5 5 10-11"/>'),
  };

  const state = {
    cache: null, // the apps found last (see OpenInIDE.parseDiscovery)
    selectedId: null, // the app the button opens
    target: null, // { dir, label } of the active worktree or project
    loading: false, // finding the apps
    listError: null, // why the apps couldn't be found
    openError: null, // why the last app didn't open
    busy: false, // opening an app
  };
  let rows = [];
  let activeId = null;

  const quietly = run => {
    try {
      return Promise.resolve(run()).catch(() => null);
    } catch (_) {
      return Promise.resolve(null);
    }
  };
  const os = () => state.cache ? state.cache.os : /mac/i.test(navigator.platform || navigator.userAgent) ? "macos" : "linux";
  const view = () => state.cache || { os: os(), apps: [], browserIcon: null, legacy: null };

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function glyph(symbol) {
    const node = element("span", "icon");
    const name = String(symbol || "");
    node.innerHTML = name === "folder" ? GLYPHS.folder : name.startsWith("sparkles") ? GLYPHS.sparkles : GLYPHS.code;
    return node;
  }

  function appRow(app, checked) {
    const index = rows.length;
    const row = element("div", "row");
    row.setAttribute("role", "menuitem");
    if (app.icon) {
      const image = element("img", "icon");
      image.alt = "";
      image.draggable = false;
      image.addEventListener("error", () => image.replaceWith(glyph(app.symbol)));
      image.src = app.icon;
      row.append(image);
    } else {
      row.append(glyph(app.symbol));
    }
    row.append(element("span", "name", app.name));
    if (checked) {
      const check = element("span", "check");
      check.innerHTML = GLYPHS.check;
      row.append(check);
      row.setAttribute("aria-current", "true");
    }
    row.addEventListener("mousemove", () => {
      if (activeId !== app.id) highlight(index);
    });
    row.addEventListener("click", () => choose(app));
    rows.push({ app, row });
    return row;
  }

  const note = (text, className) => element("div", className ? "note " + className : "note", text);

  function render() {
    rows = [];
    const nodes = [];
    if (opening) {
      const header = element("div", "header");
      header.append(element("div", "title", lib.TITLE));
      if (state.target) header.append(element("div", "subtitle", state.target.label));
      nodes.push(header);
    }
    const list = element("div", "list");
    nodes.push(list);
    if (state.openError) list.append(note(state.openError, "error"));
    if (!state.target) {
      list.append(note(opening ? lib.MESSAGES.noProject : lib.MESSAGES.noProjectToChoose));
    } else {
      const cache = view();
      const apps = cache.apps;
      const current = opening ? null : lib.resolveDefault(cache, state.selectedId || cache.legacy);
      const browser = lib.fileBrowser(cache);
      list.append(appRow(browser, Boolean(current && current.id === browser.id)));
      if (apps.length || opening) list.append(element("div", "divider"));
      if (!apps.length) {
        if (state.loading) list.append(note("Finding editors…"));
        else if (state.listError) list.append(note(state.listError, "error"));
        else list.append(note(opening ? "No supported IDEs found" : lib.MESSAGES.noEditors));
      } else if (opening) {
        for (const app of lib.sortApps(apps)) list.append(appRow(app, false));
      } else {
        for (const [title, group] of lib.sections(apps)) {
          list.append(element("div", "section", title));
          for (const app of group) list.append(appRow(app, Boolean(current && current.id === app.id)));
        }
      }
    }
    root.replaceChildren(...nodes);
    root.classList.toggle("busy", state.busy);
    root.setAttribute("aria-busy", String(state.loading || state.busy));
    highlight(rows.findIndex(item => item.app.id === activeId));
    fit();
  }

  function highlight(index) {
    rows.forEach((item, i) => item.row.classList.toggle("active", i === index));
    const item = rows[index];
    activeId = item ? item.app.id : null;
    if (item) item.row.scrollIntoView({ block: "nearest" });
  }

  // The popover takes the size of its content.
  let frame = 0;
  function fit() {
    if (opening) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const width = Math.min(600, Math.max(80, Math.ceil(root.getBoundingClientRect().width)));
      const height = Math.min(720, Math.max(80, Math.ceil(root.scrollHeight)));
      quietly(() => muxy.popover.resize(width, height));
    });
  }

  function close() {
    quietly(() => (opening ? muxy.modal.closeWebview() : muxy.popover.close()));
  }

  async function choose(app) {
    if (state.busy || !state.target) return;
    const system = os();
    const remember = () => Promise.all([
      quietly(() => muxy.storage.set(lib.SELECTED_KEY, lib.selection(app, system))),
      quietly(() => muxy.topbar.set({ id: "open", icon: lib.topbarIcon(app, system) })),
    ]);
    if (!opening) {
      state.selectedId = app.id;
      await remember();
      close();
      return;
    }
    state.busy = true;
    state.openError = null;
    render();
    try {
      const result = await muxy.exec(lib.execRequest(lib.launchScript(app, state.target.dir, system)));
      if (!result || result.exitCode !== 0) throw new Error(lib.failure(result, "Couldn't open " + app.name));
      await remember();
      await quietly(() => muxy.modal.submitWebview({ opened: app.id }));
    } catch (error) {
      state.busy = false;
      state.openError = lib.message(error);
      render();
    }
  }

  // Shows the saved list right away, then looks for apps again.
  async function refresh() {
    state.loading = true;
    render();
    try {
      const result = await muxy.exec(lib.execRequest(lib.discoveryScript()));
      const cache = lib.mergeIcons(lib.parseDiscovery(result), state.cache);
      const icons = lib.iconsScript(cache);
      if (icons) {
        const found = await quietly(() => muxy.exec(lib.execRequest(icons)));
        if (found && found.exitCode === 0) lib.applyIcons(cache, found.stdout);
      }
      state.cache = cache;
      state.listError = null;
      quietly(() => muxy.storage.set(lib.CACHE_KEY, lib.cacheable(cache)));
    } catch (error) {
      state.listError = lib.message(error);
    }
    state.loading = false;
    render();
  }

  document.addEventListener("keydown", event => {
    if (event.isComposing) return;
    const index = rows.findIndex(item => item.app.id === activeId);
    switch (event.key) {
      case "ArrowDown":
        highlight(rows.length ? (index + 1) % rows.length : -1);
        break;
      case "ArrowUp":
        highlight(rows.length ? (index <= 0 ? rows.length - 1 : index - 1) : -1);
        break;
      case "Home":
        highlight(rows.length ? 0 : -1);
        break;
      case "End":
        highlight(rows.length - 1);
        break;
      case "Enter":
      case " ":
        if (rows[index]) choose(rows[index].app);
        break;
      case "Escape":
        close();
        break;
      default:
        return;
    }
    event.preventDefault();
  });
  root.addEventListener("mouseleave", () => highlight(-1));

  async function start() {
    const [cache, selected, worktrees, projects] = await Promise.all([
      quietly(() => muxy.storage.get(lib.CACHE_KEY)),
      quietly(() => muxy.storage.get(lib.SELECTED_KEY)),
      quietly(() => muxy.worktrees.list()),
      quietly(() => muxy.projects.list()),
    ]);
    state.cache = lib.validCache(cache);
    state.selectedId = selected && selected.id ? selected.id : null;
    state.target = lib.activeTarget(worktrees, projects);
    if (state.target) await refresh();
    else render();
  }

  window.focus();
  start();
})();
