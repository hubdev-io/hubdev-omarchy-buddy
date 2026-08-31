# HubDev Buddy

> The state of your [HubDev](https://hubdev.io) environment at a glance in the Omarchy
> Quattro bar. Sites, services, PHP versions, Caddy and Docker — without raising the GUI.

**Status: planning. There is no code in this repository yet.**

Omarchy Quattro (QuickShell) is not yet installed on the development machine — it is still
running Omarchy 3.8.5, where neither QuickShell nor `omarchy plugin` exists. Implementation
starts once Quattro is up, so every phase can be built and tested against a live bar rather
than guessed at.

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

**The open unknown.** The Omarchy plugin docs list `QtQuick`, `Quickshell`, `qs.Ui` and
`qs.Commons` — not `Quickshell.Io`, where `Process` lives. Whether a plugin may spawn a
subprocess decides between a full plugin and a read-only one. It is the first thing Phase 0
answers, and nothing else should be built before it.

## Planned layout

```
manifest.json                     io.hubdev.buddy, schemaVersion 1
BarWidget.qml                     the only file that does I/O
Panel.qml  DenseView.qml  ColumnsView.qml
Source.js  SourceJson.js          the transport seam
Model.js  Actions.js  Theme.js    pure JS, QML-free, tested under node
test/                             node --test + fixtures
```

## Reading the plan

Start at §3.1 (what the HubDev source confirms) and §4 (the architecture decision). §11 is an
adversarial review of the plan by itself: thirteen challenges, seven of which changed it.

## License

MIT
