# HubDev Buddy — Omarchy Quattro plugin

**Implementation plan** · 2026-08-31 · **revised 2026-08-31, post-upgrade** ·
**Phase 0 complete 2026-08-31**
Status: **Phase 0 done, Phase 2 is next.** Omarchy Quattro is running here, and the readiness
spike has been *run*, not reasoned about: a third-party plugin at
`~/.config/omarchy/plugins/io.hubdev.spike/` drives `Quickshell.Io.Process` against the
`hubdev` CLI and renders the live site count in the bar. R1 is closed, R2 is re-measured under
load (and forced a tiering revision, §7.2), and R3 turned out to be a *different* risk than
the one written down (§7.1). Nothing is waiting on the platform.

Reference implementation: `lerd Glance` (`~/Projects/Research/lerd-omarchy-glance`)
HubDev CLI source: `~/Projects/HubDev/devhub-go` (Go 1.25, Wails + Svelte GUI)
Plugin spec: <https://plugins.omarchy.org/develop.html>
Platform verified on this machine, 2026-08-31: Omarchy **4.0.2-1** · Quickshell **0.3.1** ·
HubDev **v1.28.0** · manifest `schemaVersion 1` (enforced by `/usr/bin/omarchy-plugin-validate`).

---

## 1. Goal

Put the state of the local HubDev environment in the Omarchy Quattro bar: sites, services,
PHP versions, Caddy, Docker — visible without raising the HubDev GUI, actionable without
opening a terminal. Quiet when healthy, obvious when broken.

**Proposed identity**

| | |
|---|---|
| Plugin ID | `io.hubdev.buddy` (reverse-DNS of `hubdev.io`; `omarchy.*` is reserved) |
| Display name | HubDev Buddy |
| Kinds | `bar-widget` (a `Panel.qml` is loaded by the widget, not registered as a separate kind) |
| Entry point | `entryPoints.barWidget` — the validator requires it for kind `bar-widget`. (`omarchy.agents` points this key at `Panel.qml`; this plan points it at `BarWidget.qml`. The key is fixed, the filename is ours.) |
| Placement | `barWidget.defaultSection: "right"` — validator accepts `left`/`center`/`right` |
| Settings | `barWidget.defaults` + `barWidget.schema` in the manifest: typed keys (`integer`/`enum`/`string`/`path`) the shell renders and persists. This is where the view toggle and refresh interval live — see §5.2. |
| Repo | `hubdev-omarchy-buddy` (this directory) |
| License | MIT |

---

## 2. What lerd Glance actually is

Worth decomposing precisely, because the parts worth copying are architectural, not visual.

```
BarWidget.qml   the only file that does I/O. Owns polling, the HTTP calls,
                and `actionState` (per-request: "busy" | error string | absent).
Panel.qml       chrome: header, view toggle, loads one of the two views.
DenseView.qml   400px htop-style table.       ColumnsView.qml  720px three columns.
Model.js        pure JS. Raw API payloads -> the summary the UI binds to.
Actions.js      pure JS. A row -> the request it turns into. Plus verdict parsing.
Theme.js        state palette + Nerd Font glyph table.
Meter/StatRow/StatusDot/SectionTitle/WorkerGlyph/Flag/ActionIcon/ActionRow/Mark  leaf components.
test/*.mjs      `node --test` over Model.js and Actions.js — no shell needed.
```

**The five ideas to carry over verbatim:**

1. **One I/O owner.** Only `BarWidget.qml` talks to the outside. Views call `run(request)`
   and bind to the state that comes back. This is what makes the rest testable.
2. **Pure-JS logic, QML-free.** `Model.js` and `Actions.js` import nothing from QML, so
   `node --test` runs the exact files the shell loads. Every rule worth getting right
   (addressing, health thresholds, refusal parsing) lives there.
3. **Quiet by default.** Monochrome mark that takes the bar foreground; a coloured dot only
   when something is wrong. Empty sections are not drawn at all.
4. **Failure lands on the row that caused it.** `actionState` is keyed by request, so a
   refusal turns *that* row's icon red with the message as its tooltip, and self-clears
   after 6s. Errors are worth reading, not worth keeping.
5. **Refresh burst after a mutation.** Some verbs return before the thing is actually up,
   so a single refresh repaints the state you just left. Poll immediately, then twice more
   at 1.5s.

**What must *not* be copied:** the lerd data model. lerd is Podman-centric — every site and
service is a container, so "total CPU and memory across every lerd container" is a
meaningful headline number. HubDev is a **hybrid**: Caddy and PHP-FPM are native processes,
services are per-service `docker` *or* `native`, and sites are `traditional` or `docker`.
A container-resources meter would describe a minority of what HubDev runs. See §5.

---

## 3. The gap: HubDev is not lerd

Verified on this machine against HubDev **v1.28.0**, re-checked 2026-08-31 after the Quattro
upgrade: `site:list --json` still prints the ANSI table and there is still no `snapshot`
command. The gap below is current, not historical.

| | lerd | HubDev |
|---|---|---|
| Local API | HTTP on `127.0.0.1:7073`, `/api/*`, CSRF header | **none** — no listening socket, no daemon |
| Machine-readable CLI | n/a | **none** — `--json` is silently ignored, ANSI is emitted even under `NO_COLOR` |
| Structured data exists? | yes, the dashboard's own API | **yes, but only behind `hubdev mcp`** (stdio JSON-RPC) |
| State on disk | — | `~/.local/share/devhub/config/{sites,services}.yml`, `app.json`, `license.json`, `caddy-config.json` |
| Other local endpoints | — | Caddy admin API on `:2019` (routes, PKI) |
| Runtime model | containers only | hybrid: native Caddy + multi-version PHP-FPM + docker/native services |
| Privilege | user | some paths use a sudoers rule (`sudoers-installed`); `sudo -n` currently fails |
| Source access | third-party | **full** — the whole `hubdev` organization, CLI source included, cloned at `~/Projects/HubDev/devhub-go` |

### 3.1 What the source confirms

Read directly from `devhub-go` on 2026-08-31. Several of this plan's open unknowns are now closed:

- **`mcp.Bridge` is the seam that already exists.** `internal/mcp/server.go` defines a
  deliberately slim interface over the main `App` — its own comment says the methods are
  "intentionally named like the bindings the GUI uses". It already carries **everything the
  read side of the contract needs**: `SiteList() []sites.Site`, `SvcList() []provider.ServiceStatus`,
  `PhpListVersions()`, `PhpGetDefault()`, `RunDiagnostics() []platform.DiagnoseCheck`,
  `NgrokListTunnels()`, `GetVersion()`. Every one returns a JSON-tagged struct.
  **`hubdev snapshot --json` is one new `cli_snapshot.go` that wires the same `app` value
  `cli_mcp.go` already builds, then marshals one envelope.** No new data plumbing.
- **`RunDiagnostics()` hands over the health block for free.** `DiagnoseCheck` is already
  `{Name, Status: "ok"|"warning"|"error", Message, Detail, Icon}` — exactly §6's `env.flags`,
  so the bar's dot rules can be derived from it rather than reinvented.
- **There is no HTTP server in HubDev.** The only `ListenAndServe` in the tree is the DNS
  stub (`internal/dnsstub`). Approach B is genuinely greenfield, which is why it stays at
  Phase 6.
- **There is no file locking anywhere in the codebase.** Concurrency is in-process
  `sync.RWMutex` on the sites and Caddy managers only. **This answers the Phase 0 concurrency
  question for reads:** a separate `hubdev` process polling has nothing to contend with. It
  also exposes a real, *pre-existing* hazard — concurrent writes from the CLI and the GUI to
  `sites.yml` are last-writer-wins — which the widget would make more likely, and which
  argues for read-only or narrow mutations in v1 (§10 Q3).

**The decisive observation:** `hubdev mcp` already returns exactly the JSON a widget wants.
`hubdev_list_services` returns `{name, display, category, status, mode, port, version,
auto_start, installed, external, has_native, has_docker}` per service. The Go core already
models and serialises all of this. **Exposing it as `--json` is a serialisation change, not
a feature.** That is the cheapest bridge, and it makes the CLI better on its own merits.

Measured cold-start latency (services stopped): `site:list` 59ms · `service:list` 87ms ·
`status` 374ms. Fast enough to poll — but `status` probes Docker, so this number will grow
once containers are running. See risk R2.

---

## 4. Architecture decision — how the plugin gets data

| | Approach | Verdict |
|---|---|---|
| **A** | `hubdev <cmd> --json`, spawned from QML `Process` | ✅ **Recommended baseline** |
| **B** | New `hubdev api` loopback HTTP daemon (lerd's exact shape) | ⏭ Phase 6, if polling proves insufficient |
| **C** | Speak JSON-RPC to a long-lived `hubdev mcp` child | ❌ Reject |
| **D** | Parse the ANSI table output | ⚠️ Spike only, never shipped |
| **E** | Read `~/.local/share/devhub/config/*` + Caddy `:2019` + `docker ps` directly | ⚠️ Fallback adapter only |

**Why A.** No new long-lived process, no port to bind, no auth/CSRF design, no daemon
lifecycle to get wrong. The Omarchy docs are explicit that plugins run unsandboxed inside
the long-running shell process and must "never start a second Quickshell process" — a
short-lived `hubdev` subprocess is the lightest thing that respects that. The JSON already
exists internally, so the CLI change is small and independently valuable (CI, scripts,
other tooling all benefit).

**Why not B yet.** A daemon is the right end state if push-based updates become necessary,
but it is a much larger commitment (port allocation, cross-origin gate, restart semantics,
"is it running?" UX) for a v1 whose refresh budget is 30s idle / 5s open.

**Why not C.** MCP is an agent protocol with session semantics and a master on/off switch
(`hubdev mcp:disable`). A bar widget holding an MCP session hostage is wrong, and it breaks
the moment the user disables MCP.

**If `Process` is unavailable to plugins** (see R1), the fallback is *not* straight to a
daemon. XHR is proven available inside an Omarchy plugin — lerd uses it — and QML's
`XMLHttpRequest` reads `file://` URLs. So the escalation ladder is:

```
A  Process   -> hubdev snapshot --json                          (preferred)
A' XHR file:// -> ~/.cache/hubdev/snapshot.json, refreshed by a
                  systemd --user timer running the same command  (no Process needed)
B  XHR http:// -> hubdev api on loopback                         (last resort, biggest change)
```

A' costs one `.timer`/`.service` pair shipped with the plugin and keeps every other file
identical. It loses on-demand refresh (the file is only as fresh as the timer) and cannot
run mutations — so under A' the plugin is **read-only**, which is an acceptable v1.

**Update (post-upgrade): rung A is available, and rung A' has a first-party precedent.**
Omarchy's own `omarchy.agents` — a `bar-widget`, the same kind Buddy claims — imports
`Quickshell.Io` in both its entry point and its worker, and drives `Process` with
`stdout: StdioCollector { waitForEnd: true; onStreamFinished: ... }`. That is precisely the
shape `hubdev snapshot --json` needs, already shipping in the bar. The same plugin is also a
worked example of A': an external updater (`omarchy-agent-usage-update`) writes JSON records
under `~/.local/state/omarchy/agents/usage/` and the QML only discovers and watches them with
`FileView`. Both rungs are demonstrated in-tree rather than assumed. See R1.

**Why D/E exist anyway.** The plugin must be able to run before the CLI ships `--json`.
Both live behind a **source adapter seam**: `Source.js` exposes one function,
`snapshot(cb)`, returning the canonical shape from §6. Swapping `SourceJson` ↔ `SourceFiles`
↔ (later) `SourceHttp` changes one line in `BarWidget.qml` and nothing in `Model.js`.

### 4.1 The CLI contract to add to HubDev

One aggregate call, not seven. lerd fans out to 7 endpoints because HTTP round-trips are
cheap; process spawns are not.

```
hubdev snapshot --json [--include=sites,services,php,caddy,docker,health,tunnels,backups]
```

```jsonc
{
  "schema": 1,                      // bumped on breaking change; the plugin refuses newer majors
  "hubdev": { "version": "1.28.0", "update_available": null },                            // update_available: PROPOSED
  "generated_at": "2026-08-31T22:49:15Z",
  "caddy":    { "running": true, "version": "2.11.4", "mode": "native", "routes": 15 },   // known (caddy:status)
  "php":      [ { "version": "8.4", "default": true, "fpm_running": true, "xdebug": false } ],
  "docker":   { "available": true, "containers": { "running": 0, "exited": 5 }, "reclaimable_bytes": 0 },
  "services": [ /* exactly the hubdev_list_services shape, minus `password` */ ],         // known
  "sites":    [ { "name", "domain", "path", "driver", "php_version", "mode", "active",   // known
                  "tls": true, "route_present": true } ],                                  // PROPOSED
  "health":   { "checks": [ { "id": "dns_test", "level": "ok|warn|error", "label", "detail" } ] },
  "tunnels":  [ { "site", "url", "running" } ],
  "backups":  { "count": 12, "bytes": 0, "last_at": "..." },
  "license":  { "plan": "free", "status": "active" }   // never the key
}
```

Fields are marked **known** (HubDev already computes and exposes them via `mcp`/`doctor`/
`caddy:status`) or **PROPOSED** (new work in the Go core). Only the proposed ones carry
schedule risk; a v1 that drops all of them still works.

Design rules for the contract:

- **Tiering.** Two tiers, and the *expensive* one never runs at 5s:
  **cheap** (`caddy,php,services,sites` — config reads and process checks) every 30s closed,
  every 5s open; **expensive** (`docker,health,backups`) every 30s regardless, and once on
  panel open. Docker inspection is the expensive part and is opt-in by `--include`.
- **Server-side TTL cache** (~2s) inside `hubdev` so a burst of calls does not hammer Docker.
- **Never serialise secrets.** `services.yml` holds plaintext passwords and `license.json`
  holds the key; both are stripped from `snapshot` output. Non-negotiable.
- **Mutations answer JSON too.** `hubdev service:start redis --json` → `{"ok":true}` or
  `{"ok":false,"error":"..."}`, and exit code mirrors it. Long operations (image pulls) emit
  **NDJSON progress lines**, last line wins — the same verdict rule lerd uses.
- **Additive only** within a schema version. New keys are fine; renames bump `schema`.

Ship it as a documented, versioned surface, with golden fixtures exported from a live
machine and committed to this repo as test input.

---

## 5. Product scope

### 5.1 In the bar

The HubDev mark, monochrome, taking the bar foreground so it reads correctly in every
Omarchy theme. A coloured dot **only** when something is wrong:

| Colour | Condition |
|---|---|
| 🔴 red | Caddy stopped · default PHP FPM stopped · HubDev not installed/answering |
| 🟡 yellow | a service with `auto_start: true` is stopped · an active site has no Caddy route · a certificate expires within 14 days · Docker unavailable while docker-mode services are enabled · license not `active` |
| *(none)* | healthy |

Tooltip: `Sites 14/15 · Services 3/8`, `PHP 8.4 (default) · Caddy 2.11.4`, then the plain-language
issue list, or nothing more if there is nothing wrong.

### 5.2 In the panel

Two views behind one toggle, persisted through the manifest's `barWidget.defaults` /
`barWidget.schema` block (§1) rather than a file of our own — dense table (~420px) and
columns (~760px), following lerd's proportions. Empty sections are not drawn.

1. **Environment** — Caddy (state, version, route count) · every installed PHP with the
   default in bold and its FPM state · Docker daemon · hosts-file entry count ·
   `.test`/`.lab`/`.craft` resolution · SSL expiry · HubDev version and update availability.
   *This replaces lerd's "Resources" column* — see §2. Container CPU/memory is shown only
   as a small strip when docker-mode services are actually running.
2. **Sites** — name, domain, PHP version, `traditional`/`docker` badge, driver glyph
   (laravel · wordpress · static), active state. 15 sites today, so: scrollable, with
   inactive sites collapsed behind a count by default.
3. **Services** — display name, status dot, `docker`/`native` badge, port, version.
   *(Sizing: this machine has 15 sites, 8 services and 2 PHP versions — roughly 3× what
   lerd Glance assumes. The panel caps at 70% of screen height; sections scroll
   independently; inactive sites and `installed: false` services collapse behind a count.
   Verify against the 15-site fixture before the columns view is called done.)*
4. **Needs attention** — what is actually wrong, in plain words. Nothing when nothing is.
5. **Tunnels / Backups** — one line each, drawn only when non-empty.

### 5.3 Actions

On the row they belong to, revealed on hover, in place of the detail they cover — lerd's
rule, and it is the right one.

| Row | Verbs | CLI |
|---|---|---|
| Site | open · start · stop · folder · terminal | `site:open` `site:start` `site:stop` |
| Service | start · stop · restart | `service:start\|stop\|restart` |
| PHP row | start/stop FPM | `php:start\|stop <ver>` |
| Caddy row | start · stop | `caddy:start\|stop` |
| Header | Open HubDev GUI · Refresh | `hubdev` (no args) |

**Explicitly out of scope for v1**, and the reason:

- `site:new` / `site:clone` / `site:link` / `site:unlink` — interactive, long, destructive.
- `backup:run` / `backup:restore` / `service:reset` — destructive or minutes-long.
- `site:artisan` / `site:composer` / `run` — need output and a cwd; that is a terminal.
- `php:install` / `node:install` / `marketplace:*` / `security:scan` — long downloads.
- `site:logs` / `service:logs` — logs leak tokens into a bar panel. Open a terminal instead.
- Anything under `mcp:*`.
- **`site:fix`** — cut after Phase 0. It calls `chmod` outside HubDev's sudoers rule, so it
  can raise a polkit dialog that blocks the `Process`, and only *conditionally* (when the FPM
  socket mode is already wrong), which is the worst kind of escalation to allowlist. §7.1.

The escape hatches are **Open HubDev GUI** and **Open terminal at site** (`site:open-terminal`),
which is honest about where that work belongs.

### 5.3.1 Theming

State colour is hard-coded (emerald / yellow / red / sky / grey, HubDev's own palette) so a
failure looks like a failure in every Omarchy theme. Everything else — chrome, text,
separators, the mark itself — inherits `qs.Ui.Style` and the bar foreground. Colour is used
*only* to carry state, never for decoration. This machine's theme (`#060B1E` on `#F99957`)
is a good adversarial test: an amber foreground sits close to the warning colour, so the
warning state must also be distinguishable by glyph, not by colour alone.

### 5.4 Safety model

- Every action is a **fixed argv array**, never a shell string. `Actions.js` builds
  `{ argv: ["hubdev","service:start","redis","--json"], key, label, icon }`.
- The subject is **validated against the current snapshot** before use — a site name that is
  not in `snapshot.sites` produces no request at all.
- **Confirm-gate**, inline and two-step, anything that stops something someone may be using
  (`caddy:stop`, `php:stop` on the default version, `site:stop` — which removes the Caddy
  route): the icon becomes a labelled "Sure?" for 4s and only the second click sends. No
  modal dialog; the panel closes on Escape and a modal would fight that.
- **No sudo, ever.** A verb that could prompt for a password would hang a QML `Process`
  invisibly inside the long-running shell. Phase 0 must establish which verbs can escalate;
  any that can are excluded from the allowlist regardless of how useful they are.

---

## 6. The summary shape

`Model.js` reduces the snapshot to what the UI binds to. Fixed shape, always present, so
views never branch on `undefined`:

```js
{
  reachable, version, updateAvailable,
  level: "ok" | "warn" | "down",
  sites:    { total, active, rows: [ {name, domain, php, mode, driver, active, tls, url} ] },
  services: { total, up, rows: [ {name, display, up, broken, mode, port, version, autoStart} ] },
  php:      { default: "8.4", rows: [ {version, isDefault, fpmRunning, xdebug} ] },
  caddy:    { running, version, routes },
  docker:   { available, running, exited, reclaimableLabel },
  env:      { flags: [ {label, ok, detail} ] },
  issues:   [ "Caddy is stopped", "redis is set to auto-start but is stopped" ],
  resources: { shown: false, /* cpu, memLabel, top[] when docker-mode services run */ }
}
```

`Model.unreachable()` returns the same shape with `reachable: false` and one issue —
"HubDev is not running", or "HubDev <version> is too old; snapshot needs <target>" — where
the target is the release picked in §10 Q1. (v1.28.0 is current and does *not* carry the
contract, so this message cannot be pinned to a number until Phase 1 lands.)

---

## 7. Phases

Each phase is independently reviewable and leaves the repo in a working state.
**Phases 1 and 2 run in parallel, not in sequence.** The fixtures *are* the contract: they
are hand-written first from the `hubdev mcp` output that already exists, committed here, and
both sides converge on them. The plugin can be feature-complete and fully tested before
`hubdev snapshot --json` exists — which is what makes R4 survivable.

Rough sizing, in focused sessions rather than calendar time: **P0** ~~1~~ **done** · **P1** 1–2 (HubDev
repo — revised down, see §3.1) · **P2** 2 · **P3** 3–4 · **P4** 2–3 · **P5** 1.

### Phase 0 — Readiness spike ✅ *(complete — 2026-08-31)*

**Run on this machine, not reasoned about.** The spike shipped as a real third-party plugin at
`~/.config/omarchy/plugins/io.hubdev.spike/` (`manifest.json` + `BarWidget.qml`, ~70 lines),
`omarchy plugin enable io.hubdev.spike right`, and **`15` — the live site count from
`hubdev site:list` — rendered in the Quattro bar.** Both exit criteria met.

- [x] ~~`omarchy plugin clone omarchy.clock --edit` works; scaffold understood.~~ **Done.**
      The scaffold that matters is `shell/plugins/bar/widgets/SystemUpdate.qml` — 60 lines,
      and the exact shape Buddy needs: `BarWidget` base from `qs.Ui`, `Process` +
      `Timer(triggeredOnStart)`, `BarIconButton` with `tooltipText`, `IpcHandler` for
      `refresh`/`clear`. Copy that, not the 32 KB `agents/Panel.qml`.
- [x] ~~**Can a plugin import `Quickshell.Io` and use `Process`?**~~ **Confirmed live, twice.**
      The spike does it. And a *third-party* plugin already shipping on this machine —
      `bobbynicholas.omaland` — imports `Quickshell.Io`, `Quickshell.Wayland`, `qs.Ui` and
      `qs.Commons` today. The import question is settled where it actually matters.
      **Approach A stands. R1 is closed, not merely argued.**
- [x] **`qmllint -I /usr/share/omarchy/shell` runs clean** on the spike — exit 0, no output.
      `omarchy plugin validate` exit 0. Both belong in CI (Phase 5) exactly as written.
- [x] **Which `hubdev` verbs can trigger a password prompt.** **Answered — and the threat
      model was wrong.** See §7.1 below; it changes the Phase 4 allowlist.
- [x] ~~Does `hubdev status` take a lock on the config directory?~~ **No** (from source).
- [x] **Latency with services running.** Measured with 5 containers up. See §7.2 — it
      invalidates the plan's own tiering.
- [x] **Hot reload works.** Saving QML inside the plugin folder logs
      `Local plugin changed, reloading: io.hubdev.spike` and re-renders with no restart and
      no `rescanPlugins`. The §8 dev loop is correct as written.

#### 7.1 The sudo answer — the risk is `pkexec`, not a terminal prompt

`/etc/sudoers.d/devhub` **is installed** on this machine (marker
`~/.local/share/devhub/config/sudoers-installed` = `1`, matching `sudoersRuleVersion`).
`sudo -k; sudo -n -l` returns exit 0 and lists the rule, so this is not a cached timestamp.

`platform.RunPrivileged()` (`internal/platform/privilege_linux.go`) is the only escalation
path, and it does exactly two things:

1. `sudo -n <args>` when the marker is present — **`-n` never prompts**; it fails fast.
2. On failure, **`pkexec <args>`** — a GUI polkit dialog, served by the `omarchy.polkit`
   plugin in this very shell.

**So R3's stated failure mode does not exist.** A QML `Process` can never hit a hidden
terminal password prompt. What it *can* hit is rung 2: a polkit dialog that is visible but
blocks the `Process` until answered or dismissed (`pkexec` exits 126 on cancel). Still
unacceptable in a bar widget, still a hard timeout, but a different — and milder — bug.

The rule grants NOPASSWD on: `systemctl start|stop|restart|enable|cat *`, `pacman -S|-Rns *`,
`apt-get`/`dnf` install/remove, `mysql *`, `setcap *`, `certutil *`, `update-alternatives *`,
`sudo -u postgres *`, `ln -sf *`, and **`bash -c *`**.

**Verdict for the Phase 4 allowlist:**

| Verb | Escalates? | Verdict |
|---|---|---|
| `service:start\|stop\|restart` (native) | `bash -c` script + `systemctl stop` — both NOPASSWD | ✅ **allow** |
| `service:*` (docker mode) | no `RunPrivileged` in the docker provider | ✅ **allow** |
| `caddy:start\|stop`, `php:start\|stop` | `systemctl` — NOPASSWD | ✅ **allow** |
| `site:fix` | `RunPrivileged("chmod","0666",sock)` — **`chmod` is not in the rule** → `pkexec` | ❌ **exclude** |
| anything touching cert trust | `RunPrivileged(binPath,"trust")` — not in the rule → `pkexec` | ❌ **exclude** |

`site:fix` is the precise case §5.4 warned about: it escalates **conditionally** (only when the
FPM socket's mode is already wrong), so it passes every manual test until the day it doesn't.
**Drop it from §5.3's Site row.** The remaining verbs there — open · start · stop · folder ·
terminal — are unaffected.

> **Aside, worth raising in `devhub-go` on its own merits.** `NOPASSWD: /usr/bin/bash -c *`
> is unrestricted passwordless root: any process running as this user can
> `sudo bash -c '<anything>'` silently. It is functionally `NOPASSWD: ALL` written long-hand,
> and it is the rule HubDev installs on every Linux machine it touches. Narrowing it does not
> block this plugin — every verb Buddy wants is already covered by the `systemctl` line — but
> it is a real finding, in your own product, surfaced by this spike.

#### 7.2 Latency under load — the plan's "cheap tier" is wrong

Re-measured with 5 docker services running (MySQL, PostgreSQL, Redis, Mailpit, SQL Server),
warm, in ms:

| Command | stopped (old) | **running (now)** | |
|---|---|---|---|
| `site:list` | 59 | **100** | config read |
| `caddy:status` | — | **115** | |
| `php:list` | — | **342** | |
| `service:list` | 87 | **568** | ⚠️ **6.5×** — probes Docker per service |
| `status` | 374 | **918** | 2.5× |
| `doctor` | — | **1071** | |

Naive fan-out is **~3.1 s**. §4.1 put `services` in the *cheap* tier at 5 s open — that is
wrong: `service:list` is the second most expensive call on the machine and it scales with
container count, not site count. **Revise the tiering:**

- **cheap** (`caddy,php,sites` ≈ 560 ms): 30 s closed / 5 s open.
- **expensive** (`services,docker,health,backups`): 30 s regardless, plus once on panel open.

This also raises the value of the §4.1 server-side TTL cache from "nice" to "load-bearing",
and it is the strongest argument yet for one aggregate `snapshot` call over seven spawns.

#### 7.3 Not our bug — remember this one

Enabling any plugin rebuilds every bar slot, which re-runs `Bar.qml`'s `injectProps()`. If the
layout contains a `"type": "command"` module (this machine has one, `tunnel`), the shell logs:

```
WARN scene: @plugins/bar/Bar.qml[1770]: TypeError: Cannot assign to read-only property "moduleName"
```

`CustomCommandModule` declares `readonly property string moduleName` (`Bar.qml:1548`, `:1784`)
while `injectProps` assigns to it. **Pre-existing Omarchy bug, harmless, unrelated to us** —
recorded here so it is not mistaken for a Buddy regression later.

#### 7.4 Still open

- [ ] Does Quickshell expose bar visibility / session idle, so polling can be suspended?
      Start from `omarchy.agents`' `activation: "on-demand"` — the manifest key is real and
      documented by example, but what the shell does with it is not yet read.

### Phase 1 — The JSON contract *(HubDev CLI, ships independently)*

- [x] ~~Clone the CLI repo~~ — done: `devhub-go`. Confirm the build/release loop and pick
      the target release for the contract.
- [ ] `cli_snapshot.go`: wire the `app` value the way `cli_mcp.go` does, call the existing
      `mcp.Bridge` reads, marshal one envelope. **This is the bulk of the read side.**
- [ ] Add to `Bridge` only what is genuinely missing: Caddy running/version/route count,
      Docker container counts and reclaimable bytes, backup totals, license plan.
- [ ] `--include` tiers and a ~2s TTL cache.
- [ ] `--json` on the mutation verbs in the allowlist; NDJSON progress for long ones.
- [ ] Secret stripping, with a test that asserts no password or license key can appear.
- [ ] `NO_COLOR` / non-TTY honoured across the CLI (a bug worth fixing regardless).
- [ ] Fixtures: `test/fixtures/*.json` exported from real machines — healthy, all-stopped,
      docker-down, no-sites, 15-sites.

**Exit criteria:** `hubdev snapshot --json | jq` on a fresh machine; fixtures committed here.
**Revised sizing:** ~1–2 sessions for the read side — it is wiring, not new logic — plus the
`Bridge` additions above.

### Phase 2 — Read-only plugin `v0.1` ✅ *(complete — 2026-08-31)*

- [x] `manifest.json`, `BarWidget.qml`, `Mark.qml`, `SourceJson.js`, `Model.js`, `Theme.js`.
      *No separate `Source.js`:* the seam is the **import line** in `BarWidget.qml`
      (`import "SourceJson.js" as Source`), which is exactly the "one-line change" §4 asks
      for. A dispatcher module in front of it would add indirection without adding a seam.
- [x] Polling: 30s closed / 5s open, coalesced via `internal.inFlight`, suspended by
      `poll.running: root.visible`, backoff to 60s. A hard `guard` Timer terminates any
      Process that overruns its tier timeout.
- [x] Dot + tooltip + `unreachable` handling — all three levels confirmed on screen.
- [x] **48** `node --test` assertions green against 10 fixtures.

**Exit criteria — met.** Verified by feeding the widget each fixture in the live shell and
reading both the log and the pixels: `caddy-down` → **red dot**, one issue,
*"Caddy is stopped — no site will resolve"*; `autostart-service-stopped` → **amber dot**,
*"Redis is set to start automatically but is stopped"*; `healthy` → **no dot at all**
(zero state-coloured pixels). Caddy itself was not stopped — the fixture drives the identical
code path deterministically, and stopping it would have taken down 15 live sites.

#### 7.5 What Phase 2 corrected

- **`tools/hubdev-snapshot`** — a reference implementation of the §4.1 contract over
  `hubdev mcp`, the Caddy admin API and `docker ps`. Not a shipping path (it is §4 approach E,
  rejected in G8); it exists so Phase 2 could be finished before Phase 1, and so the Go work
  has an executable acceptance target. Its live output reduces through the real `Model.js` to
  `level: ok`, `Sites 14/15 · Services 5/8 · PHP 8.4 (default) · Caddy 2.11.4`.
- **The version gate was broken, and only the live shell showed it.** `hubdev snapshot --json`
  on v1.28.0 prints `Unknown command: snapshot` plus its entire usage screen **to stdout** and
  **exits 1**. `parse()` only reached its "too old" branch on exit 0 with non-JSON output, so
  the real case fell through to *"HubDev exited with code 1"* — true, and useless in a tooltip.
  Every fixture had been exercising the exit-0 path. Fixed, with the real v1.28.0 output as a
  regression test.
- **Three rules the live data forced into `Model.js`**, each now a named test: an *uninstalled*
  service with `auto_start: true` must not warn (`reverb` ships exactly that, and would have
  warned forever about something never set up); a stopped Caddy reports **once**, not once per
  site (otherwise `all-stopped` emits fifteen identical issues); and an absent `route_present`
  means *unknown*, not missing, so a v1 contract without the PROPOSED fields still renders
  truthfully.
- **The mark is not monochrome.** The placeholder Nerd Font glyph resolves to a colour font, so
  `color: root.foreground` is ignored and it renders two-tone regardless of theme. Harmless
  now, but §5.1's "monochrome, taking the bar foreground" is not satisfied until the Phase 5
  mark asset lands. **Track it there.**
- **G7 is only half closed.** `Theme.js` defines a distinct glyph per level so colour is never
  the sole carrier, but `Mark.qml` draws a plain coloured `Rectangle` and uses motion (a pulse
  on `down`) as the second channel. In a still frame `warn` and `down` differ by hue alone —
  which is precisely the failure G7 predicted on an amber-foreground theme. Either use
  `Theme.glyphFor()` in the dot or give `warn` a distinct shape.

### Phase 3 — Panel `v0.2`

- [ ] `Panel.qml`, `DenseView.qml`, `ColumnsView.qml`, view toggle bound to `v`, choice
      persisted in the bar's settings.
- [ ] All sections from §5.2; leaf components; scroll + collapse for 15+ sites.
- [ ] Escape closes; `summon`/`hide` routes work; survives disable/re-enable and a shell restart.

### Phase 4 — Actions `v0.3`

- [ ] `Actions.js` allowlist, argv construction, snapshot validation, confirm-gates.
- [ ] `run(request)` + `actionState` + spinner + red-icon-with-refusal + 6s self-clear.
- [ ] Refresh burst; per-action timeout (15s default, 120s for image pulls) with a message
      that names what timed out.
- [ ] `Actions.js` tests: every row shape → the exact argv, and the refusal cases.

### Phase 5 — Publish `v1.0`

- [ ] `README.md` (install / usage / configure / remove), `LICENSE`, `preview.png`.
- [ ] `omarchy plugin validate` + `qmllint` clean; CI runs both plus `node --test`.
- [ ] Version-gate message when `hubdev` predates the contract.
- [ ] Marketplace submission via the plugin template issue.

### Phase 6 — *(optional)* `hubdev api` daemon

Only if polling proves insufficient. `SourceHttp.js` replaces `SourceJson.js`; `Model.js`,
the views and the tests do not change. That is the whole point of the seam.

---

## 8. Repo layout

```
hubdev-omarchy-buddy/
├── manifest.json              io.hubdev.buddy, schemaVersion 1
├── BarWidget.qml              the only I/O owner
├── Panel.qml  DenseView.qml  ColumnsView.qml
├── Mark.qml  StatRow.qml  StatusDot.qml  SectionTitle.qml
├── Meter.qml  Flag.qml  ActionIcon.qml  ActionRow.qml  DriverGlyph.qml
├── Source.js  SourceJson.js  SourceFiles.js     the adapter seam
├── Model.js  Actions.js  Theme.js               pure JS, QML-free
├── test/{model,actions,source}.test.mjs         node --test
├── test/fixtures/*.json
├── docs/implementation-plan.md                  this file
├── README.md  LICENSE  preview.png
└── .github/workflows/ci.yml                     node --test + qmllint + plugin validate
```

Local dev loop: develop in `~/.config/omarchy/plugins/io.hubdev.buddy` symlinked — **no:
the validator rejects symlinks.** Confirmed in `/usr/bin/omarchy-plugin-validate`, which
fails on the first symlink found anywhere in the folder. It *prunes `.git`*, though, with the
comment "installed plugins are git checkouts" — so **a git checkout at
`~/.config/omarchy/plugins/io.hubdev.buddy` with this repo as `origin` is the sanctioned
loop**, not a workaround. `rsync` on save is the fallback. Saved QML reloads automatically;
`rescanPlugins` is only needed for manifest changes.

Run `omarchy plugin validate ~/.config/omarchy/plugins/io.hubdev.buddy` before every commit
that touches `manifest.json` — it mirrors the checks in `shell/services/PluginRegistry.qml`,
so it refuses exactly what the running shell would refuse.

> **Correction (Phase 2).** "Saved QML reloads automatically" is **wrong for `bar-widget`s**,
> and it cost most of a session. The shell logs `Local plugin changed, reloading: <id>` on
> every save, but the already-instantiated widget keeps running the code it was built with:
> edits produced no effect, `console.log` never fired, and a deliberate syntax error was
> loaded without complaint — while the shell went on reporting an `IpcHandler` warning at the
> *pre-edit* line number, which is what finally gave it away. **`omarchy-restart-shell` after
> every QML edit** is the actual dev loop. The line number in a QML warning is the cheapest
> way to tell which version is really running.

---

## 9. Risks

| | Risk | Mitigation |
|---|---|---|
| R1 | ~~**`Process` may not be available to plugins.** Kills approach A.~~ **CLOSED 2026-08-31.** | The Phase 0 spike does it, live, as a third-party plugin (§7 P0) — and `bobbynicholas.omaland`, an unrelated third-party plugin already installed here, imports `Quickshell.Io` too. No residual risk. The A'/B rungs remain documented only as insurance against a future tightening of the plugin API. |
| R2 | Poll cost grows with running containers. **Re-measured under load (§7.2) and worse than assumed: `service:list` 87ms → 568ms, `status` 374ms → 918ms, naive fan-out ~3.1s.** | Confirmed real, and it moved `services` out of the cheap tier: **cheap** (`caddy,php,sites` ≈560ms) 30s/5s · **expensive** (`services,docker,health,backups`) 30s only. One aggregate call · TTL cache — now load-bearing, not a nicety · coalescing · suspend when hidden. |
| R3 | ~~A verb prompts for sudo and hangs the shell process **invisibly**.~~ **Re-scoped 2026-08-31 (§7.1): the invisible-prompt mode does not exist.** `RunPrivileged` only ever runs `sudo -n` (never prompts) then falls back to `pkexec` — a *visible* polkit dialog that still blocks the `Process`. | Enumerated: `service:*`, `caddy:start\|stop`, `php:start\|stop` are all NOPASSWD-covered and safe. **`site:fix` is excluded** — it calls `chmod` outside the sudoers rule, and only *conditionally*, so it passes every manual test until it doesn't. Hard timeout on every `Process` regardless. |
| R4 | The contract lands late relative to the plugin. *(Downgraded: the CLI source is fully available and cloned at `~/Projects/HubDev/devhub-go`. This is a scheduling risk, not an access one — and with v1.28.0 shipping without `snapshot`, it is the risk most likely to set the v1 date.)* | Phases 1 and 2 run in parallel against committed fixtures, so neither blocks the other. `SourceFiles.js` remains as a spike-only fallback, not a shipping path. |
| R5 | Quattro plugin API is young; `schemaVersion 1` may move. | Now running Omarchy 4.0.2-1, where the validator requires `schemaVersion` to be exactly the JSON number `1`. Pin it, run `omarchy plugin validate` in CI, and re-check on every Omarchy release — the API is young enough that a `2` is a question of when. |
| R6 | Secrets on screen: `services.yml` passwords, `license.json` key, tokens in logs. | Strip at the contract; no log surfaces in v1; a test that greps rendered strings for known secrets. |
| R7 | The GUI and the widget mutate concurrently and disagree. | Snapshot is read-only truth + refresh burst after every mutation; never cache mutable state in the widget. |
| R8 | Overlap with HubDev's own GUI — why does this exist? | It is a *glance*, not a console: zero window switching, and it deliberately refuses the long/destructive work that belongs in the GUI. |

---

## 10. Open questions

1. ~~Is the HubDev CLI source yours to change?~~ **Answered: yes** — full access to the
   `hubdev` organization including the CLI source and binary, cloned at
   `~/Projects/HubDev/devhub-go`. The remaining question is narrower:
   **which HubDev release carries `snapshot --json`**, since the plugin must version-gate
   against it. Current is v1.28.0 and does not, so the answer is v1.29.0 at the earliest.
2. **Public or personal?** A marketplace plugin makes this part of HubDev's product story
   (and a good answer to lerd Glance); a personal plugin can skip Phase 5 entirely.
3. **Read-only v1, or actions from the start?** Read-only halves the surface and removes
   R3 entirely.
4. Does the widget ever need to show a **remote** HubDev? If yes, that argues for B now.

---

## 11. Grill — the plan under adversarial review

Each challenge, the verdict, and whether it changed the plan above. ✅ = plan revised,
◻︎ = challenge answered, plan unchanged.

### ✅ G1 — "The critical path runs through a repo you cannot see."
`hubdev snapshot --json` is invented. The CLI source is not on this machine, so Phase 1 is
work in a codebase this plan has never read, and Phase 2 was written as if it depended on it.
**Verdict: valid, and the phase ordering was wrong.** *Revised §7:* Phases 1 and 2 run in
parallel; the **fixtures are the contract**, hand-written first from the `hubdev mcp` output
that demonstrably already exists. The plugin reaches feature-complete against fixtures with
no CLI change at all. R4 shrinks from "blocker" to "integration date".
**Update (post-grill):** the premise was weaker than stated — the CLI source *is* fully
available, and has since been cloned to `devhub-go` (§3.1 was written from it). The
revision stands on its own merits (parallel phases, fixtures as the contract), but R4 drops
from a real risk to a scheduling note.

### ✅ G2 — "You bet the whole plan on `Process`, which the docs never mention."
The Omarchy plugin docs list `QtQuick`, `Quickshell`, `qs.Ui`, `qs.Commons`. `Quickshell.Io`
— where `Process` lives — is not named. The original mitigation ("pivot to a daemon") moved
weeks of work into another repo on a coin flip. **Verdict: valid, and the mitigation was
lazy.** *Revised §4:* there is a middle rung. QML's `XMLHttpRequest` is proven available
(lerd uses it) and reads `file://`, so a systemd user timer writing
`~/.cache/hubdev/snapshot.json` gives a read-only plugin with **no Process and no daemon**.
Ladder: `Process` → `XHR file://` → `XHR http://`.
**Update (post-upgrade): the challenge was right to demand a ladder, and the ladder is no
longer needed for its original purpose.** With Quattro installed, `Quickshell.Io` is present,
the loader enforces no import allowlist, and a first-party `bar-widget` already runs
`Process` — so rung one holds (§7 P0). The ladder survives as insurance against a future
tightening of the plugin API, and rung A' turns out to describe how `omarchy.agents` actually
works, which makes it a better-evidenced fallback than when it was written.

### ✅ G3 — "Polling a CLI at 5s is not the same as polling HTTP at 5s."
lerd's 5s is seven HTTP round-trips to a running process. Ours is a Go binary cold-start
plus Docker probes, already 374ms with everything *stopped*. **Verdict: valid.** *Revised
§4.1:* two explicit tiers, and the expensive one (docker/health/backups) never runs at 5s —
30s and on-open only, regardless of panel state.

### ✅ G4 — "lerd Glance is designed for a handful of sites. You have fifteen."
Three columns at 760px with 15 sites, 8 services and 2 PHP versions does not fit on screen.
**Verdict: valid.** *Revised §5.2:* panel caps at 70% screen height, sections scroll
independently, inactive sites and uninstalled services collapse behind a count, and the
15-site fixture is the acceptance gate for the columns view.

### ✅ G5 — "Your contract mixes fields HubDev already has with fields you made up."
`route_present`, `tls`, `update_available` are inventions; `services[]` and `caddy` are real.
Presenting them uniformly hides where the schedule risk actually is. **Verdict: valid.**
*Revised §4.1:* every field is marked **known** or **PROPOSED**, and a v1 that drops all the
proposed ones still works.

### ✅ G6 — "'Confirm-gate' is not a design."
A modal in a panel that closes on Escape fights the panel. **Verdict: valid.** *Revised
§5.4:* inline two-step — the icon becomes a labelled "Sure?" for 4s, second click sends.
Also caught that `site:stop` *removes the Caddy route*, so it belongs behind the gate too.

### ✅ G7 — "Nothing in the plan says how this survives the user's own theme."
This machine runs amber `#F99957` on navy — amber sits next to the warning colour, so a
colour-only warning state would be invisible here. **Verdict: valid.** *Added §5.3.1:* state
colour hard-coded, chrome inherits `qs.Ui.Style`, and warning must be distinguishable by
glyph as well as hue.

### ◻︎ G8 — "Why not read HubDev's config files and skip the CLI entirely?"
It works — `sites.yml` + `services.yml` + Caddy's admin API on `:2019` + `docker ps` covers
most of the panel with zero HubDev changes, today. **Verdict: rejected as the plan, kept as
`SourceFiles.js`.** It reimplements HubDev's own resolution logic (which of two services
"owns" a port, what makes a site active, how `mode` interacts with Docker) in a second place,
in JavaScript, where it will silently drift from the Go that defines it. Acceptable for a
spike, wrong to ship — one HubDev release changes a key and the bar lies.

### ◻︎ G9 — "Why not just talk to `hubdev mcp`? The JSON is already there."
**Verdict: rejected.** MCP is an agent protocol with session semantics, and HubDev ships a
master switch (`hubdev mcp:disable`) whose entire purpose is refusing new sessions. A bar
widget that dies when the user disables MCP — or that holds a session open forever so the
tool counts and connected-client list are permanently wrong — is a misuse of that surface.

### ◻︎ G10 — "This duplicates the HubDev GUI. What is it actually for?"
**Verdict: answered.** The GUI is a window that must be raised, focused and dismissed; this
is a dot in a bar that is already on screen. The scope split makes the distinction real
rather than rhetorical: the widget deliberately **refuses** `site:new`, `backup:restore`,
`artisan`, `composer`, logs and anything that downloads — all of which stay in the GUI or a
terminal, with explicit escape hatches to both.

### ◻︎ G11 — "A sudo prompt inside a QML `Process` hangs the shell with no visible cause."
**Verdict: the severity was right, the mechanism was wrong — and Phase 0 settled it.**
`sudo -n -l` *does* work here (the earlier failure was a cleared timestamp, not a missing
rule), and reading `privilege_linux.go` shows `RunPrivileged` never runs an interactive
`sudo`: it is `sudo -n` (fails fast, never prompts) then `pkexec` (a **visible** polkit
dialog). So the hang is real but not silent. §7.1 enumerates the verbs; `site:fix` is the one
casualty, excluded because it escalates *conditionally*. Hard timeout on every `Process` stays.
The spike also turned up a finding for `devhub-go` itself: the rule grants
`NOPASSWD: /usr/bin/bash -c *`, which is passwordless root written long-hand.

### ◻︎ G12 — "No QML is tested. At all."
**Verdict: accepted, deliberately — same trade lerd makes.** Every rule worth getting wrong
(health thresholds, addressing, refusal parsing, secret stripping) lives in `Model.js` and
`Actions.js`, which are QML-free and run under `node --test`. QML is covered by the docs'
manual checklist as the Phase 3/4 exit gate: click, Escape, `summon`/`hide`, disable and
re-enable, shell restart, removal.

### ◻︎ G13 — "Should this even be a `bar-widget`?"
**Verdict: yes.** `menu` and `overlay` are summoned; a glance must be *already visible* or it
is not a glance. Worth noting for later: a `service` kind could expose HubDev state as a
headless singleton other plugins and keybinds could read — out of scope for v1.

### Residual risk after the grill

The plan now survives its two worst cases — a late CLI contract (G1, fixtures-as-contract)
and no `Process` (G2, XHR ladder) — with a reduced but real v1 in both.

Reading `devhub-go` then closed the third: **there is no cross-process lock**, so polling
reads cannot contend with the GUI, and the refresh model stands as designed. What the source
put in its place is smaller but real — **writes are last-writer-wins**, with no file lock
between the widget, the CLI and the GUI. That is pre-existing HubDev behaviour, not something
this plugin introduces, but the plugin makes it easier to hit.

**Post-upgrade revision.** The unknown that carried the plan — R1, whether a plugin may use
`Quickshell.Io.Process` — is closed in everything but a live smoke test: the module is
installed, the loader has no import allowlist, and `omarchy.agents` does exactly this from a
`bar-widget` today. The plan no longer has a single-point failure that could halve it.

~~**What carries it now is the sudo enumeration (R3/G11).**~~ **Done — see §7.1.** It cost the
plan exactly one verb (`site:fix`) and downgraded the failure mode from *silent hang* to
*visible blocking dialog*. The architecture is untouched.

**What Phase 0 put in its place is R2.** Measured under load, a naive fan-out is ~3.1s and
`service:list` alone is 568ms and scales with container count. The tiering in §4.1 was wrong
about which calls are cheap, and the TTL cache is no longer optional. Nothing here threatens
the design — the aggregate `snapshot` call is precisely the fix — but it means a v1 built on
seven separate spawns would have felt bad on this machine, and it is the number to re-check
whenever the panel gains a section.

Second, and unchanged: **the contract does not exist yet.** v1.28.0 has no `snapshot --json`,
so Phase 2 runs against hand-written fixtures exactly as G1 forced it to. That is a schedule
dependency, not a risk — but it is the thing most likely to make v1 later than it looks.
