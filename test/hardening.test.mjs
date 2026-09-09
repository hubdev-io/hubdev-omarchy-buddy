import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { load, fixture } from "./harness.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const Model = load("Model.js");

// The properties in this file are the ones the Omarchy marketplace review reads
// the tree for. They are held as tests rather than as care, because every one of
// them is a thing a future edit could quietly undo: a `Text` added without a
// format, a cap removed as noise, a binary un-pinned to make a dev build easier.

// ------------------------------------------------------------ QML sinks ----

function qmlFiles() {
  return readdirSync(ROOT).filter((f) => f.endsWith(".qml"));
}

test("every Text in the tree names its textFormat", () => {
  // Qt's default is Text.AutoText: a string that looks like markup is rendered
  // as markup, and `<img src="http://…">` inside it becomes a real request made
  // by the shell process. Nothing this plugin draws is allowed to decide that
  // by sniffing.
  for (const file of qmlFiles()) {
    const src = readFileSync(join(ROOT, file), "utf8");
    for (const m of src.matchAll(/\b(Text|Label|TextEdit|StyledText)\s*\{/g)) {
      let i = m.index + m[0].length;
      let depth = 1;
      while (i < src.length && depth > 0) {
        if (src[i] === "{") depth++;
        else if (src[i] === "}") depth--;
        i++;
      }
      const body = src.slice(m.index + m[0].length, i);
      const line = src.slice(0, m.index).split("\n").length;
      assert.ok(body.includes("textFormat:"), `${file}:${line} has no textFormat`);
    }
  }
});

test("no StdioCollector anywhere: child output is bounded while it arrives", () => {
  // A collector retains the child's whole stdout before any length check can
  // run, inside the one process that draws the desktop. SplitParser with an
  // empty marker delivers chunks, so the budget is enforced mid-flight.
  for (const file of qmlFiles()) {
    const src = readFileSync(join(ROOT, file), "utf8");
    const code = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!code.includes("StdioCollector"), `${file} collects unbounded output`);
  }
});

// --------------------------------------------------------- the binary ----

test("hubdev is invoked by absolute path, never by name", () => {
  const Source = load("SourceJson.js");
  const Actions = load("Actions.js");
  assert.equal(Source.BIN, "/usr/bin/hubdev");
  assert.equal(Actions.BIN, "/usr/bin/hubdev");
  for (const file of qmlFiles()) {
    const code = readFileSync(join(ROOT, file), "utf8")
      .replace(/\/\/[^\n]*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(code, /"hubdev"/, `${file} names hubdev without a path`);
    assert.doesNotMatch(code, /\.run\(/, `${file} builds a shell command string`);
  }
});

// -------------------------------------------------------------- bounds ----

test("a string from the snapshot cannot be longer than the cap", () => {
  const long = "x".repeat(9000);
  const s = Model.summarize({ schema: 1, sites: [{ name: long, domain: "a.test" }] });
  for (const row of s.sites.rows) {
    for (const v of Object.values(row)) {
      if (typeof v === "string") assert.ok(v.length <= 600, `a ${v.length}-char field survived`);
    }
  }
});

test("a snapshot with more rows than the cap is truncated, not rendered", () => {
  const sites = [];
  for (let i = 0; i < 5000; i++) sites.push({ name: "s" + i, domain: "s" + i + ".test" });
  const s = Model.summarize({ schema: 1, sites });
  assert.ok(s.sites.rows.length <= 512, `${s.sites.rows.length} rows reached the view`);
});

test("markup in a site name cannot reach the bar tooltip", () => {
  // The bar tooltip is drawn by the shell's own BarIconButton, which the plugin
  // cannot pin to PlainText — so the markup characters are removed from the
  // string instead. This is the one sink where that is the mechanism.
  const evil = '<img src="http://127.0.0.1:9/x.png">';
  const s = Model.summarize({
    schema: 1,
    caddy: { running: false },
    sites: [{ name: evil, domain: "a.test", active: true, driver: "php" }]
  });
  const tip = Model.tooltip(s);
  assert.doesNotMatch(tip, /[<>&]/, tip);
});

test("plain() removes control and bidi characters as well as markup", () => {
  const dirty = "a\u0007b\u001bc\u202ed<e>f&g";
  const clean = Model.plain(dirty);
  assert.doesNotMatch(clean, /[<>&]/);
  assert.doesNotMatch(clean, /[\u0000-\u001f\u007f-\u009f\u202a-\u202e]/);
  assert.ok(clean.includes("a"));
});

test("plain() caps its output and says it did", () => {
  const out = Model.plain("y".repeat(5000), 64);
  assert.equal(out.length, 64);
  assert.ok(out.endsWith("…"));
});

test("a tooltip built from a real fixture is unchanged by the stripper", () => {
  // The guard must not be visible in ordinary use: nothing HubDev legitimately
  // prints contains the three characters, so no fixture may lose a byte here.
  for (const name of ["healthy", "caddy-down", "docker-down", "all-stopped"]) {
    const tip = Model.tooltip(Model.summarize(fixture(name)));
    assert.equal(tip, Model.plain(tip, 2048));
  }
});
