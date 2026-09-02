// Start and stop for Caddy and each PHP-FPM pool, from the Environment rows.
//
// Written the way services.test.mjs is written, and for the same reason: these
// verbs reach the machine, so the assertions are against the argv element by
// element plus every refusal. The array asserted here is the array bash gets.
//
// The extra thing this file has to hold, which the service tests do not, is
// that MOST rows in this section are readouts. DNS, the hosts file, Node,
// Docker, the diagnostics roll-up — they sit in the same list, drawn by the
// same component, and none of them may ever acquire a button. That property is
// carried by `target`, and the sweep at the foot of this file is what proves it
// for every row the panel actually draws.

import { test } from "node:test";
import assert from "node:assert/strict";
import { load, fixture } from "./harness.mjs";

const Actions = load("Actions.js");
const Model = load("Model.js");
const Theme = load("Theme.js");

const healthy = Model.summarize(fixture("healthy"));          // caddy up, 8.4 up, 8.5 down
const caddyDown = Model.summarize(fixture("caddy-down"));     // caddy down, 8.4 up
const fpmDown = Model.summarize(fixture("php-default-fpm-down")); // caddy up, 8.4 down

const envRow = (summary, target) =>
  Model.envRows(summary).find((r) => r.target === target);

const caddy = envRow(healthy, "caddy");
const php84 = envRow(healthy, "php:8.4");
const php85 = envRow(healthy, "php:8.5");

// ------------------------------------------------------------- the table --

test("two verbs, and no restart", () => {
  // HubDev has caddy:start / caddy:stop and php:start / php:stop, and no
  // restart for either. A third button would be this plugin inventing a verb.
  assert.deepEqual(Actions.envActions().map((a) => a.key), ["start", "stop"]);
});

test("the table hands out a copy, not the allowlist itself", () => {
  const first = Actions.envActions();
  first.push({ key: "reset", icon: "stop", label: "Reset" });
  first[0].key = "clobbered";
  assert.deepEqual(Actions.envActions().map((a) => a.key), ["start", "stop"]);
});

test("no action carries argv out of the table", () => {
  for (const a of Actions.envActions()) {
    assert.equal(a.args, undefined);
    assert.equal(typeof a.icon, "string");
    assert.notEqual(Theme.icon(a.icon), "");
  }
});

test("stop asks first; start does not", () => {
  assert.equal(Actions.envNeedsConfirm("stop"), true);
  assert.equal(Actions.envNeedsConfirm("start"), false);
  assert.equal(Actions.envNeedsConfirm("restart"), false);
  assert.equal(Actions.envNeedsConfirm(""), false);
  assert.equal(Actions.envNeedsConfirm(null), false);
});

test("every verb has a timeout, and an unknown one still gets a bounded default", () => {
  for (const a of Actions.envActions())
    assert.ok(Actions.envTimeoutMs(a.key) > 0, a.key);
  assert.ok(Actions.envTimeoutMs("nonsense") > 0);
  assert.ok(Actions.envTimeoutMs(undefined) > 0);
});

// ----------------------------------------------------------- the target --

test("only the two actionable rows carry a target", () => {
  const targets = Model.envRows(healthy).map((r) => Actions.envTarget(r)).filter(Boolean);
  assert.deepEqual(targets, ["caddy", "php:8.5", "php:8.4"]);
});

test("a readout row is inert, and stays inert", () => {
  // The regression this guards: giving a promoted health check a name that
  // looks like a service must never be enough to earn it a button.
  for (const row of Model.envRows(healthy)) {
    if (row.target) continue;
    assert.equal(Actions.envTarget(row), "");
    assert.deepEqual(Actions.navEnvCols(healthy, row), [], row.key);
    for (const verb of ["start", "stop"])
      assert.deepEqual(Actions.envArgv(healthy, row, verb), [], `${row.key} ${verb}`);
  }
});

test("a target that did not come from the model is refused", () => {
  const bad = [
    "caddy ", " caddy", "CADDY", "caddy;rm -rf /", "caddy:stop", "--help", "-q",
    "php:", "php:8", "php:8.4.1", "php:latest", "php:../8.4", "php:8.4 --force",
    "php:9999.9999", "docker", "dns_test", "nodejs", "diagnostics", "", "php-8.4"
  ];
  for (const t of bad) {
    assert.equal(Actions.envTarget({ target: t }), "", JSON.stringify(t));
    assert.deepEqual(Actions.envArgv(healthy, { target: t }, "stop"), [], JSON.stringify(t));
  }
});

test("garbage in the row slot refuses rather than throws", () => {
  for (const bad of [null, undefined, "", 0, [], {}, { target: null }, { target: 7 },
                     { target: {} }, Object.create(null)]) {
    assert.deepEqual(Actions.envArgv(healthy, bad, "start"), []);
    assert.deepEqual(Actions.envArgv(healthy, bad, "stop"), []);
    assert.deepEqual(Actions.navEnvCols(healthy, bad), []);
  }
});

// ------------------------------------------------------------------ argv --

test("stopping Caddy is exactly `hubdev caddy:stop`", () => {
  assert.deepEqual(Actions.envArgv(healthy, caddy, "stop"), ["hubdev", "caddy:stop"]);
});

test("starting Caddy is exactly `hubdev caddy:start`", () => {
  assert.deepEqual(Actions.envArgv(caddyDown, envRow(caddyDown, "caddy"), "start"),
                   ["hubdev", "caddy:start"]);
});

test("a PHP verb carries its version, as a separate argument", () => {
  // Never interpolated into one string: the version is the only part of this
  // argv that varies, so it is the only part that could ever be wrong.
  assert.deepEqual(Actions.envArgv(healthy, php84, "stop"), ["hubdev", "php:stop", "8.4"]);
  assert.deepEqual(Actions.envArgv(healthy, php85, "start"), ["hubdev", "php:start", "8.5"]);
  assert.deepEqual(Actions.envArgv(fpmDown, envRow(fpmDown, "php:8.4"), "start"),
                   ["hubdev", "php:start", "8.4"]);
});

test("the version comes from the snapshot, not from the row the view is holding", () => {
  // A stale row cannot smuggle a version past the gate: envLive looks the
  // target up in the CURRENT summary, and a version it does not list is refused.
  const ghost = { key: "php-7.4", target: "php:7.4", label: "PHP 7.4", value: "", level: "idle" };
  assert.deepEqual(Actions.envArgv(healthy, ghost, "start"), []);
  assert.deepEqual(Actions.envArgv(healthy, ghost, "stop"), []);
});

test("a summary with no environment in it refuses everything", () => {
  for (const s of [{}, null, undefined, { caddy: null }, { php: null }]) {
    assert.deepEqual(Actions.envArgv(s, caddy, "stop"), []);
    assert.deepEqual(Actions.envArgv(s, php84, "stop"), []);
  }
});

test("an unknown verb is refused even on a good row", () => {
  for (const verb of ["restart", "reload", "reset", "install", "", null, undefined, 0]) {
    assert.deepEqual(Actions.envArgv(healthy, caddy, verb), [], String(verb));
    assert.deepEqual(Actions.envArgv(healthy, php84, verb), [], String(verb));
  }
});

// -------------------------------------------------------- state gating ----

test("never both verbs on one row, in any fixture", () => {
  // The invariant that makes the buttons readable: what is offered is what
  // would run. Two buttons showing at once would mean one of them lies.
  for (const name of ["healthy", "caddy-down", "all-stopped", "php-default-fpm-down",
                      "minimal", "no-sites", "docker-down", "stopped-by-hubdev"]) {
    const s = Model.summarize(fixture(name));
    for (const row of Model.envRows(s)) {
      const cols = Actions.navEnvCols(s, row);
      assert.ok(cols.length <= 1, `${name} ${row.key}: ${JSON.stringify(cols)}`);
      if (!row.target) assert.equal(cols.length, 0, `${name} ${row.key}`);
    }
  }
});

test("what is running can be stopped; what is stopped can be started", () => {
  assert.deepEqual(Actions.navEnvCols(healthy, caddy), ["stop"]);
  assert.deepEqual(Actions.navEnvCols(healthy, php84), ["stop"]);
  assert.deepEqual(Actions.navEnvCols(healthy, php85), ["start"]);
  assert.deepEqual(Actions.navEnvCols(caddyDown, envRow(caddyDown, "caddy")), ["start"]);
  assert.deepEqual(Actions.navEnvCols(fpmDown, envRow(fpmDown, "php:8.4")), ["start"]);
});

test("a stopped Caddy refuses stop, and a running one refuses start", () => {
  assert.deepEqual(Actions.envArgv(caddyDown, envRow(caddyDown, "caddy"), "stop"), []);
  assert.deepEqual(Actions.envArgv(healthy, caddy, "start"), []);
});

// ----------------------------------------------------------------- gate ----

test("an environment token can never collide with a service one", () => {
  // A machine may perfectly well run a service called `caddy`. Two rows sharing
  // an armed token would arm both buttons, and the second press would fire the
  // wrong one.
  assert.equal(Actions.envToken("caddy", "stop"), "env:caddy:stop");
  assert.equal(Actions.confirmToken("caddy", "stop"), "svc:caddy:stop");
  assert.notEqual(Actions.envToken("caddy", "stop"), Actions.confirmToken("caddy", "stop"));
});

test("a token needs both halves", () => {
  assert.equal(Actions.envToken("", "stop"), "");
  assert.equal(Actions.envToken("caddy", ""), "");
  assert.equal(Actions.envToken(null, null), "");
  assert.equal(Actions.envToken(undefined, "stop"), "");
});

// --------------------------------------------------------------- labels ----

test("the label names the thing, not the row", () => {
  // The row's own label reads "PHP 8.4 (default)", which is a fact about the
  // row and not a name anyone would say out loud.
  assert.equal(Actions.envDisplay(healthy, php84), "PHP 8.4");
  assert.equal(Actions.envDisplay(healthy, caddy), "Caddy");
  assert.equal(Actions.envActionLabel("stop", "Caddy"), "Stop Caddy");
  assert.equal(Actions.envDoneLabel("stop", "Caddy"), "Caddy stopped");
  assert.equal(Actions.envDoneLabel("start", "PHP 8.4"), "PHP 8.4 started");
});

test("a label never throws on a row it cannot name", () => {
  assert.equal(Actions.envDisplay(healthy, { target: "php:7.4" }), "");
  assert.equal(Actions.envDisplay({}, caddy), "");
  assert.equal(Actions.envActionLabel("nonsense", "Caddy"), "Caddy");
  assert.equal(Actions.envDoneLabel("nonsense", "Caddy"), "Caddy");
  assert.equal(Actions.envDoneLabel("stop", ""), "stopped");
});

// ------------------------------------------------------------------ nav ----

const NO_SEARCH = { active: false, sites: [], services: [], env: [] };

test("the environment rows come first in the map, as they do on screen", () => {
  const rows = Actions.navRows(healthy,
    Model.visibleSites(healthy, NO_SEARCH, false),
    Model.visibleServices(healthy, NO_SEARCH),
    Model.visibleEnv(healthy, NO_SEARCH));
  const kinds = rows.map((r) => r.kind);
  const lastEnv = kinds.lastIndexOf("env");
  assert.ok(lastEnv >= 0, "env rows are in the map");
  assert.ok(kinds.slice(0, lastEnv + 1).every((k) => k === "env"),
    "nothing else appears before the last env row");
});

test("an environment row in the map carries the row Space will act on", () => {
  const rows = Actions.navRows(healthy, { serving: [], parked: [] }, { rows: [] },
    Model.visibleEnv(healthy, NO_SEARCH));
  for (const r of rows) {
    assert.equal(r.kind, "env");
    const target = Actions.navTarget(rows, r.key, 0);
    assert.equal(target.kind, "env");
    assert.ok(target.env, r.key);
    assert.ok(Actions.envArgv(healthy, target.env, target.action).length, r.key);
    assert.equal(target.service, null);
    assert.equal(target.site, null);
  }
});

test("no environment rows in the map when the section draws none", () => {
  for (const env of [{ rows: [] }, {}, null, undefined, [], "caddy",
                     { rows: [{ row: {} }] }, { rows: [{ row: { target: "nope" } }] }]) {
    const rows = Actions.navRows(healthy, { serving: [], parked: [] }, { rows: [] }, env);
    assert.deepEqual(rows, [], JSON.stringify(env));
  }
});

test("an unreachable panel has no environment rows to walk or search", () => {
  // envRows() would still synthesise a Caddy line out of an empty summary; the
  // panel draws no sections at all in that state, and the map must agree.
  const down = Model.unreachable("HubDev is not running");
  assert.deepEqual(Model.visibleEnv(down, NO_SEARCH).rows, []);
  assert.deepEqual(Model.searchResults(down, "caddy").env, []);
  assert.equal(Model.searchResults(down, "caddy").searched, 0);
});

// --------------------------------------------------------------- search ----
//
// The Environment section became the third searchable list once its rows grew
// buttons: a filter exists to reach the thing you want to press.

test("typing a name reaches the toggle", () => {
  const r = Model.searchResults(healthy, "caddy");
  assert.deepEqual(r.env.map((e) => e.row.label), ["Caddy"]);
});

test("a partial name finds every pool it could mean, running one first", () => {
  const r = Model.searchResults(healthy, "php");
  // Both match and score alike, so the tiebreak decides — and it is the same
  // tiebreak a site list uses: what is up sorts above what is not.
  assert.deepEqual(r.env.map((e) => e.row.label), ["PHP 8.4 (default)", "PHP 8.5"]);
  assert.equal(r.env[0].row.value, "FPM running");
});

test("a version alone is enough", () => {
  assert.deepEqual(Model.searchResults(healthy, "8.5").env.map((e) => e.row.target), ["php:8.5"]);
});

test("the target is the fallback, and a fallback match highlights nothing", () => {
  // "php:8.4" cannot match the label — there is no colon in "PHP 8.4 (default)"
  // — so it matches the target instead. The row appears and nothing lights up,
  // which is the honest signal: the highlight may only mark text on screen.
  const r = Model.searchResults(healthy, "php:8.4");
  assert.deepEqual(r.env.map((e) => e.row.target), ["php:8.4"]);
  assert.deepEqual(r.env[0].spans, []);
});

test("a match highlights the label the panel actually draws", () => {
  const hit = Model.searchResults(healthy, "caddy").env[0];
  assert.ok(hit.spans.length > 0);
  for (const [start, len] of hit.spans) {
    assert.ok(start >= 0 && start + len <= hit.row.label.length);
    assert.equal(hit.row.label.slice(start, start + len).toLowerCase(), "caddy".slice(0, len));
  }
});

test("a reading can never be found by typing", () => {
  // The rule that keeps this section honest under a query: what a filter
  // surfaces must be something you can act on. These have no target, so they
  // were never candidates — and the SAME `target` decides whether they draw a
  // button, so the two answers cannot drift apart.
  for (const q of ["dns", "docker", "node", "diagnostics", "hosts", "port", "passing"]) {
    const r = Model.searchResults(healthy, q);
    for (const hit of r.env)
      assert.ok(hit.row.target, `${q} surfaced a reading: ${hit.row.label}`);
  }
});

test("only toggleable rows count as searched", () => {
  const all = Model.envRows(healthy).length;
  const togglable = Model.envRows(healthy).filter((r) => r.target).length;
  assert.ok(togglable < all, "this fixture has readings too");
  const r = Model.searchResults(healthy, "z");
  assert.equal(r.searched, healthy.sites.total + healthy.services.total + togglable);
});

test("a matched environment row is still pressable from the keyboard", () => {
  // The whole point. Type three letters, arrow to the button, press it.
  const search = Model.searchResults(healthy, "caddy");
  const rows = Actions.navRows(healthy,
    Model.visibleSites(healthy, search, false),
    Model.visibleServices(healthy, search),
    Model.visibleEnv(healthy, search));
  const hit = rows.find((r) => r.key === "env:caddy");
  assert.ok(hit, "the matched row is in the map");
  const target = Actions.navTarget(rows, hit.key, 0);
  assert.equal(target.kind, "env");
  assert.deepEqual(Actions.envArgv(healthy, target.env, target.action), ["hubdev", "caddy:stop"]);
});

test("a query that matches nothing else still shows the section", () => {
  // `total` is what the panel reads to decide whether to say "Nothing matches",
  // so an env-only hit has to count or the row would be drawn under a line
  // saying it does not exist.
  const r = Model.searchResults(healthy, "caddy");
  assert.equal(r.sites.length + r.services.length, 0);
  assert.ok(r.total > 0);
  assert.equal(Model.visibleEnv(healthy, r).rows.length, 1);
});

test("clearing the query puts every row back, readings included", () => {
  const back = Model.visibleEnv(healthy, Model.searchResults(healthy, ""));
  assert.equal(back.searching, false);
  assert.equal(back.rows.length, Model.envRows(healthy).length);
  for (const r of back.rows) assert.deepEqual(r.spans, []);
});

test("searching environment never throws, whatever the summary", () => {
  for (const s of [Model.empty(), Model.unreachable("down"), {}, null, undefined,
                   { reachable: true }, { reachable: true, php: null, caddy: null }]) {
    for (const q of ["caddy", "php", "8.4", "", "  ", "zzz"]) {
      const r = Model.searchResults(s, q);
      assert.ok(Array.isArray(r.env));
      assert.deepEqual(Model.visibleEnv(s, r).rows.filter((x) => !x.row), []);
    }
  }
});
