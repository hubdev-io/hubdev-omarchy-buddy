// Actions.js — the argv allowlist.
//
// This is the file where a mistake is not a cosmetic bug: it decides what the
// shell is allowed to execute. So the tests are written against the argv
// itself, element by element, rather than against a "does it look right"
// summary — the array asserted here is the array bash receives.

import { test } from "node:test";
import assert from "node:assert/strict";
import { load, fixture } from "./harness.mjs";

const Actions = load("Actions.js");
const Model = load("Model.js");

const summary = Model.summarize(fixture("healthy"));
const site = summary.sites.rows[0];

test("the allowlist is exactly the three detached verbs", () => {
  assert.deepEqual(
    Actions.siteActions().map((a) => a.key),
    ["terminal", "folder", "editor"]
  );
});

test("every action carries an icon name and a label for the row to draw", () => {
  for (const action of Actions.siteActions()) {
    assert.equal(typeof action.icon, "string");
    assert.ok(action.icon.length > 0, `${action.key} has no icon`);
    assert.ok(action.label.length > 0, `${action.key} has no label`);
    // Icon NAMES, never codepoints — Theme.js owns glyphs, and a codepoint
    // leaking in here is how the two drift apart.
    assert.match(action.icon, /^[a-z-]+$/);
  }
});

test("the view never receives the argv, and cannot mutate the table", () => {
  const rows = Actions.siteActions();
  for (const row of rows) assert.equal(row.args, undefined);

  rows[0].key = "mutated";
  rows.push({ key: "injected" });
  assert.deepEqual(
    Actions.siteActions().map((a) => a.key),
    ["terminal", "folder", "editor"]
  );
});

// --------------------------------------------------------------------- argv --

test("each key produces its exact command line", () => {
  assert.deepEqual(Actions.siteArgv(summary, site, "terminal"), [
    "/usr/bin/hubdev",
    "site:terminal",
    site.name
  ]);
  assert.deepEqual(Actions.siteArgv(summary, site, "folder"), [
    "/usr/bin/hubdev",
    "folder",
    site.name
  ]);
  // --ide= is load-bearing, not a preference: without it `hubdev edit` picks up
  // $EDITOR, which on Omarchy is `omarchy-launch-editor --inline` — an editor
  // that wants the terminal a bar widget does not have, and opens no window at
  // all. See the comment on the action itself.
  assert.deepEqual(Actions.siteArgv(summary, site, "editor"), [
    "/usr/bin/hubdev",
    "edit",
    "--ide=omarchy-launch-editor",
    site.name
  ]);
});

test("the site reference is always the last element", () => {
  for (const action of Actions.siteActions()) {
    const argv = Actions.siteArgv(summary, site, action.key);
    assert.equal(argv[argv.length - 1], site.name);
    assert.equal(argv[0], "/usr/bin/hubdev");
  }
});

test("every site in every fixture resolves to a runnable argv", () => {
  for (const name of ["healthy", "all-stopped", "caddy-down", "docker-down"]) {
    const s = Model.summarize(fixture(name));
    for (const row of s.sites.rows) {
      const argv = Actions.siteArgv(s, row, "terminal");
      assert.equal(argv.length, 3, `${name}/${row.domain} produced no argv`);
    }
  }
});

// ---------------------------------------------------------------- refusals --

test("an unknown verb runs nothing", () => {
  for (const key of ["", "logs", "site:fix", "artisan", null, undefined, 0]) {
    assert.deepEqual(Actions.siteArgv(summary, site, key), []);
  }
});

test("a site the snapshot does not list runs nothing", () => {
  // The stale-panel case: the row still exists in a view built from an older
  // poll, the site has since been unlinked.
  const gone = { name: "unlinked-site", domain: "unlinked.test" };
  assert.deepEqual(Actions.siteArgv(summary, gone, "terminal"), []);
  assert.deepEqual(Actions.siteArgv(Model.empty(), site, "terminal"), []);
  assert.deepEqual(Actions.siteArgv({}, site, "terminal"), []);
  assert.deepEqual(Actions.siteArgv(null, site, "terminal"), []);
});

test("nothing that could be read as a flag can become the site argument", () => {
  // Util.execArgv makes shell injection impossible, but `hubdev` parses its
  // OWN flags out of the argv it is handed. A site called `--print` is the
  // whole reason siteRef requires a leading alphanumeric.
  for (const name of ["--print", "-q", "--ide=/bin/sh", "-rf"]) {
    assert.equal(Actions.siteRef({ name, domain: "" }), "");
  }
});

test("nothing that could be read as a path can become the site argument", () => {
  // `hubdev folder <arg>` falls back to treating the argument as a path when
  // it matches no site, so a reference must never look like one.
  for (const name of ["../../etc", "~/secrets", "/etc/passwd", "./x", ".env"]) {
    assert.equal(Actions.siteRef({ name, domain: "" }), "");
  }
});

test("shell metacharacters never survive into a reference", () => {
  for (const name of [
    "site; rm -rf /",
    "site && curl evil",
    "site$(whoami)",
    "site`id`",
    "site|tee",
    "site\nnewline",
    "site with space",
    "site'quote",
    'site"quote'
  ]) {
    assert.equal(Actions.siteRef({ name, domain: "" }), "");
    assert.deepEqual(Actions.siteArgv(summary, { name }, "terminal"), []);
  }
});

test("an over-long reference is refused rather than truncated", () => {
  assert.equal(Actions.siteRef({ name: "a".repeat(128) }), "a".repeat(128));
  assert.equal(Actions.siteRef({ name: "a".repeat(129) }), "");
});

test("a garbage site object runs nothing", () => {
  for (const bad of [null, undefined, {}, [], "site", 42, { name: 42 }]) {
    assert.deepEqual(Actions.siteArgv(summary, bad, "terminal"), []);
  }
});

// ------------------------------------------------------------------- refs --

test("the name is preferred, because that is what site:list prints", () => {
  assert.equal(Actions.siteRef({ name: "shop", domain: "shop.test" }), "shop");
});

test("the domain is the fallback when the name is unusable", () => {
  // HubDev matches either (cli_site_open.go: matchSiteByLabel), so a site
  // whose name cannot go on a command line is still reachable by domain.
  assert.equal(Actions.siteRef({ name: "--print", domain: "shop.test" }), "shop.test");
  assert.equal(Actions.siteRef({ name: "", domain: "shop.test" }), "shop.test");
});

test("a site with neither a usable name nor a usable domain is inert", () => {
  assert.equal(Actions.siteRef({ name: "-x", domain: "-y" }), "");
});

// ---------------------------------------------------------------- privacy --

test("no argv ever carries anything but the binary, the verb and the label", () => {
  // R6: paths, keys and passwords are not ours to put on a command line. The
  // site reference is a label HubDev resolves to a path on its own side, and
  // Model.js does not even carry `path` into the summary.
  for (const name of ["healthy", "license-inactive"]) {
    const s = Model.summarize(fixture(name));
    for (const row of s.sites.rows) {
      for (const action of Actions.siteActions()) {
        const argv = Actions.siteArgv(s, row, action.key);
        // Element 0 is the pinned binary and is the only path allowed here.
        for (const arg of argv.slice(1)) {
          assert.doesNotMatch(arg, /\//, `"${arg}" looks like a path`);
        }
      }
    }
  }
});
