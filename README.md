# HubDev Buddy

> The state of your [HubDev](https://hubdev.io) environment at a glance in the Omarchy
> Quattro bar. Sites, services, PHP versions, Caddy and Docker — without raising the GUI.

**Status: Phases 0–4 complete. The widget runs in the bar, the contract it reads exists, a
site row hands you the project, and services, Caddy and the PHP pools start and stop from the
panel — filtered as you type and driven from the keyboard. Phase 5 is publication.**

Omarchy **Quattro 4.0.2-1** (Quickshell 0.3.1). `io.hubdev.buddy` is installed and rendering:
a mark that stays quiet when the environment is healthy, gains an **amber dot** when something
needs attention, and a **red dot** when nothing will serve. Clicking it opens a panel with
Sites, Services and Environment — and *Needs attention* only when there is something to say —
in either a dense list or three columns, toggled with `Alt+V` and remembered across restarts.
Clicking a site opens it in the desktop's browser; hovering one reveals three more, in place
of the PHP version they cover — **a terminal in the project, the project in the file manager,
the project in the editor**. Reaching a *service* row reveals what you can do about it —
**start**, or **restart** and **stop**. All of it is verified on screen, and the QML-free logic
has 255 tests over 11 fixtures — including a hardening suite that holds the properties the
marketplace review reads the tree for.

Each of those three is a HubDev verb (`site:terminal`, `folder`, `edit`), and each resolves
*your* default rather than naming a program: the terminal from `$TERMINAL`, the file manager
from `xdg-open`, the editor from `omarchy-launch-editor` — the same reasoning that makes the
browser action `omarchy-launch-browser`. They are the three that need no machinery: detached,
no output anyone reads, nothing destructive, no chance of a sudo prompt. `Actions.js` holds
the allowlist and the argv, and node tests it — including the refusals, because `hubdev`
parses its own flags out of the argv it is handed and a site named `--print` must never
become one.

**Services start and stop from the row.** A stopped service offers `start`, a running one
offers `restart` and `stop` — never all three, because the verbs its current state cannot use
are not drawn as buttons you could press. `stop` arms on the first press and sends on the
second, because it is the one that leaves something down until a person notices; `restart`
does not, because it puts the service back by itself. While one runs, its row shows a turning
spinner and every other button dims — one action at a time, enforced where the process is
spawned rather than only in the view. One line at the foot of the panel carries whatever there
is to say: the question, the progress, *"Redis restarted"*, or the reason it did not work,
taken off HubDev's stdout with its ANSI colour stripped.

Two rules keep that honest, and both are in `Actions.js` under `node --test`. Every press is
re-checked against the **current** snapshot, not the row the panel is holding — a panel open
for a minute must not be able to stop something that is already stopped. And a service this
machine never set up gets no buttons at all: starting one of those is not a start, it is a
download, which the plan puts out of scope.

**The environment itself starts and stops too** — the Caddy row and each PHP pool, on the same
machinery. What earns a row its buttons is a `target` the model stamps on it (`caddy`,
`php:8.4`), not a match on its label: DNS, the hosts file, Docker, Node and Diagnostics are
readings, and a reading promoted to its own row later must not be able to inherit a verb by
being called the right thing. Because the same field decides whether a row can be *found* by
typing, the two answers cannot drift apart.

**And Services now lists only what is set up here.** The catalogue HubDev offers is larger, and
that difference used to sit behind a "not set up" disclosure. Once rows carried buttons it
became the one place where opening something revealed rows identical to their neighbours that
refuse every verb — so the count reads `5/6` against this machine rather than `5/8` against the
catalogue. A live search still finds them, which is where a question about one actually gets
asked.

**Just start typing.** The panel already holds the keyboard when it opens, so there is no
field to click into and no shortcut to remember: the first character raises a slim box under
the header and narrows Sites, Services and the environment's own toggles to what matches, with
the matched letters marked in the accent colour. The match is a *subsequence* — `cpa` finds `clinic-portal-app.test` the way
a launcher would — but a bounded one, which is the part that matters: after the first
character, every next one must either continue a run or begin a word (`-`, `.`, `_`, `/`).
Without that bound a subsequence matcher matches half the list on coincidence; with it,
typing a site's name gets you that site. Parked sites are searched too, which is the best
moment the feature has — the collapsed row is exactly what was hiding the one you are looking
for. `Enter` opens the top match, `Esc` clears the filter and only then closes the panel.

**Or drive it with the arrows.** `↑`/`↓` walk the site rows and then the service rows,
`←`/`→` walk that row's actions, and `Enter` or `Space` presses whatever the cursor is on —
a site row opens the site, a button runs its verb, the collapsed *parked sites* count expands.
A service row has no press of its own: a domain is somewhere to go and a service is not, so
Enter on the row would have to silently pick one of three verbs. It works during a search too:
type three letters, arrow down, go. Rows below the fold scroll into view as the cursor reaches
them, and the collapsed count is a stop of its own because otherwise the parked sites would be
unreachable without the mouse.

**The mouse moves that same cursor** — that is the shell's own `CursorSurface` rule, and rows
here paint from the cursor rather than from hover, so there is exactly one highlight on screen
no matter which device put it there. The cursor is a *key* (`site:<name>`), never an index:
the snapshot refreshes underneath the panel every few seconds and a search re-ranks the list on
every keystroke, so an index would quietly come to mean a different row — the worst possible
bug for a control that runs things.

**Bind it to a key.** The panel is reachable without going to the bar at all:

```bash
omarchy-shell shell toggle io.hubdev.buddy
```

In `~/.config/hypr/bindings.lua`, alongside Omarchy's own panel keys:

```lua
o.bind("SUPER + CTRL + J", "HubDev Buddy", "omarchy-shell shell toggle io.hubdev.buddy")
```

`shell toggle` is deliberate rather than this plugin's own IPC route: it resolves the widget
through `Bar.pickPanelSlot`, so on a multi-monitor desk the panel opens on the output Hyprland
has focused instead of on every head at once. It lands on the current workspace because the
bar is a layer surface and has no workspace of its own. The panel takes the keyboard as it
maps, so a summon runs straight into the search box — press the key, type three letters of a
project, `Enter`.

That route was dead until Phase 4d, for one reason worth writing down. `Bar.findPanelWidget`
and `Bar.panelNavigationSlots` both skip any bar slot whose item is missing `open()`, `close()`
**or `opened`** — and it is the *widget root* they inspect, not the panel. This widget called
that property `panelOpen`, which is a name, not a bug, and so nothing ever reported it. It
cost four things: `shell toggle` answered `unknown`; Buddy was left out of the
`SUPER+CTRL+<n>` panel numbering, which does not leave a gap but renumbers every panel to its
right; `Tab`, wired to `bar.switchPanelFrom` since Phase 3, could never find its own slot; and
the popout hand-off had no `popoutSwitchClosing` to read. Renaming it fixed all four.

**`hubdev snapshot --json` is implemented** in HubDev's own CLI, and the widget's
`SourceJson.parse()` → `Model.summarize()` reduces its live output to `level: ok`,
`Sites 14/15 · Services 5/6 · PHP 8.4 (default) · Caddy 2.11.4`. The two halves were built in
parallel against committed fixtures written from `hubdev mcp` output *before* the Go code
existed — and those fixtures **passed unchanged** against the real implementation.

The verb ships in **HubDev v1.29.0**. Against an older HubDev the widget still, correctly,
reports *"This HubDev is too old — `snapshot --json` is not available"* — and in that one state
the footer's **Refresh**, which could only re-fail, becomes **Update HubDev**. It opens the
upgrade in a terminal rather than running it detached: on Arch `hubdev update` is a full
unattended `-Syu` of the whole system, and that must happen somewhere you can watch it.

**The panel needed no new CLI.** Every section is built from the Phase 1 contract as shipped —
including Node's version, which arrives as a health check rather than a field of its own. The
one thing [lerd Glance](https://github.com/lerd-env/lerd-omarchy-glance) has that HubDev
cannot supply is its CPU/memory meter strip: there is no CPU figure at all, and the memory
figure costs a Docker stats sample per service, which is not a price a 30-second poll should
pay. §5.2 replaces it with the Environment column.

## Installing it

You do not need to wait for the plugin marketplace listing — Omarchy installs a plugin from
any git URL, and this repository is one.

**What you need first**

| | |
|---|---|
| Omarchy | **Quattro 4.0.x** or newer (`omarchy version`). The plugin is a Quickshell `bar-widget`; the pre-Quattro Waybar setup cannot host it. |
| HubDev | **v1.29.0** or newer, installed at `/usr/bin/hubdev` (`hubdev --version`). That is the release where `hubdev snapshot --json` — the one thing the widget reads — shipped. |

Nothing else. No API key, no account, no daemon, no build step, no `sudo` at install time.

**Install**

```bash
omarchy plugin add https://github.com/hubdev-io/hubdev-omarchy-buddy.git --enable
```

`--enable` places the mark in the bar's right section straight away. Leave it off if you would
rather choose the placement yourself:

```bash
omarchy plugin add https://github.com/hubdev-io/hubdev-omarchy-buddy.git
omarchy plugin enable io.hubdev.buddy right     # or: left, center
```

Then restart the shell once, because a newly registered widget is not hot-loaded into a
running bar:

```bash
omarchy restart shell
```

The mark appears in the bar. Click it, or bind a key to the panel:

```lua
-- ~/.config/hypr/bindings.lua
o.bind("SUPER CTRL", "H", "omarchy-shell io.hubdev.buddy toggle")
```

**Updating**

```bash
omarchy plugin update io.hubdev.buddy
omarchy restart shell
```

`omarchy plugin add` clones this repository into `~/.config/omarchy/plugins/io.hubdev.buddy`
and `update` fast-forwards that clone, so you are always running the commit you can read on
GitHub. Nothing in the plugin ever updates itself, downloads a binary, or builds anything.

**Two settings**, both in the shell's own widget settings (the bar's context menu, or
`~/.config/omarchy/shell.json`): how often to poll while the panel is closed, and whether the
panel opens as a dense list or three columns.

## What it runs, what it touches

The whole of it, so that nothing here needs to be taken on trust:

- **It runs exactly one program: `/usr/bin/hubdev`.** By absolute path, never resolved through
  `PATH`, and always as an argv array — never a shell command string. Reads are
  `hubdev snapshot --json --include=…`. Actions are `hubdev service:start|stop|restart <name>`,
  `hubdev caddy:start|stop`, `hubdev php:start|stop <version>`, and the four detached row
  verbs (`site:terminal`, `folder`, `edit`, and a URL through `omarchy-launch-browser`).
  `Actions.js` holds all of it as a literal allowlist, and the tests read that table.
- **Every child process is bounded and has a deadline.** A read gets 5s (cheap tier) or 15s;
  each verb has its own ceiling. Output is read in chunks against a byte budget — 1 MiB for a
  snapshot, 64 KiB for an action — and a child that exceeds it, or misses its deadline, is
  sent `SIGTERM` and then `SIGKILL` two seconds later. Nothing is left running when the
  widget is destroyed.
- **It never asks for a password, and never elevates anything itself.** The service, Caddy and
  PHP verbs change system state, but the elevation is HubDev's own — its installer adds a
  NOPASSWD `sudoers` rule for exactly those commands. This plugin adds no rule, ships no
  helper, and installs nothing into a privileged path. `hubdev site:fix` is deliberately *not*
  offered, because it is the one verb that rule does not cover.
- **It makes no network requests of its own.** No endpoint, no telemetry, no analytics. The
  only thing that reaches the network is HubDev, doing what you asked it to.
- **It writes nothing outside the shell's own settings.** No state file, no cache, no lock
  file, no temporary file, no edit to `hyprland.lua` or to any other component's
  configuration. The two settings above live in `~/.config/omarchy/shell.json`, written by the
  shell's own API, and nothing else on disk changes.
- **Nothing sensitive ever reaches a command line.** Site *labels* are passed to `hubdev`, not
  paths, and a label that could be read as a flag is refused rather than escaped. Filesystem
  paths, the HubDev license key and the plaintext passwords in HubDev's `services.yml` are
  never read, never rendered and never serialised.
- **Every string this plugin draws is plain text.** `textFormat: Text.PlainText` on every
  `Text` in the tree, so a site or container name can never be interpreted as markup and make
  the shell fetch a resource. The one sink the plugin does not own — the bar tooltip, which
  the shell draws itself — has the markup characters stripped out of the string instead.
- **Loading it does nothing.** Enabling the plugin starts a poll and draws a mark. Every
  action is a button someone pressed, `stop` takes two presses, and the panel refuses a verb
  the *current* snapshot says would not apply.

## Removing it

```bash
omarchy plugin remove io.hubdev.buddy
omarchy restart shell
```

That deletes `~/.config/omarchy/plugins/io.hubdev.buddy` and takes the mark out of the bar.

**What survives removal:** the widget's two settings stay behind in
`~/.config/omarchy/shell.json` until the shell prunes them, which is true of every plugin and
is the shell's own bookkeeping rather than anything this plugin wrote. Nothing else — there is
no state directory, no cache, no credential, no systemd unit, no hook, no `sudoers` entry and
no package installed by this plugin, so there is nothing else to clean up.

**What removal does not touch, on purpose:** HubDev itself, and anything it is running. If you
started Redis from the panel, Redis is still running afterwards — removing the window you
looked through is not a reason to stop the thing you were looking at. Uninstall HubDev
separately if that is what you meant (`hubdev` is packaged as `hubdev-bin`).

## What is here

| Path | |
|---|---|
This repository is the plugin and nothing else: the QML, the three `.js` modules the logic
lives in, the tests, the README and the licence. `omarchy plugin add` copies a repository
verbatim into `~/.config/omarchy/plugins/`, so anything here is installed on your machine —
which is a good reason for there to be very little of it.

**The development record lives in its own repository:**
[hubdev-omarchy-buddy-docs](https://github.com/hubdev-io/hubdev-omarchy-buddy-docs) — the implementation plan (architecture, scope, phases, risks,
and the adversarial review that reshaped it), the daily changelogs, and the research. Start
there if you are reading for *why*; start here if you are reading for *what runs*.

## The idea

A `bar-widget` plugin (`io.hubdev.buddy`) that stays quiet when the environment is healthy
and is obvious from across the screen when it is not: a monochrome mark that gains a
coloured dot only when Caddy is down, a PHP-FPM pool has stopped, a service set to
auto-start is not running, or a certificate is about to expire. Clicking it opens a panel
with sites, services, PHP versions and environment health, and the verbs that belong on each
row.

It deliberately refuses to be a console. Anything long, interactive or destructive —
`site:new`, `backup:restore`, `artisan`, `composer`, log tailing — stays in the HubDev GUI
or a terminal, with explicit hand-offs to both.

[`lerd Glance`](https://github.com/lerd-env/lerd-omarchy-glance) is the reference
implementation, and a good one. What carries over is architectural: a single I/O owner, all
logic in QML-free JavaScript so `node --test` runs the exact files the shell loads, quiet by
default, and failures that land on the row that caused them.

## The two decisions worth knowing up front

**Transport.** HubDev has no local HTTP API and no machine-readable CLI — unlike lerd, which
the plugin model assumes. But `mcp.Bridge` in `devhub-go` already exposes every read the
widget needs as JSON-tagged structs, so the plan adds `hubdev snapshot --json` to the CLI and
spawns it from QML, rather than building a daemon. See §4 of the plan for the four
alternatives and why they lost.

**The unknown that was open — now closed.** The Omarchy plugin docs list `QtQuick`,
`Quickshell`, `qs.Ui` and `qs.Commons` — not `Quickshell.Io`, where `Process` lives, and
whether a plugin may spawn a subprocess decided between a full plugin and a read-only one.
**The Phase 0 spike settled it by doing it:** a third-party plugin importing `Quickshell.Io`,
spawning `hubdev`, and putting the number in the bar. Two other Phase 0 findings changed the
plan: `hubdev service:list` costs **568 ms** with containers running (6.5× the idle figure),
which moved it out of the cheap polling tier; and `site:fix` was cut from the action allowlist
because it can raise a polkit dialog that blocks the shell's `Process`. Plan §7.1–§7.3.

## Layout

```
manifest.json                     io.hubdev.buddy, schemaVersion 1
BarWidget.qml                     the only file that does I/O
Mark.qml                          the glyph and its state dot
SourceJson.js                     the transport seam (the import line is the seam)
Model.js  Theme.js                pure JS, QML-free, tested under node
Panel.qml                         the popout: header, search, view, hand-offs
KeyCatcher.qml                    the panel's keys — why it is not qs.Ui's is at its top
SearchField.qml                   the box that appears with the first keystroke
DenseView.qml  ColumnsView.qml    two arrangements of the same sections
*Section.qml                      Sites · Services · Environment · Attention · Extras
Section.qml  InfoRow.qml  SiteRow.qml  ServiceRow.qml  StatusDot.qml  CollapseRow.qml
Actions.js                        the argv allowlist, and the keyboard's map of what it can reach
test/                             node --test, harness + 11 fixtures
LICENSE                           MIT
tools/hubdev-snapshot             dev-only reference implementation of the contract,
                                  written before the Go one and kept as its acceptance target
                                  ── still to come ──
(Phase 5 only: preview.png, CI running validate + qmllint + node --test,
 and the marketplace submission)
```

`test/hardening.test.mjs` is the odd one out: it asserts properties of the *tree* rather than
of a function — every `Text` names its `textFormat`, no `StdioCollector` exists anywhere,
`hubdev` is only ever invoked by absolute path — because each of those is something a later
edit could undo without any test noticing.

`test/harness.mjs` loads the real `.js` files into node, stripping only QML's `.pragma`
directive, so the tests run exactly what the shell loads and there is no second copy to drift.

## Reading the plan

The plan itself is in the
[docs repository](https://github.com/hubdev-io/hubdev-omarchy-buddy-docs/blob/main/docs/implementation-plan.md).
Start at §3.1 (what the HubDev source confirms) and §4 (the architecture decision), then
**§7 Phase 0** for what running the spike actually established. **§7.6** is the most useful
section if you are reading for lessons rather than scope: four things the plan got wrong that
only became visible once the code existed — including a cache that cannot work in a
process-per-call CLI, and a telemetry event that a 30-second poll would have fired a few
thousand times a day. §11 is an adversarial review of the plan by itself: thirteen challenges,
seven of which changed it.

## Privacy of the test data

The fixtures were captured from a working machine, so the sites in them are
**stand-ins** — `beacon.lab`, `clinic.lab`, `sonata.craft` and so on — chosen to
preserve the distribution the tests rest on (the TLD spread and the sort order
both carry assertions) without naming anything real.

`npm run privacy` scans every tracked file for real home paths, client project
names and secret-shaped values, and `npm test` runs the same scan. The denylist
is **hashed**, not plaintext: a scanner carrying a list of client names would be
the leak it exists to prevent. To have git refuse the commit instead of CI
refusing the push, enable the hook once per clone:

```
git config core.hooksPath .githooks
```

## License

MIT — see [`LICENSE`](LICENSE).
