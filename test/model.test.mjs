import { test } from "node:test";
import assert from "node:assert/strict";
import { load, fixture, fixtureNames, renderedStrings } from "./harness.mjs";

const Model = load("Model.js");

// --------------------------------------------------------------- shape ----

test("every fixture reduces to the complete shape", () => {
  for (const name of fixtureNames()) {
    const s = Model.summarize(fixture(name));
    for (const key of ["reachable", "version", "level", "sites", "services", "php",
                       "caddy", "docker", "env", "issues", "resources",
                       "tunnels", "backups", "license"]) {
      assert.ok(key in s, `${name}: missing ${key}`);
    }
    assert.ok(["ok", "warn", "down"].includes(s.level), `${name}: bad level ${s.level}`);
    assert.ok(Array.isArray(s.issues), `${name}: issues must be an array`);
    assert.ok(Array.isArray(s.sites.rows) && Array.isArray(s.services.rows));
  }
});

test("empty() and unreachable() have the same keys as a real summary", () => {
  const real = Object.keys(Model.summarize(fixture("healthy"))).sort();
  assert.deepEqual(Object.keys(Model.empty()).sort(), real);
  assert.deepEqual(Object.keys(Model.unreachable("x")).sort(), real);
});

test("garbage input never throws and never claims reachable", () => {
  for (const bad of [null, undefined, 0, "", [], "nope", { schema: "1" }, { schema: 0 }]) {
    const s = Model.summarize(bad);
    assert.equal(s.reachable, false);
    assert.equal(s.level, "down");
    assert.equal(s.issues.length, 1);
  }
});

// --------------------------------------------------------------- level ----

test("healthy is quiet", () => {
  const s = Model.summarize(fixture("healthy"));
  assert.equal(s.level, "ok");
  assert.deepEqual(s.issues, []);
  assert.equal(s.sites.total, 15);
  assert.equal(s.sites.active, 14);      // invoice-app is parked in every fixture
  assert.equal(s.services.total, 8);
  assert.equal(s.services.up, 5);
  assert.equal(s.php.default, "8.4");
});

test("a stopped Caddy is red, not yellow", () => {
  const s = Model.summarize(fixture("caddy-down"));
  assert.equal(s.level, "down");
  assert.match(s.issues[0], /Caddy is stopped/);
});

test("a stopped default PHP-FPM is red", () => {
  const s = Model.summarize(fixture("php-default-fpm-down"));
  assert.equal(s.level, "down");
  assert.ok(s.issues.some((i) => /PHP 8\.4 FPM is stopped/.test(i)));
});

test("a non-default PHP with FPM down is NOT a fault", () => {
  // healthy.json really has PHP 8.5 present with FPM not installed.
  const s = Model.summarize(fixture("healthy"));
  assert.ok(s.php.rows.some((p) => !p.isDefault && !p.fpmRunning));
  assert.equal(s.level, "ok");
});

test("an installed auto-start service that is stopped is yellow", () => {
  const s = Model.summarize(fixture("autostart-service-stopped"));
  assert.equal(s.level, "warn");
  assert.ok(s.issues.some((i) => /Redis is set to start automatically but is stopped/.test(i)));
});

test("an UNINSTALLED auto-start service never warns", () => {
  // reverb ships auto_start:true, installed:false on the dev machine. Warning
  // about it would be a permanent false positive the user cannot clear.
  const s = Model.summarize(fixture("healthy"));
  const reverb = s.services.rows.find((r) => r.name === "reverb");
  assert.equal(reverb.autoStart, true);
  assert.equal(reverb.installed, false);
  assert.equal(reverb.up, false);
  assert.equal(reverb.broken, false);
  assert.equal(s.level, "ok");
});

test("docker down warns only because installed docker-mode services need it", () => {
  const s = Model.summarize(fixture("docker-down"));
  assert.equal(s.docker.available, false);
  assert.ok(s.issues.some((i) => /Docker is unavailable and \d+ services need it/.test(i)));
});

test("an inactive license is yellow; an absent license block is not", () => {
  assert.equal(Model.summarize(fixture("license-inactive")).level, "warn");
  assert.ok(Model.summarize(fixture("license-inactive")).issues.some((i) => /license is expired/.test(i)));
  assert.equal(Model.summarize(fixture("minimal")).license.status, "");
  assert.deepEqual(Model.summarize(fixture("minimal")).issues, []);
});

test("all-stopped is red and reports each fault once", () => {
  const s = Model.summarize(fixture("all-stopped"));
  assert.equal(s.level, "down");
  // 15 routeless sites must NOT produce 15 issues — a stopped Caddy explains
  // them all, and is already the first issue.
  assert.ok(s.issues.length <= 5, `too many issues: ${JSON.stringify(s.issues, null, 2)}`);
  assert.equal(s.issues.filter((i) => /Caddy route/.test(i)).length, 0);
});

test("no sites is a valid healthy state, not an error", () => {
  const s = Model.summarize(fixture("no-sites"));
  assert.equal(s.level, "ok");
  assert.equal(s.sites.total, 0);
  assert.deepEqual(s.sites.rows, []);
});

// ------------------------------------------------------- schema gating ----

test("a newer schema is refused by name, not mis-rendered", () => {
  const s = Model.summarize(fixture("schema-future"));
  assert.equal(s.reachable, false);
  assert.match(s.issues[0], /schema 2.*understands 1/);
});

test("a minimal snapshot missing every optional block still summarises", () => {
  const s = Model.summarize(fixture("minimal"));
  assert.equal(s.reachable, true);
  assert.equal(s.level, "ok");
  assert.deepEqual(s.tunnels, []);
  assert.deepEqual(s.env.flags, []);
  assert.equal(s.docker.available, false);
});

test("null collections are treated as empty (the CLI really emits null)", () => {
  const s = Model.summarize({ ...fixture("healthy"), tunnels: null, sites: null, services: null });
  assert.deepEqual(s.tunnels, []);
  assert.equal(s.sites.total, 0);
  assert.equal(s.services.total, 0);
});

// ------------------------------------------------------------- details ----

test("route_present absent means unknown, not missing", () => {
  const snap = fixture("healthy");
  delete snap.sites[0].route_present;
  const s = Model.summarize(snap);
  assert.equal(s.sites.rows[0].routePresent, true);
  assert.equal(s.level, "ok");
});

test("a routeless active site warns only while Caddy is up", () => {
  const snap = fixture("healthy");
  snap.sites[0].route_present = false;
  const s = Model.summarize(snap);
  assert.equal(s.level, "warn");
  assert.ok(s.issues.some((i) => /has no Caddy route/.test(i)));
});

test("a certificate inside 14 days warns; outside it does not", () => {
  const near = fixture("healthy");
  near.sites[0].tls_expires_in_days = 3;
  assert.equal(Model.summarize(near).level, "warn");

  const far = fixture("healthy");
  far.sites[0].tls_expires_in_days = 90;
  assert.equal(Model.summarize(far).level, "ok");
});

test("site urls follow tls", () => {
  const s = Model.summarize(fixture("healthy"));
  assert.equal(s.sites.rows[0].url, `https://${s.sites.rows[0].domain}`);
  const snap = fixture("healthy");
  snap.sites[0].tls = false;
  assert.equal(Model.summarize(snap).sites.rows[0].url, `http://${snap.sites[0].domain}`);
});

test("the resource strip is hidden unless containers are actually running", () => {
  assert.equal(Model.summarize(fixture("healthy")).resources.shown, true);
  assert.equal(Model.summarize(fixture("docker-down")).resources.shown, false);
  assert.equal(Model.summarize(fixture("minimal")).resources.shown, false);
});

test("issue text is plain language, not identifiers", () => {
  for (const name of fixtureNames()) {
    for (const issue of Model.summarize(fixture(name)).issues) {
      assert.ok(/^[A-Z]/.test(issue), `${name}: issue should read as a sentence: ${issue}`);
      assert.ok(!/[_:]|--/.test(issue), `${name}: issue leaks an identifier: ${issue}`);
    }
  }
});

// ------------------------------------------------------------- tooltip ----

test("a healthy tooltip says nothing is wrong by saying nothing more", () => {
  const t = Model.tooltip(Model.summarize(fixture("healthy")));
  const lines = t.split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0], /Sites 14\/15/);
  assert.match(lines[0], /Services 5\/8/);
  assert.match(lines[1], /PHP 8\.4 \(default\)/);
  assert.match(lines[1], /Caddy 2\.11\.4/);
});

test("a faulty tooltip lists every issue as a bullet", () => {
  const s = Model.summarize(fixture("all-stopped"));
  const t = Model.tooltip(s);
  for (const issue of s.issues) assert.ok(t.includes(`• ${issue}`));
});

test("an unreachable tooltip is the reason itself", () => {
  assert.equal(Model.tooltip(Model.unreachable("HubDev is not installed")), "HubDev is not installed");
});

// ------------------------------------------------------ R6 secret sweep ----

test("no summary can carry a password, key or token", () => {
  // The snapshot contract strips these, but the widget must not reintroduce
  // them by copying an unknown field through. Feed the forbidden keys in and
  // assert none of them reach anything a view could render.
  const poisoned = fixture("healthy");
  poisoned.services = poisoned.services.map((s) => ({
    ...s,
    password: "hunter2-SHOULD-NOT-APPEAR",
    token: "tok-SHOULD-NOT-APPEAR"
  }));
  poisoned.license = { plan: "pro", status: "active", key: "LIC-SHOULD-NOT-APPEAR" };

  const rendered = renderedStrings(Model.summarize(poisoned)).join(" ");
  assert.ok(!rendered.includes("SHOULD-NOT-APPEAR"), "a secret reached the summary");
});

test("fixtures themselves carry no secrets", () => {
  for (const name of fixtureNames()) {
    const raw = JSON.stringify(fixture(name));
    assert.ok(!/"password"|"secret"|"api_key"|"license_key"/.test(raw), `${name} carries a secret-shaped key`);
  }
});
