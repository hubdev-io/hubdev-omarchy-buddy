# HubDev Buddy

> The state of your [HubDev](https://hubdev.io) environment at a glance in the Omarchy
> Quattro bar. Sites, services, PHP versions, Caddy and Docker — without raising the GUI.

**Status: Phase 0 complete. No shipping code in this repository yet — but the platform is
proven, not assumed.**

Omarchy **Quattro 4.0.2-1** (Quickshell 0.3.1) runs on the development machine, and the
readiness spike has been *run*: a throwaway third-party plugin drives `Quickshell.Io.Process`
against the `hubdev` CLI and renders the live site count in the bar. That closes the one
unknown that could have halved the project. Phase 2 — the read-only widget — is next.

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

Start at §3.1 (what the HubDev source confirms) and §4 (the architecture decision), then
**§7 Phase 0** for what running the spike actually established. §11 is an adversarial review
of the plan by itself: thirteen challenges, seven of which changed it.

## License

MIT
