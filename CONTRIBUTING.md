# Contributing to HubDev Buddy

Welcome. The plugin is about 5,500 lines of QML and plain JavaScript. It has no build step and
no npm dependencies: Node is only the test runner. The git checkout in
`~/.config/omarchy/plugins/io.hubdev.buddy` *is* the live plugin. You can be productive in it
after reading this page.

For *what* the plugin runs and touches, read
[What it runs, what it touches](README.md#what-it-runs-what-it-touches) in the README. For
*why* it is built this way (the plan, the measurements, the daily changelogs), read the
development record in
[hubdev-omarchy-buddy-docs](https://github.com/hubdev-io/hubdev-omarchy-buddy-docs).

## What you need

| | |
|---|---|
| Omarchy | Quattro 4.0.x or newer (`omarchy version`) |
| HubDev | v1.29.0 or newer at `/usr/bin/hubdev` (`hubdev --version`). That release ships `hubdev snapshot --json`, the one read the widget makes |
| Node.js | Any current release, for the tests only. Nothing in the plugin runs on Node |

## Stack

| Layer | Technology |
|-------|------------|
| Runtime | [Quickshell](https://quickshell.org/), the QML engine behind `omarchy-shell`. The plugin uses its `Process`, `SplitParser`, `Timer` and `IpcHandler` types |
| UI | QML / Qt Quick, plus the shell's own `qs.Commons` (`Util.execArgv`, theme tokens) and `qs.Ui` (`BarWidget`, `BarIconButton`, `Style`). Their source is in `/usr/share/omarchy/shell/` |
| Logic | Plain ES5 JavaScript files (`.pragma library`), run by QML's JS engine |
| Data | `hubdev snapshot --json --include=…`, one JSON document per poll |
| Desktop | `omarchy-launch-browser` for site links. HubDev's own `site:terminal`, `folder` and `edit` verbs for the other row actions |
| Tests | The Node.js built-in runner (`node --test`), with no test framework |
| Tooling | `omarchy plugin validate`, `tools/privacy-scan.mjs`, and `tools/hubdev-snapshot` (Python 3, a reference implementation of the contract) |

## First 10 minutes

```bash
# 1. Get a checkout where the shell loads it. It must be a real directory:
#    validation and the marketplace both reject a symlink.
git clone https://github.com/hubdev-io/hubdev-omarchy-buddy.git \
  ~/.config/omarchy/plugins/io.hubdev.buddy
cd ~/.config/omarchy/plugins/io.hubdev.buddy
omarchy plugin enable io.hubdev.buddy right
omarchy restart shell

# 2. Turn on the pre-commit hook (once per clone), then check that your setup is healthy
git config core.hooksPath .githooks
npm run check                   # npm test (under a second) + validate

# 3. Watch the shell's log while you work
quickshell log --pid $(pgrep -f 'quickshell -n -p /usr/share/omarchy/shell') -t 2000

# 4. Poke it without the mouse
omarchy-shell io.hubdev.buddy toggle      # also: open, close, refresh
```

If you installed with `omarchy plugin add`, that directory is already a git clone. Add your
fork as a remote instead of cloning again.

## Architecture

![Architecture of HubDev Buddy](docs/architecture/architecture.svg)

The design rests on one split. **`BarWidget.qml` is the only file that does I/O.** Every
decision is made in four pure JavaScript files (`SourceJson.js`, `Model.js`, `Actions.js`,
`Theme.js`) that import nothing from QML. Because of that, `node --test` loads *the exact files
the shell loads*, with no copy and no mock of Qt.

One refresh, start to finish:

1. The `poll` timer in `BarWidget.qml` fires. Its interval comes from
   `Source.intervalFor()`: the `refreshIntervalSec` setting (30 s by default) with the panel
   closed, 5 s while it is open, and an exponential backoff from 30 s after a failure.
2. `Source.tierFor()` picks a tier. The **cheap** tier asks only for `caddy,php,sites`. The
   **full** tier adds services, docker, health, tunnels and backups, which cost a Docker probe
   per service. An open panel alternates, so the full tier still runs only every 30 s.
3. `Source.request(tier)` returns the argv, `/usr/bin/hubdev snapshot --json --include=…`.
   `BarWidget.qml` runs it in its own `Process`. A guard timer from `Source.timeoutMs()` (5 s
   cheap, 15 s full) ends it, and a `SplitParser` enforces a byte budget while the output
   arrives. A child that misses its deadline or overruns the budget gets `SIGTERM`, then
   `SIGKILL`.
4. `Source.parse()` turns stdout and the exit code into a snapshot or a refusal. "This HubDev
   is too old" is a refusal with its own code, and the footer then offers *Update HubDev*.
5. `Model.merge()` lays the reply over the last document. A cheap-tier reply *omits* the
   sections it did not ask for, so merging keeps the services count from blanking every 5 s.
6. `Model.summarize()` reduces the document to the `summary` object. `Mark.qml` draws the mark
   and its dot from `summary.level`. `Panel.qml` and its sections draw the rows.

**An action goes the other way.** A row raises a signal, the panel builds the argv with
`Actions.siteArgv()`, `serviceArgv()` or `envArgv()`, and hands it to the widget.
`BarWidget.runDetached()` fires the detached ones (browser, terminal, folder, editor).
`BarWidget.runAction()` runs the service, Caddy and PHP verbs in a second `Process`, one at a
time, and `Actions.parseResult()` turns the result into the line at the foot of the panel.
A burst of refreshes follows, because the snapshot, not the exit code, is the answer.

**One widget per monitor.** IPC `refresh` goes to every instance, because every bar shows the
mark. `open`, `close` and `toggle` go only to the focused output, through `runOnFocused`.

The diagram source is
[`docs/architecture/architecture.architecture.json`](docs/architecture/architecture.architecture.json).
It is drawn with [Archify](https://github.com/tt-a1i/archify):

```bash
node <archify>/bin/archify.mjs validate architecture docs/architecture/architecture.architecture.json
node <archify>/bin/archify.mjs render architecture \
  docs/architecture/architecture.architecture.json /tmp/architecture.html
node <archify>/bin/archify.mjs check /tmp/architecture.html     # labels fit their boxes

# Export from a browser. Serve the file rather than opening file:// (Playwright refuses it)
cd /tmp && python3 -m http.server 47823 --bind 127.0.0.1
# open http://127.0.0.1:47823/architecture.html, Export ▸ Download SVG,
# and save it over docs/architecture/architecture.svg
```

Only the JSON source and the SVG are committed. The interactive HTML carries a script and
belongs to your machine, not to every user's plugin folder.

## Repository map

```
manifest.json           Plugin manifest: id, entry point, the two settings and their defaults
BarWidget.qml           The widget root. All I/O: the snapshot Process, the action Process,
                        detached launches, timers, IPC
Mark.qml                The mark in the bar and its state dot
Panel.qml               The popout: header, search, view switch, footer line, hand-offs
KeyCatcher.qml          The panel's keys. Why it replaces qs.Ui's is at the top of the file
SearchField.qml         The box that appears with the first keystroke
DenseView.qml           The compact list arrangement
ColumnsView.qml         The three-column arrangement of the same sections
*Section.qml            Sites, Services, Environment, Attention, Extras
Section.qml             The section frame they share
SiteRow.qml  ServiceRow.qml  InfoRow.qml  CollapseRow.qml  StatusDot.qml
                        One row of each kind, and the dot

SourceJson.js           Transport: the argv per tier, parsing, cadence, timeouts
Model.js                Every rule: merge, summarize, levels, grouping, search, wording,
                        the tooltip, plain-text stripping
Actions.js              The argv allowlist for every verb, the re-check against the current
                        snapshot, result parsing, and the keyboard's map of what it can reach
Theme.js                State colours and Nerd Font glyphs

test/harness.mjs        Loads the .js files above into node, blanking only .pragma/.import
test/*.test.mjs         The tests, one file per area (see Testing)
test/fixtures/          11 snapshot documents with stand-in site names
tools/privacy-scan.mjs  Fails on real home paths, client names (hashed denylist), secrets
tools/hubdev-snapshot   Dev-only reference implementation of `hubdev snapshot --json`,
                        written before the Go one and kept as its acceptance target
.githooks/pre-commit    Privacy scan + validate on what is about to be committed
docs/architecture/      The diagram: JSON source and SVG
```

## Where to make a change

| You want to… | Edit | Then |
|--------------|------|------|
| Change a level, a count, a label or the tooltip | `Model.js` | add a test in `test/model.test.mjs` |
| Change how services are grouped (`configured`, `startable`) | `Model.js` | add a test in `test/services.test.mjs` |
| Change the Environment rows | `Model.envRows()` | add a test in `test/environment.test.mjs` |
| Change how search matches | `Model.fuzzyMatch()` and `search*()` | add a test in `test/search.test.mjs` |
| Change when or how it polls | `SourceJson.js` | add a test in `test/source.test.mjs` |
| Add or change a verb | the allowlist in `Actions.js` (`SITE_ACTIONS`, `SERVICE_ACTIONS`, `ENV_ACTIONS`), then wire it in `Panel.qml` | add a test in `test/actions.test.mjs`, restart |
| Change arrow-key navigation | the `nav*` functions in `Actions.js` | add a test in `test/keyboard.test.mjs` |
| Change a state colour or glyph | `Theme.js` | `test/theme.test.mjs` |
| Change the panel layout | `Panel.qml`, the views, the sections or rows | `omarchy restart shell` |
| Change a key binding | `KeyCatcher.qml` / `Panel.qml` | `omarchy restart shell` |
| Change the bar mark | `Mark.qml` | `omarchy restart shell` |
| Add a setting | `manifest.json` (defaults + schema), read it with `root.setting(key, fallback)` in `BarWidget.qml` (see `pollState()`) and validate the value in the `.js` file that uses it | a test for the fallback, `npm run validate`, restart |
| Add an IPC verb | the `IpcHandler` in `BarWidget.qml` | restart |
| Use a new field from HubDev | the fixtures *and* `Model.js`, in one commit | only when the contract changed |

If a rule could live in either a `.qml` or a `.js` file, put it in the `.js` file, where a test
can reach it.

## The dev loop

| You changed | To see it |
|-------------|-----------|
| A `.js` file | `npm test`. The shell needs `omarchy restart shell` too |
| A `.qml` file | `omarchy restart shell`. Saving does **not** reload a bar widget |
| `manifest.json` | `npm run validate`, then `omarchy restart shell` |
| `shell.json` settings | Nothing. Settings hot-reload |

The shell logs `Local plugin changed, reloading: io.hubdev.buddy` on every save, but the running
widget keeps its old code. Edits seem to do nothing, and even a syntax error loads clean. To
check which version is live, compare the line number in a QML warning against the file.

Run `npm run check` before every commit. `npm run validate` exports exactly what would be
committed (`git checkout-index` of the index) to a temporary directory and runs
`omarchy plugin validate` on it. That is the same check `omarchy plugin add` runs after it
clones. `omarchy plugin validate .` on your working tree fails if it holds any symlink, for
example agent tooling linked into a git-ignored directory. That is why validate runs on the
export.

## Rules that are easy to break

- **Only `BarWidget.qml` does I/O.** Rows raise signals up to the panel, and the panel calls
  the widget. Nothing else spawns anything.
- **The four `.js` files import nothing from QML**, or node cannot load them.
- **The `import "SourceJson.js" as Source` line is the transport seam.** A replacement transport
  must export the same four functions: `request()`, `parse()`, `intervalFor()`, `timeoutMs()`.
- **Pick the right primitive.** `runDetached` (`Util.execArgv`) is for launches whose result
  nobody reads. Anything whose output or exit code matters goes through `runAction`, with its
  own timeout from `Actions.js`.
- **Every process comes from the `Actions.js` allowlist** (or `SourceJson.request()` for the
  read): `hubdev` by absolute path, argv arrays only, never a command string. Add no
  `StdioCollector`, because it reads without a bound.
- **Every `Text` sets `textFormat: Text.PlainText`.** A site or container name must never be
  read as markup.
- **Absent and empty are different answers.** The CLI omits a section you did not ask for and
  sends `[]` for one that is empty. `Model.merge()` depends on that difference.
- **Fixtures are the contract.** Change one only when `hubdev snapshot --json` changes.
- **An environment row is actionable if, and only if, `Model.envRows()` stamped a `target`** on
  it (`caddy`, `php:8.4`). That field gates both the buttons and search. Never match on the
  label.
- **`installed` does not mean "set up here".** It flips false on every stop. Use `configured`
  for grouping and the action gate, and `startable` for the auto-start warning.
- **Re-check every press against the current snapshot**, not the row the panel holds.
  `Actions.liveService()` and `envLive()` do this.
- **The cursor is a key (`site:<name>`), never an index.** The list re-sorts under it on every
  refresh and keystroke.
- **Never serialise secrets.** HubDev's `services.yml` and license file stay unread, in code,
  fixtures and test data.
- **The plugin never elevates.** The service, Caddy and PHP verbs use HubDev's own elevation.
  `site:fix` is deliberately not offered.
- **Never commit a symlink.** Validation and the marketplace reject the tree.
- **Laravel Reverb reads as stopped.** That is an upstream HubDev status bug. Do not work
  around it here: a port probe would make the widget disagree with its own data source.

## Testing

`test/harness.mjs` reads each `.js` file, blanks its `.pragma` / `.import` lines (keeping line
numbers intact), and evaluates it in node's own realm. That realm choice matters:
`assert.deepEqual` would otherwise fail on cross-realm arrays.

| File | Covers |
|------|--------|
| `model.test.mjs` | summarize, merge, levels, tooltip, secret sweep |
| `services.test.mjs` | service grouping and verbs |
| `environment.test.mjs` | environment rows, `target`, Caddy and PHP verbs |
| `search.test.mjs` | the bounded subsequence match |
| `keyboard.test.mjs` | cursor movement across rows and actions |
| `actions.test.mjs` | the allowlist, refusals, argv shape |
| `update.test.mjs` | the *Update HubDev* path |
| `source.test.mjs` | argv, parsing, tiers, cadence |
| `theme.test.mjs` | colours and glyphs |
| `hardening.test.mjs` | properties of the whole tree: `textFormat` on every `Text`, no `StdioCollector`, `hubdev` only by absolute path, output caps |
| `privacy.test.mjs` | runs the privacy scan over every tracked file |

The fixtures were captured from a working machine and then redacted. The sites in them are
stand-ins (`beacon.lab`, `clinic.lab`, `sonata.craft` and so on), chosen to keep the TLD spread
and sort order the tests assert on. See
[Privacy of the test data](README.md#privacy-of-the-test-data). New fixtures use stand-in
names and `/home/dev` for paths.

`tools/hubdev-snapshot --include=caddy,php,sites` composes the same envelope from
`hubdev mcp`, the Caddy admin API and `docker ps`. Use it to compare a contract question
against something other than the Go implementation.

## Verifying UI changes

- Restart the shell, open the panel, and look at it in both views (`Alt+V`). A test passing does
  not mean the QML loaded.
- To be sure a file is live, append garbage to it and restart. If the panel still renders, the
  shell never loaded that file.
- Screenshot the focused monitor with `grim -o <output>`.
- **Screenshots for docs show demo data only**, never a real machine's site list. To get demo
  data, temporarily point `SourceJson.request()` at a command that prints a fixture, for
  example `["/usr/bin/cat", "<absolute path>/test/fixtures/healthy.json"]`. Do not press action
  buttons while it is in place, and never commit it.

## Before you open a PR

- [ ] `npm run check` passes.
- [ ] You ran `omarchy restart shell` and looked at the panel.
- [ ] Any new process is in the `Actions.js` allowlist. Nothing spawns outside it.
- [ ] Every new `Text` sets `textFormat: Text.PlainText` (`hardening.test.mjs` enforces this).
- [ ] Fixtures and screenshots use stand-in names only.
- [ ] No symlink, no home path, no real project name in the diff.

## Conventions

- `main` is the default branch. Open a PR from a branch in your fork.
- The repository is the plugin and nothing else, because `omarchy plugin add` copies it verbatim
  onto every user's machine. Plans, changelogs and research go to
  [hubdev-omarchy-buddy-docs](https://github.com/hubdev-io/hubdev-omarchy-buddy-docs).
- The marketplace scanner reads the whole tree as text. Prose that names system-level tools
  fires capability labels, so describe what the code does, not which tools it avoids.
- New Nerd Font glyphs go in as `\u{…}` escapes, as in `Theme.icon()`. A literal
  private-use character is invisible in most editors and easy to lose in a paste.
- Write control characters in tests as escapes (`"\x00"`), never as the raw byte. A raw NUL
  makes `grep` treat the file as binary, and the marketplace scanner stops on one in any file
  it reads.
