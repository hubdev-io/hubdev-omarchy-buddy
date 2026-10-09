import { test } from "node:test";
import assert from "node:assert/strict";
import { load, fixture } from "./harness.mjs";

const Source = load("SourceJson.js");
const Model = load("Model.js");

// -------------------------------------------------------------- request ----

test("a request is a fixed argv array, never a shell string", () => {
  const r = Source.request("full");
  assert.equal(r.kind, "process");
  assert.ok(Array.isArray(r.argv));
  // Pinned: a bare name would resolve through an inherited PATH.
  assert.equal(r.argv[0], "/usr/bin/hubdev");
  for (const a of r.argv) assert.equal(typeof a, "string");
  // Nothing a shell would reinterpret.
  assert.ok(!r.argv.some((a) => /[;&|`$<>]/.test(a)), `argv is shell-unsafe: ${r.argv}`);
});

test("the cheap tier excludes every call Phase 0 measured as expensive", () => {
  const cheap = Source.request("cheap").argv.slice(1).join(" ");
  for (const expensive of ["services", "docker", "health", "backups"])
    assert.ok(!cheap.includes(expensive), `cheap tier must not include ${expensive}`);
  for (const included of ["caddy", "php", "sites"])
    assert.ok(cheap.includes(included));
});

test("an unknown tier falls back to full rather than to nothing", () => {
  const r = Source.request("nonsense");
  assert.equal(r.tier, "full");
  assert.deepEqual(r.argv, Source.request("full").argv);
});

test("every request has a hard timeout", () => {
  assert.ok(Source.timeoutMs("cheap") > 0);
  assert.ok(Source.timeoutMs("full") >= Source.timeoutMs("cheap"));
});

// ---------------------------------------------------------------- parse ----

test("a good snapshot parses and feeds the model", () => {
  const r = Source.parse(JSON.stringify(fixture("healthy")), 0);
  assert.equal(r.ok, true);
  assert.equal(Model.summarize(r.snapshot).level, "ok");
});

test("ANSI table output is reported as an old HubDev, not a JSON error", () => {
  const r = Source.parse("NAME     DOMAIN\n[32myes[0m  beacon.lab\n", 0);
  assert.equal(r.ok, false);
  assert.match(r.error, /too old/);
  assert.ok(!/unexpected token|SyntaxError|position \\\\d/i.test(r.error), "the message must not leak a parser error");
});

test("a missing binary reads as not installed", () => {
  for (const code of [127, -1, -2]) {
    const r = Source.parse("", code);
    assert.equal(r.ok, false);
    assert.match(r.error, /not installed/);
  }
});

test("an old hubdev that rejects the verb reads as a version gate, not a crash", () => {
  // Verbatim shape of `hubdev snapshot --json` on v1.28.0: the refusal and the
  // whole usage screen go to STDOUT, and it exits 1. Reporting that as
  // "exited with code 1" is true and useless; this is the version gate the
  // plan's Phase 5 checklist asks for.
  const real = "Unknown command: snapshot\n\nHubDev v1.28.0 — Hybrid Development Environment Manager\n\nUsage: hubdev [global flags] <command> [arguments]\n";
  const r = Source.parse(real, 1);
  assert.equal(r.ok, false);
  assert.match(r.error, /too old/);
  assert.ok(!/code 1/.test(r.error), "must not fall through to the generic exit-code message");
});

test("a non-zero exit is reported with its code", () => {
  const r = Source.parse("", 3);
  assert.equal(r.ok, false);
  assert.match(r.error, /code 3/);
});

test("empty and non-object output are refused, not passed through", () => {
  for (const [out, code] of [["", 0], ["   \n", 0], ["[]", 0], ["null", 0], ['"hi"', 0]]) {
    const r = Source.parse(out, code);
    assert.equal(r.ok, false, `should refuse: ${JSON.stringify(out)}`);
    assert.ok(r.error.length > 0);
  }
});

test("parse never throws, whatever it is handed", () => {
  for (const junk of [undefined, null, 0, {}, [], "{oh no", "\x00"]) {
    assert.doesNotThrow(() => Source.parse(junk, 0));
    assert.doesNotThrow(() => Source.parse(junk, 1));
  }
});

// -------------------------------------------------------------- cadence ----

test("closed polls at 30s, open at 5s", () => {
  assert.equal(Source.intervalFor({ open: false, consecutiveFailures: 0 }), 30000);
  assert.equal(Source.intervalFor({ open: true, consecutiveFailures: 0 }), 5000);
});

test("failures back off exponentially and cap at 60s", () => {
  const seen = [1, 2, 3, 4, 5, 12].map((f) => Source.intervalFor({ open: true, consecutiveFailures: f }));
  assert.deepEqual(seen, [30000, 60000, 60000, 60000, 60000, 60000]);
  // Backoff must beat the open interval — an absent HubDev should not be
  // probed every 5 seconds just because the panel happens to be open.
  for (const ms of seen) assert.ok(ms >= 30000);
});

test("the closed interval follows the refreshIntervalSec setting", () => {
  assert.equal(Source.intervalFor({ open: false, idleMs: 120000 }), 120000);
  assert.equal(Source.intervalFor({ open: false, idleMs: 5000 }), 5000);
  // The open panel keeps its own pace whatever the setting says.
  assert.equal(Source.intervalFor({ open: true, idleMs: 120000 }), 5000);
});

test("an out-of-range or malformed setting falls back to 30s", () => {
  for (const idleMs of [0, -1000, 4999, 600001, NaN, Infinity, "60000", null])
    assert.equal(Source.intervalFor({ open: false, idleMs }), 30000, String(idleMs));
});

test("backoff never runs faster than 30s, and never slower than a long setting", () => {
  const fast = [1, 2, 3].map((f) => Source.intervalFor({ open: false, idleMs: 5000, consecutiveFailures: f }));
  assert.deepEqual(fast, [30000, 60000, 60000]);
  const slow = [1, 2, 3].map((f) => Source.intervalFor({ open: false, idleMs: 300000, consecutiveFailures: f }));
  assert.deepEqual(slow, [300000, 300000, 300000]);
});

test("intervalFor tolerates a missing or partial state", () => {
  for (const s of [undefined, null, {}, { open: true }, { consecutiveFailures: 1 }])
    assert.ok(Source.intervalFor(s) >= 5000);
});

test("an open panel alternates tiers so Docker never enters the 5s loop", () => {
  assert.equal(Source.tierFor({ open: true, msSinceFullRefresh: 0 }), "cheap");
  assert.equal(Source.tierFor({ open: true, msSinceFullRefresh: 4000 }), "cheap");
  assert.equal(Source.tierFor({ open: true, msSinceFullRefresh: 30000 }), "full");
  // Closed always asks for everything — it only happens twice a minute.
  assert.equal(Source.tierFor({ open: false, msSinceFullRefresh: 0 }), "full");
  assert.equal(Source.tierFor(undefined), "full");
});
