// Open in IDE: Muxy 1.x's "Open in IDE" control, rebuilt as a Muxy 2 extension.
//
// This file is both
//   - the script of the top-bar button and the "Open in IDE" command (main(),
//     at the bottom): it opens the active worktree or project in the chosen app;
//   - the shared library of menu/index.html, which loads it with <script src>
//     and uses globalThis.OpenInIDE.
//
// Everything that touches the system runs as `/bin/sh -s` with the script on
// stdin, so Muxy asks for permission once and "Allow & Remember" covers it.
// macOS: apps are found with JavaScript for Automation and opened with
// /usr/bin/open, like 1.x. Linux: apps come from .desktop files.
(function (root) {
  "use strict";

  const TITLE = "Open in IDE";
  const CACHE_KEY = "apps";
  const SELECTED_KEY = "selected";
  const HELPER = "/bin/sh -s";
  const CODE = "chevron.left.forwardslash.chevron.right";
  const CODE_ICON = { svg: "icons/code.svg" };
  const ANDROID_ICON = { svg: "icons/android.svg" };
  const ANDROID_STUDIO = /android[\s._-]?studio/i;
  const FINDER_ID = "com.apple.finder";
  const FILE_MANAGER_ID = "file-manager";
  const MAX_CACHE = 900 * 1024;
  const MESSAGES = Object.freeze({
    noProject: "Open a project to enable opening",
    noProjectToChoose: "Open a project to choose a target",
    noEditors: "No supported editors found",
    localOnly: "Open in IDE works with local projects only.",
    denied: "Open in IDE isn't allowed to run its helper (/bin/sh -s). Allow it when Muxy asks.",
  });

  // Muxy 1.x's app catalogue and matching rules (IDEIntegrationService.swift).
  // It is also inlined into the osascript discovery script, so it must stay
  // self-contained.
  function makeMatcher() {
    const CODE = "chevron.left.forwardslash.chevron.right";
    const CURATED = {
      "com.microsoft.VSCode": [CODE, 10, 0], "com.microsoft.VSCodeInsiders": [CODE, 11, 0],
      "com.vscodium": [CODE, 12, 0], "com.todesktop.230313mzl4w4u92": ["cursorarrow.click.2", 13, 0],
      "dev.zed.Zed": ["bolt.horizontal", 14, 0], "com.exafunction.windsurf": ["wind", 15, 0],
      "com.qoder.ide": [CODE, 16, 0], "com.apple.dt.Xcode": ["hammer", 17, 0],
      "com.jetbrains.PhpStorm": [CODE, 18, 0], "com.jetbrains.WebStorm": [CODE, 19, 0],
      "com.jetbrains.PyCharm": [CODE, 20, 0], "com.jetbrains.IntelliJ-IDEA": [CODE, 21, 0],
      "com.jetbrains.CLion": [CODE, 22, 0], "com.jetbrains.GoLand": [CODE, 23, 0],
      "com.jetbrains.RubyMine": [CODE, 24, 0], "com.jetbrains.DataGrip": [CODE, 25, 0],
      "com.jetbrains.Rider": [CODE, 26, 0], "com.jetbrainsFleet": [CODE, 27, 0],
      "com.panic.Nova": [CODE, 28, 0], "com.sublimetext.4": ["text.cursor", 29, 0],
      "com.barebones.bbedit": ["text.cursor", 30, 0], "com.macromates.TextMate": ["text.cursor", 31, 0],
      "org.gnu.Emacs": ["text.cursor", 32, 0], "org.aquamacs.Aquamacs": ["text.cursor", 33, 0],
      "com.code.athas": [CODE, 34, 0],
      "com.openai.codex": ["sparkles.rectangle.stack", 80, 1], "ai.opencode.desktop": [CODE, 81, 1],
      "com.google.antigravity-ide": ["sparkles", 82, 1], "com.jetbrains.air": ["sparkles", 84, 1],
    };
    const AI = ["com.openai.codex", "ai.opencode.desktop", "com.google.antigravity-ide", "com.jetbrains.air"];
    const KEYWORDS = [
      ["visual studio code", CODE], ["vscode", CODE], ["code - insiders", CODE], ["vscodium", CODE],
      ["cursor", "cursorarrow.click.2"], ["zed", "bolt.horizontal"], ["windsurf", "wind"], ["xcode", "hammer"],
      ["phpstorm", CODE], ["webstorm", CODE], ["pycharm", CODE], ["rubymine", CODE], ["clion", CODE],
      ["goland", CODE], ["datagrip", CODE], ["rider", CODE], ["fleet", CODE], ["intellij", CODE],
      ["android studio", CODE], ["nova", CODE], ["sublime text", "text.cursor"], ["bbedit", "text.cursor"],
      ["textmate", "text.cursor"], ["emacs", "text.cursor"], ["aquamacs", "text.cursor"],
    ];
    const FRAGMENTS = ["cursor", "zed", "studio", "storm", "editor", "nova", "fleet", "windsurf", "xcode",
      "sublime", "bbedit", "textmate", "emacs", "aquamacs", "phpstorm", "webstorm", "pycharm", "rubymine",
      "clion", "goland", "datagrip", "rider", "intellij", "idea", "android studio"];
    const tokens = text => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const contains = (keyword, haystack) => {
      const need = tokens(keyword);
      if (!need.length || haystack.length < need.length) return false;
      for (let i = 0; i + need.length <= haystack.length; i++) {
        if (need.every((token, j) => haystack[i + j] === token)) return true;
      }
      return false;
    };
    const result = (symbol, rank, group) => ({ symbol, rank, group: group ? "other" : "editor" });
    const match = app => {
      const curated = Object.prototype.hasOwnProperty.call(CURATED, app.id) ? CURATED[app.id] : null;
      if (curated) return result(curated[0], curated[1], curated[2]);
      const name = (app.name || "").toLowerCase();
      const executable = (app.executable || "").toLowerCase();
      const id = (app.id || "").toLowerCase();
      if (id === "com.jetbrains.toolbox" || name.includes("toolbox")) return null;
      if (id.startsWith("com.jetbrains.")) {
        const ai = AI.includes(id);
        return result(ai ? "sparkles" : CODE, 40, ai ? 1 : 0);
      }
      const haystack = tokens([name, executable, id].filter(Boolean).join(" "));
      const keyword = KEYWORDS.findIndex(([word]) => contains(word, haystack));
      if (keyword >= 0) return result(KEYWORDS[keyword][1], 10 + keyword, 0);
      if (app.developerTool) {
        const nameTokens = tokens(name), executableTokens = tokens(executable);
        if (FRAGMENTS.some(f => contains(f, nameTokens) || contains(f, executableTokens))) return result(CODE, 90, 0);
      }
      return null;
    };
    match.curatedIds = Object.keys(CURATED).sort();
    return match;
  }

  // Runs inside osascript (JavaScript for Automation), not in Muxy: scans
  // /Applications and ~/Applications like 1.x, renders each app's icon, and
  // reads the target 1.x remembered.
  function discoverMac(makeMatcher, iconPixels) {
    ObjC.import("AppKit");
    const match = makeMatcher();
    const text = value => {
      if (!value || value.isNil()) return "";
      const unwrapped = ObjC.unwrap(value);
      return typeof unwrapped === "string" ? unwrapped : "";
    };
    const workspace = $.NSWorkspace.sharedWorkspace;
    const apps = [], seen = {};
    const icon = path => {
      try {
        const image = workspace.iconForFile(path);
        const rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(
          null, iconPixels, iconPixels, 8, 4, true, false, $.NSCalibratedRGBColorSpace, 0, 0);
        rep.size = $.NSMakeSize(iconPixels, iconPixels);
        $.NSGraphicsContext.saveGraphicsState;
        $.NSGraphicsContext.setCurrentContext($.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep));
        image.drawInRectFromRectOperationFraction($.NSMakeRect(0, 0, iconPixels, iconPixels), $.NSZeroRect, $.NSCompositingOperationSourceOver, 1);
        $.NSGraphicsContext.restoreGraphicsState;
        const png = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $());
        return "data:image/png;base64," + text(png.base64EncodedStringWithOptions(0));
      } catch (error) {
        return null;
      }
    };
    const consider = url => {
      const info = $.NSDictionary.dictionaryWithContentsOfURL(url.URLByAppendingPathComponent("Contents/Info.plist"));
      if (info.isNil()) return;
      const path = text(url.standardizedURL.path);
      const meta = {
        id: text(info.objectForKey("CFBundleIdentifier")),
        name: text(info.objectForKey("CFBundleDisplayName")) || text(info.objectForKey("CFBundleName")) || text(url.URLByDeletingPathExtension.lastPathComponent),
        executable: text(info.objectForKey("CFBundleExecutable")),
        developerTool: text(info.objectForKey("LSApplicationCategoryType")) === "public.app-category.developer-tools",
      };
      const found = match(meta);
      if (!found) return;
      const key = meta.id || path;
      if (seen[key]) return;
      seen[key] = true;
      apps.push({ id: meta.id || path, name: meta.name, path, symbol: found.symbol, rank: found.rank, group: found.group });
    };
    const manager = $.NSFileManager.defaultManager;
    for (const root of ["/Applications", text($.NSHomeDirectory()) + "/Applications"]) {
      if (!manager.fileExistsAtPath(root)) continue;
      const items = manager.enumeratorAtURLIncludingPropertiesForKeysOptionsErrorHandler(
        $.NSURL.fileURLWithPath(root), $(), $.NSDirectoryEnumerationSkipsHiddenFiles, null);
      for (let url = items.nextObject; !url.isNil(); url = items.nextObject) {
        if (text(url.pathExtension).toLowerCase() !== "app") continue;
        consider(url);
        items.skipDescendants;
      }
    }
    for (const id of match.curatedIds) {
      const url = workspace.URLForApplicationWithBundleIdentifier(id);
      if (!url.isNil()) consider(url);
    }
    for (const app of apps) app.icon = icon(app.path);
    const legacy = text($.NSUserDefaults.alloc.initWithSuiteName("com.muxy.app").stringForKey("muxy.ide.selectedBundleIdentifier"));
    return { os: "macos", apps, browserIcon: icon("/System/Library/CoreServices/Finder.app"), legacy: legacy || null };
  }

  // ---------------------------------------------------------------- shell

  const quote = value => "'" + String(value).replace(/'/g, "'\\''") + "'";

  // A project on a remote server runs commands there, where opening an app
  // makes no sense. Same SSH and desktop-session checks as Muxy's CLI.
  const GUARD = [
    'if [ -n "${SSH_CONNECTION:-}${SSH_CLIENT:-}${SSH_TTY:-}" ] ||',
    '  { [ "$(uname -s)" != Darwin ] && [ -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; }; then',
    "  echo " + quote(MESSAGES.localOnly) + " >&2",
    "  exit 3",
    "fi",
  ].join("\n");

  // XDG data directories, plus Flatpak and Snap exports that a desktop
  // session adds to XDG_DATA_DIRS but Muxy's environment may lack.
  const DATA_DIRS = 'dirs="${XDG_DATA_HOME:-$HOME/.local/share}:${XDG_DATA_DIRS:-/usr/local/share:/usr/share}:'
    + '$HOME/.local/share/flatpak/exports/share:/var/lib/flatpak/exports/share:/var/lib/snapd/desktop"';

  // Prints "\036<file>" and the [Desktop Entry] keys we need for each file.
  const DESKTOP_AWK = [
    'FNR == 1 { printf "\\036%s\\n", FILENAME; group = "" }',
    '/^[ \\t]*\\[/ { group = $0; gsub(/^[ \\t]+|[ \\t\\r]+$/, "", group); next }',
    'group == "[Desktop Entry]" && /^(Type|Name|Exec|Icon|Categories|NoDisplay|Hidden|Terminal)[ \\t]*=/ { sub(/\\r$/, ""); print }',
  ].join("\n");

  const LINUX_SCAN = [
    "set -f",
    DATA_DIRS,
    "IFS=:",
    "printf '#linux\\n'",
    "for base in $dirs; do",
    '  [ -n "$base" ] && [ -d "$base/applications" ] || continue',
    "  printf '\\035%s\\n' \"$base/applications\"",
    "  find -L \"$base/applications\" -type f -name '*.desktop' -exec awk '" + DESKTOP_AWK + "' {} + 2>/dev/null",
    "done",
    "exit 0",
  ].join("\n");

  // Prints "<name>\t<mime>\t<base64>" for each icon name it finds.
  const ICON_LOOKUP = [
    "set -f",
    DATA_DIRS,
    "IFS=:",
    "emit() {",
    '  [ -f "$2" ] || return 1',
    '  bytes=$(wc -c < "$2" | tr -d " ")',
    '  [ "$bytes" -le 65536 ] || return 1',
    '  case "$2" in',
    "    *.png) mime=image/png ;;",
    "    *.svg) mime=image/svg+xml ;;",
    "    *) return 1 ;;",
    "  esac",
    "  printf '%s\\t%s\\t' \"$1\" \"$mime\"",
    "  base64 < \"$2\" | tr -d '\\n'",
    "  printf '\\n'",
    "}",
    "lookup() {",
    '  case "$1" in',
    '    /*) emit "$1" "$1"; return ;;',
    "  esac",
    "  for base in $dirs; do",
    "    for size in 32x32 48x48 64x64 128x128 256x256; do",
    '      emit "$1" "$base/icons/hicolor/$size/apps/$1.png" && return',
    "    done",
    '    emit "$1" "$base/icons/hicolor/scalable/apps/$1.svg" && return',
    "  done",
    '  emit "$1" "/usr/share/pixmaps/$1.png" || emit "$1" "/usr/share/pixmaps/$1.svg" || emit "$1" "/usr/share/pixmaps/$1"',
    "}",
  ].join("\n");

  // Starts the app in its own session: Muxy kills a command's whole process
  // group when it exits. The command substitution returns only after the app
  // has been exec'd (its stdout is then /dev/null), so the handoff is race-free.
  const LINUX_LAUNCH = [
    'if ! command -v "$1" >/dev/null 2>&1; then echo "$1: command not found" >&2; exit 127; fi',
    "if ! command -v setsid >/dev/null 2>&1; then echo 'setsid (util-linux) is needed to start apps.' >&2; exit 1; fi",
    "started=$(setsid sh -c 'exec \"$@\" </dev/null >/dev/null 2>&1' open-in-ide \"$@\" &)",
    "exit 0",
  ].join("\n");

  // Like 1.x, VS Code-like editors and Zed open through their command-line
  // tool when it's installed, and everything else through `open -a`.
  const CLI_NAMES = {
    "com.microsoft.VSCode": ["code"], "com.microsoft.VSCodeInsiders": ["code-insiders"],
    "com.todesktop.230313mzl4w4u92": ["cursor"], "com.exafunction.windsurf": ["windsurf"],
    "com.vscodium": ["codium", "vscodium"], "com.qoder.ide": ["qoder"], "dev.zed.Zed": ["zed"],
  };

  function macLaunch(app, dir) {
    if (app.id === FINDER_ID) return "exec /usr/bin/open " + quote(dir) + " </dev/null";
    const lines = [];
    const names = Object.prototype.hasOwnProperty.call(CLI_NAMES, app.id) ? CLI_NAMES[app.id] : null;
    if (names) {
      lines.push(
        "set -f",
        'search="${PATH:-}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"',
        "IFS=:",
        "for name in " + names.map(quote).join(" ") + "; do",
        "  for d in $search; do",
        '    if [ -n "$d" ] && [ -f "$d/$name" ] && [ -x "$d/$name" ]; then exec "$d/$name" ' + quote(dir) + " </dev/null; fi",
        "  done",
        "done");
    }
    // `open -a` reports a missing app with a long Cocoa error; say it plainly.
    lines.push(
      "if [ ! -d " + quote(app.path) + " ]; then echo " + quote("Couldn't find " + app.name + " at " + app.path + ".") + " >&2; exit 1; fi",
      "exec /usr/bin/open -a " + quote(app.path) + " " + quote(dir) + " </dev/null");
    return lines.join("\n");
  }

  const execRequest = (script, timeoutMs) => ({ shell: HELPER, stdin: script, timeoutMs: timeoutMs || 60000 });

  function discoveryScript() {
    return [
      "{",
      GUARD,
      'if [ "$(uname -s)" = Darwin ]; then',
      "exec /usr/bin/osascript -l JavaScript <<'OPEN_IN_IDE_JXA'",
      "JSON.stringify((" + discoverMac + ")(" + makeMatcher + ", 32))",
      "OPEN_IN_IDE_JXA",
      "fi",
      LINUX_SCAN,
      "}",
    ].join("\n");
  }

  function iconsScript(cache) {
    if (!cache || cache.os !== "linux") return null;
    const names = [...new Set(cache.apps.filter(app => !app.icon && app.iconName).map(app => app.iconName))];
    if (!names.length) return null;
    return ["{", ICON_LOOKUP, "for name in " + names.map(quote).join(" ") + "; do", '  lookup "$name"', "done", "exit 0", "}"].join("\n");
  }

  function launchScript(app, dir, os) {
    let run;
    if (os === "linux") {
      const argv = app.id === FILE_MANAGER_ID ? ["xdg-open", dir] : execArgv(app, dir);
      run = "set -- " + argv.map(quote).join(" ") + "\n" + LINUX_LAUNCH;
    } else {
      run = macLaunch(app, dir);
    }
    return ["{", GUARD, run, "}"].join("\n");
  }

  // -------------------------------------------------------------- results

  // An error message for a failed command; `what` is like "Couldn't open Xcode".
  function failure(result, what) {
    if (result && result.timedOut) return what + ": it didn't respond in time.";
    const text = result ? String(result.stderr || "").trim() : "";
    if (text) return text.split("\n").slice(-3).join("\n").slice(0, 400);
    const code = result && Number.isFinite(result.exitCode) && result.exitCode !== 0 ? " (exit code " + result.exitCode + ")" : "";
    return what + code + ".";
  }

  function parseDiscovery(result) {
    if (!result || result.exitCode !== 0) throw new Error(failure(result, "Couldn't list the installed apps"));
    const output = String(result.stdout || "");
    if (output.startsWith("#linux")) return parseLinux(output);
    let found = null;
    try {
      found = JSON.parse(output);
    } catch (_) {
      // reported below
    }
    if (!found || !Array.isArray(found.apps)) throw new Error("Couldn't read the list of installed apps.");
    return { os: "macos", apps: found.apps, browserIcon: found.browserIcon || null, legacy: found.legacy || null, time: Date.now() };
  }

  // Desktop Entry string escapes.
  const unescapeValue = value => value.replace(/\\([sntr\\])/g, (_, c) => ({ s: " ", n: "\n", t: "\t", r: "\r", "\\": "\\" })[c]);

  // Splits an Exec value into arguments, honoring its double-quote rules.
  function splitExec(line) {
    const args = [];
    let current = null, quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quoted) {
        if (c === "\\" && i + 1 < line.length && "\"`$\\".includes(line[i + 1])) current += line[++i];
        else if (c === "\"") quoted = false;
        else current += c;
      } else if (c === "\"") {
        quoted = true;
        if (current === null) current = "";
      } else if (c === " " || c === "\t" || c === "\n") {
        if (current !== null) args.push(current);
        current = null;
      } else {
        current = (current === null ? "" : current) + c;
      }
    }
    if (current !== null) args.push(current);
    return args;
  }

  // The program an Exec line runs, for matching by name.
  function programName(exec) {
    const args = splitExec(exec);
    let i = 0;
    if (args[i] && args[i].split("/").pop() === "env") {
      i++;
      while (args[i] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(args[i])) i++;
    }
    let program = args[i] || "";
    if (program.split("/").pop() === "flatpak") {
      const command = args.find(arg => arg.startsWith("--command="));
      if (command) program = command.slice("--command=".length);
    }
    return program.split("/").pop();
  }

  // Expands an Exec line's field codes to open `dir`.
  function execArgv(app, dir) {
    const argv = [];
    let opensFile = false;
    for (const token of splitExec(app.exec || "")) {
      if (token === "%i") {
        if (app.iconName) argv.push("--icon", app.iconName);
        continue;
      }
      const value = token.replace(/%(.)/g, (code, c) => {
        switch (c) {
          case "%": return "%";
          case "f": case "F": case "u": case "U": opensFile = true; return dir;
          case "c": return app.name || "";
          case "k": return app.desktop || "";
          case "i": return app.iconName || "";
          default: return "";
        }
      });
      if (value !== "" || token === "") argv.push(value);
    }
    if (!opensFile) argv.push(dir);
    return argv;
  }

  function parseLinux(output) {
    const match = makeMatcher();
    const entries = [];
    let base = "", entry = null;
    for (const line of output.split("\n")) {
      if (line[0] === "\x1d") {
        base = line.slice(1);
        entry = null;
      } else if (line[0] === "\x1e") {
        entry = { file: line.slice(1), base, keys: {} };
        entries.push(entry);
      } else if (entry) {
        const equals = line.indexOf("=");
        const key = equals > 0 ? line.slice(0, equals).trim() : "";
        if (key && !Object.prototype.hasOwnProperty.call(entry.keys, key)) entry.keys[key] = unescapeValue(line.slice(equals + 1).trim());
      }
    }
    const apps = [], seen = new Set();
    for (const { file, base: dir, keys } of entries) {
      const relative = file.startsWith(dir + "/") ? file.slice(dir.length + 1) : file.split("/").pop();
      const desktopId = relative.replace(/\//g, "-");
      // The first file with an ID wins, even a hidden one, which hides the others.
      if (seen.has(desktopId)) continue;
      seen.add(desktopId);
      if (keys.Type !== "Application" || !keys.Exec || !keys.Name) continue;
      if (keys.Hidden === "true" || keys.NoDisplay === "true" || keys.Terminal === "true") continue;
      const categories = (keys.Categories || "").split(";").filter(Boolean);
      const meta = {
        id: desktopId.replace(/\.desktop$/, ""),
        name: keys.Name,
        executable: programName(keys.Exec),
        developerTool: categories.includes("Development") || categories.includes("IDE"),
      };
      const found = match(meta) || (categories.includes("IDE") ? { symbol: CODE, rank: 90, group: "editor" } : null);
      if (!found) continue;
      apps.push({
        id: meta.id, name: meta.name, exec: keys.Exec, desktop: file, iconName: keys.Icon || null, icon: null,
        symbol: found.symbol, rank: found.rank, group: found.group,
      });
    }
    return { os: "linux", apps, browserIcon: null, legacy: null, time: Date.now() };
  }

  function applyIcons(cache, output) {
    const icons = new Map();
    for (const line of String(output || "").split("\n")) {
      const [name, mime, data] = line.split("\t");
      if (name && mime && data) icons.set(name, "data:" + mime + ";base64," + data);
    }
    for (const app of cache.apps) {
      if (!app.icon && icons.has(app.iconName)) app.icon = icons.get(app.iconName);
    }
    return cache;
  }

  // Keeps icons from the previous list for apps whose icon wasn't loaded again.
  function mergeIcons(cache, previous) {
    if (!previous || previous.os !== cache.os || !Array.isArray(previous.apps)) return cache;
    const key = app => app.id + "\n" + (app.iconName || "");
    const icons = new Map(previous.apps.filter(app => app && app.icon).map(app => [key(app), app.icon]));
    for (const app of cache.apps) {
      if (!app.icon && icons.has(key(app))) app.icon = icons.get(key(app));
    }
    if (!cache.browserIcon && previous.browserIcon) cache.browserIcon = previous.browserIcon;
    return cache;
  }

  // Storage values are capped at 1 MiB: drop the largest icons if needed.
  function cacheable(cache) {
    const copy = Object.assign({}, cache, { apps: cache.apps.map(app => Object.assign({}, app)) });
    let size = JSON.stringify(copy).length;
    const heavy = copy.apps.filter(app => app.icon).sort((a, b) => b.icon.length - a.icon.length);
    for (const app of heavy) {
      if (size <= MAX_CACHE) break;
      size -= app.icon.length;
      app.icon = null;
    }
    return copy;
  }

  const validCache = cache => cache && Array.isArray(cache.apps) && (cache.os === "macos" || cache.os === "linux") ? cache : null;

  // ------------------------------------------------------- 1.x semantics

  const compareNames = (a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: "accent" });
  const GROUPS = { editor: 0, other: 1 };

  // Editors before other tools, then 1.x rank, name, and path.
  function sortApps(apps) {
    const where = app => app.path || app.desktop || app.id;
    return apps.slice().sort((a, b) =>
      (GROUPS[a.group] || 0) - (GROUPS[b.group] || 0) || a.rank - b.rank || compareNames(a.name, b.name)
      || (where(a) < where(b) ? -1 : where(a) > where(b) ? 1 : 0));
  }

  // The popover's sections, each sorted by name.
  function sections(apps) {
    const byName = (a, b) => compareNames(a.name, b.name);
    return [
      ["Editors & IDEs", apps.filter(app => app.group !== "other").sort(byName)],
      ["Other Tools", apps.filter(app => app.group === "other").sort(byName)],
    ].filter(([, list]) => list.length);
  }

  function fileBrowser(cache) {
    return cache && cache.os === "linux"
      ? { id: FILE_MANAGER_ID, name: "File Manager", symbol: "folder", rank: 79, group: "other", icon: null }
      : { id: FINDER_ID, name: "Finder", path: "/System/Library/CoreServices/Finder.app", symbol: "folder", rank: 79, group: "other", icon: (cache && cache.browserIcon) || null };
  }

  // The remembered target if it's still installed, else the first app (1.x).
  function resolveDefault(cache, id) {
    const browser = fileBrowser(cache);
    if (id && id === browser.id) return browser;
    const apps = sortApps(cache.apps);
    return (id && apps.find(app => app.id === id)) || apps[0] || null;
  }

  // Top-bar items can't show app icons, so use the 1.x symbol for the app, or
  // the Android logo for Android Studio (macOS: com.google.android.studio;
  // Linux: android-studio, com.google.AndroidStudio, or an "Android Studio"
  // entry).
  function topbarIcon(app, os) {
    if (app && [app.id, app.name].some(text => ANDROID_STUDIO.test(String(text || "")))) return ANDROID_ICON;
    const symbol = (app && app.symbol) || CODE;
    if (symbol === CODE) return CODE_ICON;
    if (os === "macos") return symbol;
    if (symbol === "folder") return "folder";
    return symbol.startsWith("sparkles") ? "sparkles" : CODE_ICON;
  }

  const selection = (app, os) => ({ id: app.id, name: app.name, topbarIcon: topbarIcon(app, os) });

  // The active worktree's folder, else the active project's (like 1.x).
  function activeTarget(worktrees, projects) {
    const project = (projects || []).find(item => item && item.isActive) || null;
    const worktree = (worktrees || []).find(item => item && item.isActive && item.path) || null;
    const dir = (worktree && worktree.path) || (project && project.path) || null;
    if (!dir) return null;
    let label = project && project.name ? project.name : dir.split("/").filter(Boolean).pop() || dir;
    if (worktree && project && worktree.path !== project.path && worktree.name) label += " · " + worktree.name;
    return { dir, label };
  }

  function message(error) {
    const text = String((error && error.message) || error || "").replace(/^Error:\s*/, "");
    if (/denied consent/i.test(text)) return MESSAGES.denied;
    return text || "Something went wrong.";
  }

  // ------------------------------------------------------ top-bar button

  function main(muxy) {
    const quietly = run => {
      try {
        run();
      } catch (_) {
        // nothing else to tell
      }
    };
    const toast = body => quietly(() => muxy.toast({ title: TITLE, body }));
    const list = read => {
      try {
        return read() || [];
      } catch (_) {
        return [];
      }
    };
    try {
      const target = activeTarget(list(() => muxy.worktrees.list()), list(() => muxy.projects.list()));
      if (!target) {
        toast(MESSAGES.noProject);
        return;
      }
      const selected = muxy.storage.get(SELECTED_KEY);
      let cache = validCache(muxy.storage.get(CACHE_KEY));
      let fresh = false;
      const discover = () => {
        cache = mergeIcons(parseDiscovery(muxy.exec(execRequest(discoveryScript()))), cache);
        fresh = true;
        try {
          muxy.storage.set(CACHE_KEY, cacheable(cache));
        } catch (_) {
          // only a cache
        }
      };
      if (!cache) discover();
      const wanted = selected && selected.id ? selected.id : cache.legacy;
      let app = resolveDefault(cache, wanted);
      if (!app && !fresh) {
        discover();
        app = resolveDefault(cache, wanted);
      }
      if (!app) {
        toast(MESSAGES.noEditors);
        return;
      }
      let result = muxy.exec(execRequest(launchScript(app, target.dir, cache.os)));
      if (result.exitCode !== 0 && result.exitCode !== 3 && !fresh) {
        // The app may have moved or been removed since the list was made.
        discover();
        const retry = resolveDefault(cache, app.id);
        if (retry) {
          const again = muxy.exec(execRequest(launchScript(retry, target.dir, cache.os)));
          if (again.exitCode === 0 && retry.id !== app.id) toast("Opened in " + retry.name + " because " + app.name + " wasn't found.");
          result = again;
          app = retry;
        }
      }
      if (result.exitCode !== 0) {
        toast(failure(result, "Couldn't open " + app.name));
        return;
      }
      // The app is open, so remembering it and updating the button is best-effort.
      quietly(() => muxy.storage.set(SELECTED_KEY, selection(app, cache.os)));
      quietly(() => muxy.topbar.set({ id: "open", icon: topbarIcon(app, cache.os) }));
    } catch (error) {
      toast(message(error));
    }
  }

  root.OpenInIDE = Object.freeze({
    TITLE, CACHE_KEY, SELECTED_KEY, HELPER, MESSAGES,
    makeMatcher, quote, execRequest, discoveryScript, iconsScript, launchScript,
    failure, parseDiscovery, parseLinux, splitExec, programName, execArgv, applyIcons, mergeIcons, cacheable, validCache,
    sortApps, sections, fileBrowser, resolveDefault, topbarIcon, selection, activeTarget, message, main,
  });

  if (typeof document === "undefined" && typeof muxy !== "undefined") main(muxy);
})(globalThis);
