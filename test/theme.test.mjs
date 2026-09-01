import { test } from "node:test";
import assert from "node:assert/strict";
import { load, fixture } from "./harness.mjs";

const Theme = load("Theme.js");
const Model = load("Model.js");

test("every level maps to a colour and a glyph", () => {
  for (const level of ["ok", "warn", "down"]) {
    assert.match(Theme.colorFor(level), /^#[0-9A-Fa-f]{6}$/);
    assert.ok(Theme.glyphFor(level).length > 0);
  }
});

test("an unknown level degrades to idle rather than to nothing", () => {
  assert.equal(Theme.colorFor("nonsense"), Theme.COLOR.idle);
  assert.equal(Theme.colorFor(undefined), Theme.COLOR.idle);
  assert.equal(Theme.glyphFor(""), Theme.GLYPH.idle);
});

test("the dot appears only when something is wrong", () => {
  assert.equal(Theme.dotVisible("ok"), false);
  assert.equal(Theme.dotVisible("warn"), true);
  assert.equal(Theme.dotVisible("down"), true);
});

test("state is distinguishable without colour", () => {
  // Plan §5.3.1 / G7: this machine's theme is amber on navy, so `warn` sits
  // next to the bar foreground. Colour must never be the only carrier.
  const glyphs = ["ok", "warn", "down", "idle"].map((l) => Theme.glyphFor(l));
  assert.equal(new Set(glyphs).size, glyphs.length, "two states share a glyph");
});

test("state colours are distinct from each other", () => {
  const colors = ["ok", "warn", "down"].map((l) => Theme.colorFor(l));
  assert.equal(new Set(colors).size, colors.length);
});

test("a healthy environment draws no dot; a broken one does", () => {
  assert.equal(Theme.dotVisible(Model.summarize(fixture("healthy")).level), false);
  assert.equal(Theme.dotVisible(Model.summarize(fixture("caddy-down")).level), true);
  assert.equal(Theme.dotVisible(Model.summarize(fixture("autostart-service-stopped")).level), true);
});

test("every icon resolves to a real glyph, never to empty", () => {
  for (const name of ["view-dense", "view-columns", "external-link", "refresh",
                      "caret-down", "caret-right", "spinner", "lock"]) {
    assert.notEqual(Theme.icon(name), "", `${name} is missing`);
  }
  assert.equal(Theme.icon("no-such-icon"), "");
});

test("an unknown site driver still draws a glyph", () => {
  assert.notEqual(Theme.driverGlyph("laravel"), "");
  assert.equal(Theme.driverGlyph("something-hubdev-adds-in-2027"),
    Theme.driverGlyph("generic"),
    "a driver we have never heard of must not render an invisible row");
});

test("stopped-on-purpose services are idle, not warnings", () => {
  assert.equal(Theme.serviceLevel({ up: true, broken: false }), "ok");
  assert.equal(Theme.serviceLevel({ up: false, broken: true }), "down");
  assert.equal(Theme.serviceLevel({ up: false, broken: false }), "idle",
    "six amber rows for services nobody asked to run is an unreadable panel");
});


test("a parked site is idle; an intended-but-unreachable one is down", () => {
  assert.equal(Theme.siteLevel({ active: true, serving: true }), "ok");
  assert.equal(Theme.siteLevel({ active: true, serving: false }), "down");
  assert.equal(Theme.siteLevel({ active: false, serving: false }), "idle");
});
