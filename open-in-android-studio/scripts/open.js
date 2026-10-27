// Opens the active worktree (or project) folder in Android Studio, the same
// way Muxy 1.x's "Open in IDE" button did: /usr/bin/open -a <IDE> <path>.
(() => {
  // App names as they appear in /Applications; the first one found is used.
  const APPS = ["Android Studio Preview", "Android Studio"];

  const report = (body) => muxy.toast({ title: "Open in Android Studio", body });

  const activePath = () => {
    const worktree = muxy.worktrees.list().find((w) => w.isActive);
    if (worktree && worktree.path) return worktree.path;
    const project = muxy.projects.list().find((p) => p.isActive);
    return project ? project.path : null;
  };

  try {
    const path = activePath();
    if (!path) {
      report("No active project.");
      return;
    }
    const errors = [];
    for (const app of APPS) {
      const result = muxy.exec(["/usr/bin/open", "-a", app, path]);
      if (result.exitCode === 0) return;
      errors.push((result.stderr || result.stdout || `open exited with code ${result.exitCode}`).trim());
    }
    const failure = errors.find((error) => !error.startsWith("Unable to find application"));
    report(failure || `Couldn't find ${APPS.join(" or ")}.`);
  } catch (error) {
    report(error && error.message ? error.message : String(error));
  }
})();
