# HubDev Buddy

> The state of your [HubDev](https://hubdev.io) environment at a glance in the Omarchy
> Quattro bar. Sites, services, PHP versions, Caddy and Docker — without raising the GUI.

**Status: Phases 0–3 complete. The widget runs in the bar, the contract it reads exists, and
clicking it opens the panel.**

Omarchy **Quattro 4.0.2-1** (Quickshell 0.3.1). `io.hubdev.buddy` is installed and rendering:
a mark that stays quiet when the environment is healthy, gains an **amber dot** when something
needs attention, and a **red dot** when nothing will serve. Clicking it opens a panel with
Sites, Services and Environment — and *Needs attention* only when there is something to say —
in either a dense list or three columns, toggled with `v` and remembered across restarts.
Clicking a site opens it in the desktop's browser. All three states are verified on screen,
and the QML-free logic has 78 tests over 10 fixtures.

**`hubdev snapshot --json` is implemented** in HubDev's own CLI, and the widget's
`SourceJson.parse()` → `Model.summarize()` reduces its live output to `level: ok`,
`Sites 14/15 · Services 5/8 · PHP 8.4 (default) · Caddy 2.11.4`. The two halves were built in
parallel against committed fixtures written from `hubdev mcp` output *before* the Go code
existed — and those fixtures **passed unchanged** against the real implementation.

The verb ships in **HubDev v1.29.0**, which is built and installed here. Against an older
HubDev the widget still, correctly, reports *"This HubDev is too old — `snapshot --json` is
not available"*.

**The panel needed no new CLI.** Every section is built from the Phase 1 contract as shipped —
including Node's version, which arrives as a health check rather than a field of its own. The
one thing [lerd Glance](https://github.com/lerd-env/lerd-omarchy-glance) has that HubDev
cannot supply is its CPU/memory meter strip: there is no CPU figure at all, and the memory
figure costs a Docker stats sample per service, which is not a price a 30-second poll should
pay. §5.2 replaces it with the Environment column.

## What is here

| Path | |
|---|---|
| [`docs/implementation-plan.md`](docs/implementation-plan.md) | The plan. Architecture, scope, phases, risks, and the adversarial review that reshaped it. |
| `docs/research/hubdev-buddy-plan.html` | A presentation copy of the same plan, published privately as an Artifact. |

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
Panel.qml                         the popout: header, view, hand-offs
DenseView.qml  ColumnsView.qml    two arrangements of the same sections
*Section.qml                      Sites · Services · Environment · Attention · Extras
Section.qml  InfoRow.qml  SiteRow.qml  ServiceRow.qml  StatusDot.qml  CollapseRow.qml
test/                             node --test, harness + 10 fixtures
tools/hubdev-snapshot             dev-only reference implementation of the contract,
                                  written before the Go one and kept as its acceptance target
                                  ── still to come ──
Actions.js                                    Phase 4
```

`test/harness.mjs` loads the real `.js` files into node, stripping only QML's `.pragma`
directive, so the tests run exactly what the shell loads and there is no second copy to drift.

## Reading the plan

Start at §3.1 (what the HubDev source confirms) and §4 (the architecture decision), then
**§7 Phase 0** for what running the spike actually established. **§7.6** is the most useful
section if you are reading for lessons rather than scope: four things the plan got wrong that
only became visible once the code existed — including a cache that cannot work in a
process-per-call CLI, and a telemetry event that a 30-second poll would have fired a few
thousand times a day. §11 is an adversarial review of the plan by itself: thirteen challenges,
seven of which changed it.

## License

MIT
