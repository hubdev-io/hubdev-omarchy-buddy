// The one action the panel can offer when there is no snapshot: replacing the
// footer's Refresh with "Update HubDev" while the CLI is too old to answer.
//
// Two things are worth holding here, and they are different in kind. The first
// is the argv, asserted element by element like every other action — this one
// reaches a terminal that will escalate, so "a fixed array, never a string"
// matters more here than anywhere else in the plugin. The second is the GATE:
// the offer must appear for exactly one cause and no other, because "HubDev is
// broken somehow" is not a thing an update fixes, and a button that promises it
// would be guessing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { load, fixture } from "./harness.mjs";

const Actions = load("Actions.js");
const Model = load("Model.js");
const Source = load("SourceJson.js");
const Theme = load("Theme.js");

// The refusal a real v1.28.0 prints: the usage screen, on stdout, exit 1.
const OLD_HUBDEV_STDOUT = [
  "Unknown command: snapshot",
  "",
  "HubDev v1.28.0 — Hybrid Development Environment Manager",
  "",
  "Usage: hubdev [global flags] <command> [arguments]"
].join("\n");

// ------------------------------------------------------ the refusal code --

test("a hubdev too old to know the verb is reported as outdated", () => {
  const r = Source.parse(OLD_HUBDEV_STDOUT, 1);
  assert.equal(r.ok, false);
  assert.equal(r.code, "outdated");
});

test("a hubdev that accepts the verb but prints a table is outdated too", () => {
  // Exit 0, non-JSON. Same conclusion as the usage screen, and the same code:
  // both mean "this CLI predates the contract", which is one situation.
  const r = Source.parse("NAME     STATUS\nmysql    running\n", 0);
  assert.equal(r.ok, false);
  assert.equal(r.code, "outdated");
});

test("a hubdev that is not installed is missing, not outdated", () => {
  // The distinction the whole feature rests on: nothing to update.
  for (const exit of [127, -1, -2]) {
    const r = Source.parse("", exit);
    assert.equal(r.code, "missing", `exit ${exit}`);
    assert.notEqual(r.code, "outdated", `exit ${exit}`);
  }
});

test("every other refusal carries a code, and it is never outdated", () => {
  const cases = [
    Source.parse("", 0),                      // answered nothing
    Source.parse("boom", 3),                  // exited nonzero, no usage screen
    Source.parse("[1,2,3]", 0),               // JSON, but not a document
    Source.parse("null", 0)
  ];
  for (const r of cases) {
    assert.equal(r.ok, false);
    assert.equal(typeof r.code, "string");
    assert.notEqual(r.code, "");
    assert.notEqual(r.code, "outdated");
  }
});

test("a good snapshot carries no refusal at all", () => {
  const r = Source.parse(JSON.stringify(fixture("healthy")), 0);
  assert.equal(r.ok, true);
  assert.equal(r.code, undefined);
});

// --------------------------------------------------------- the model flag --

test("unreachable carries outdated only when told it is", () => {
  assert.equal(Model.unreachable("too old", "outdated").outdated, true);
  assert.equal(Model.unreachable("gone", "missing").outdated, false);
  assert.equal(Model.unreachable("who knows").outdated, false);
});

test("the flag exists on every summary, so no view reads undefined", () => {
  assert.equal(Model.empty().outdated, false);
  assert.equal(Model.summarize(fixture("healthy")).outdated, false);
});

test("a reachable HubDev is never outdated, whatever else is wrong with it", () => {
  // A schema from the future is a refusal too, and it is one an update of
  // HUBDEV cannot fix — it is the widget that is behind.
  const future = Model.summarize({ schema: 99, hubdev: { version: "9.0.0" } });
  assert.equal(future.reachable, false);
  assert.equal(future.outdated, false);
});

// ----------------------------------------------------------------- argv --

test("an outdated HubDev is offered an update, as a fixed argv", () => {
  const s = Model.unreachable("This HubDev is too old", "outdated");
  assert.deepEqual(Actions.updateArgv(s), ["omarchy-launch-tui", "hubdev", "update"]);
});

test("the update runs in a terminal, and asks the desktop which one", () => {
  // Not a hard-coded terminal, the same way the browser action is not a
  // hard-coded browser. If this assertion is edited to name alacritty, the
  // reason it was written has been lost.
  const argv = Actions.updateArgv(Model.unreachable("old", "outdated"));
  assert.equal(argv[0], "omarchy-launch-tui");
  assert.equal(argv[1], "hubdev");
  assert.equal(argv[2], "update");
  assert.equal(argv.length, 3);
});

test("nothing is offered when HubDev is merely unreachable", () => {
  assert.deepEqual(Actions.updateArgv(Model.unreachable("HubDev is not installed", "missing")), []);
  assert.deepEqual(Actions.updateArgv(Model.unreachable("HubDev did not answer in time")), []);
  assert.deepEqual(Actions.updateArgv(Model.unreachable("HubDev returned nothing", "error")), []);
});

test("nothing is offered when HubDev is answering perfectly well", () => {
  for (const name of ["healthy", "all-stopped", "caddy-down", "stopped-by-hubdev"]) {
    assert.deepEqual(Actions.updateArgv(Model.summarize(fixture(name))), [], name);
  }
});

test("garbage in the summary slot refuses rather than throws", () => {
  for (const bad of [null, undefined, "", "outdated", 0, 1, [], [1], { outdated: "yes" },
                     { outdated: 1 }, { outdated: null }, Object.create(null)]) {
    assert.deepEqual(Actions.updateArgv(bad), [], JSON.stringify(bad) || String(bad));
  }
});

test("each call gets its own array, so a caller cannot poison the next one", () => {
  const s = Model.unreachable("old", "outdated");
  const first = Actions.updateArgv(s);
  first.push("--force");
  first[0] = "rm";
  assert.deepEqual(Actions.updateArgv(s), ["omarchy-launch-tui", "hubdev", "update"]);
});

test("no element could be read as a flag, a path or a shell fragment", () => {
  // Util.execArgv hands bash positional parameters, so nothing here can be
  // re-tokenised — but `hubdev` and `omarchy-launch-tui` parse their own
  // argv, and this array is constant, so the property is cheap to just hold.
  for (const a of Actions.updateArgv(Model.unreachable("old", "outdated"))) {
    assert.equal(typeof a, "string");
    assert.match(a, /^[A-Za-z][A-Za-z0-9-]*$/, a);
  }
});

// ---------------------------------------------------------------- the icon --

test("the update icon resolves to a real glyph", () => {
  const g = Theme.icon("update");
  assert.notEqual(g, "");
  assert.equal([...g].length, 1);
  // Private Use Area — where every Nerd Font glyph lives. A plain ASCII
  // character here would mean a codepoint got mangled in an edit.
  const cp = g.codePointAt(0);
  assert.ok(cp >= 0xe000 && cp <= 0xf8ff, `U+${cp.toString(16).toUpperCase()} is not in the PUA`);
});

test("update and refresh are different glyphs", () => {
  // They are the two states of one button; if they rendered the same, the
  // swap would be invisible and the label would be doing all the work.
  assert.notEqual(Theme.icon("update"), Theme.icon("refresh"));
});
