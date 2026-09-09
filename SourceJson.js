.pragma library

// The transport adapter: `hubdev snapshot --json`, spawned by BarWidget.qml.
//
// THE SEAM. This file never spawns anything — BarWidget.qml is the only I/O
// owner (see CLAUDE.md). What lives here is everything about the transport that
// can be decided without doing it: which argv to build, which tier to ask for,
// how fast to ask again, and how to turn stdout into a snapshot or a refusal.
// Swapping the CLI for the Phase 6 loopback daemon is one line in
// BarWidget.qml — `import "SourceJson.js" as Source` becomes
// `import "SourceHttp.js" as Source` — provided the replacement exports the
// same four functions: request(), parse(), intervalFor(), timeoutMs().

// The absolute path, not the name.
//
// A bare `hubdev` resolves through whatever PATH the shell process inherited,
// and any other process running as this user can prepend a directory to that.
// It matters more here than in most plugins: the service verbs reach root
// through HubDev's own NOPASSWD sudoers rule, so "which binary is hubdev"
// is a question on a privilege path. `hubdev-bin` installs to /usr/bin/hubdev;
// a HubDev installed anywhere else is reported as missing rather than resolved
// by search, and the README says so.
var BIN = "/usr/bin/hubdev";

// Two tiers, and the expensive one never runs at 5s (plan §4.1, revised by the
// Phase 0 measurements in §7.2).
//
// Measured warm on the dev machine with 5 containers running:
//   sites 100ms · caddy 115ms · php 342ms  -> cheap, ~560ms total
//   services 568ms · status 918ms · doctor 1071ms
// `service:list` probes Docker per service, so it scales with container count,
// not site count. It was in the plan's cheap tier; it is not cheap.
var TIERS = {
  cheap: ["caddy", "php", "sites"],
  full: ["caddy", "php", "sites", "services", "docker", "health", "tunnels", "backups"]
};

// What to run for a tier. `kind` is what BarWidget switches on; an HTTP
// adapter would return { kind: "http", url: ... } and change nothing else.
function request(tier) {
  var include = TIERS[tier] || TIERS.full;
  return {
    kind: "process",
    argv: [BIN, "snapshot", "--json", "--include=" + include.join(",")],
    tier: TIERS[tier] ? tier : "full"
  };
}

// Hard timeout per request. Every Process must have one: a verb that escalates
// falls back to `pkexec`, which raises a polkit dialog and blocks until it is
// answered (plan §7.1). Reads never escalate, but the timeout is what keeps
// that true by construction rather than by trust.
function timeoutMs(tier) {
  return tier === "cheap" ? 5000 : 15000;
}

var TOO_OLD = "This HubDev is too old — `snapshot --json` is not available";

// The refusal's machine-readable half. The panel offers a different action for
// a HubDev that is merely OLD than for one that is missing or broken, and
// deciding which by matching the prose above would make that wording load
// bearing — rename the sentence and the button silently reverts. The string is
// for the user; this is for the code.
var OUTDATED = "outdated";

// Turn a completed process into a snapshot or a refusal. Never throws — a
// widget that throws inside the shell process takes the bar with it.
function parse(stdout, exitCode) {
  var out = typeof stdout === "string" ? stdout : "";

  if (exitCode !== 0) {
    // 127 is the shell's "not found"; Qt reports a failed spawn as -1 or -2.
    if (exitCode === 127 || exitCode < 0)
      return { ok: false, error: "HubDev is not installed", code: "missing" };
    // A HubDev predating the contract prints "Unknown command: snapshot"
    // followed by its whole usage screen — on STDOUT — and exits 1.
    // Verified against v1.28.0. That is the version gate, not a crash, and
    // reporting it as "exited with code 1" tells the user nothing actionable.
    if (/unknown command/i.test(out))
      return { ok: false, error: TOO_OLD, code: OUTDATED };
    return { ok: false, error: "HubDev exited with code " + exitCode, code: "error" };
  }

  var text = out.trim();
  if (!text)
    return { ok: false, error: "HubDev returned nothing", code: "error" };

  var doc;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    // Exit 0 with non-JSON means a hubdev that accepted the verb but printed
    // a table instead. Same conclusion, same wording.
    return { ok: false, error: TOO_OLD, code: OUTDATED };
  }

  if (!doc || typeof doc !== "object" || Array.isArray(doc))
    return { ok: false, error: "HubDev returned an unexpected snapshot", code: "error" };

  return { ok: true, snapshot: doc };
}

// ------------------------------------------------------------ cadence ----

var IDLE_MS = 30000;
var OPEN_MS = 5000;
var BACKOFF_CAP_MS = 60000;

// How long to wait before the next poll.
//
//  - open panel  -> 5s, but only the cheap tier (the caller alternates)
//  - closed      -> 30s
//  - unreachable -> exponential backoff to 60s, so a machine without HubDev
//                   installed is not spawning a doomed process every 30s
//                   forever.
function intervalFor(state) {
  var s = state || {};
  var failures = typeof s.consecutiveFailures === "number" ? s.consecutiveFailures : 0;
  if (failures > 0) {
    var backoff = IDLE_MS * Math.pow(2, failures - 1);
    return Math.min(backoff, BACKOFF_CAP_MS);
  }
  return s.open ? OPEN_MS : IDLE_MS;
}

// Which tier this tick should ask for. The expensive blocks refresh on a 30s
// wall clock regardless of panel state, so an open panel alternates rather than
// dragging Docker probes into a 5s loop.
function tierFor(state) {
  var s = state || {};
  if (!s.open)
    return "full";
  var since = typeof s.msSinceFullRefresh === "number" ? s.msSinceFullRefresh : 0;
  return since >= IDLE_MS ? "full" : "cheap";
}
