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

// ------------------------------------------------- partial-tier merging ----
//
// These exist because Phase 1 landed and made the two tiers real. Until
// `hubdev snapshot --json --include=` existed, every reply was complete and
// nothing here could go wrong.

test("a cheap-tier reply does not blank the sections it did not ask for", () => {
  const full = fixture("healthy");
  // Exactly what `--include=caddy,php,sites` returns: the envelope plus three
  // sections, with the rest ABSENT — not empty.
  const cheap = {
    schema: full.schema,
    hubdev: full.hubdev,
    generated_at: "2026-09-01T02:00:00Z",
    caddy: full.caddy,
    php: full.php,
    sites: full.sites
  };

  const naive = Model.summarize(cheap);
  assert.equal(naive.services.total, 0, "precondition: a partial reply on its own has no services");

  const merged = Model.summarize(Model.merge(full, cheap));
  assert.equal(merged.services.total, 8);
  assert.equal(merged.services.up, 5);
  assert.equal(merged.docker.available, true);
  assert.equal(merged.license.status, "active");
  assert.ok(merged.env.flags.length > 0, "health flags survived the cheap poll");
});

test("what the cheap tier does send wins over what was inherited", () => {
  const full = fixture("healthy");
  const cheap = {
    schema: 1,
    hubdev: full.hubdev,
    generated_at: "2026-09-01T02:00:00Z",
    caddy: { running: false, version: "2.11.4", mode: "native", routes: 0 },
    php: full.php,
    sites: full.sites
  };
  const merged = Model.summarize(Model.merge(full, cheap));
  assert.equal(merged.caddy.running, false, "a fresh section must replace, not merge into, the old one");
  assert.equal(merged.level, "down");
  assert.equal(merged.services.total, 8, "and the inherited sections are still there");
});

test("an empty section is a real answer and overwrites the inherited one", () => {
  // `[]` means the caller asked and there was nothing — the opposite of
  // absent. Inheriting over it would report sites that are gone.
  const merged = Model.merge(fixture("healthy"), { schema: 1, sites: [] });
  assert.deepEqual(merged.sites, []);
  assert.equal(Model.summarize(merged).sites.total, 0);
});

test("merging onto nothing is just the fresh document", () => {
  const full = fixture("healthy");
  assert.equal(Model.summarize(Model.merge({}, full)).level, "ok");
  assert.equal(Model.summarize(Model.merge(undefined, full)).sites.total, 15);
  assert.equal(Model.summarize(Model.merge(null, full)).services.total, 8);
});

test("merge never mutates either input", () => {
  const prev = fixture("healthy");
  const fresh = { schema: 1, caddy: { running: false } };
  const prevBefore = JSON.stringify(prev);
  const freshBefore = JSON.stringify(fresh);
  Model.merge(prev, fresh);
  assert.equal(JSON.stringify(prev), prevBefore);
  assert.equal(JSON.stringify(fresh), freshBefore);
});

// ------------------------------------------------- panel projections ----

test("sites split into serving and not, with the routeless surfaced first", () => {
  const s = Model.summarize(fixture("healthy"));
  const g = Model.siteGroups(s);

  assert.equal(g.active.length + g.inactive.length, s.sites.rows.length);
  assert.ok(g.active.every((r) => r.active));
  assert.ok(g.inactive.every((r) => !r.active));
  assert.equal(g.inactiveCount, g.inactive.length);

  // Within each group, domains read alphabetically — a panel is scanned, not
  // searched, so the order has to be the one the eye can binary-search.
  const domains = g.inactive.map((r) => r.domain);
  assert.deepEqual(domains, [...domains].sort());
});

test("a site that is active but unrouted sorts above every healthy one", () => {
  const doc = fixture("healthy");
  const victim = doc.sites.find((x) => x.active);
  victim.route_present = false;

  const g = Model.siteGroups(Model.summarize(doc));
  assert.equal(g.active[0].domain, victim.domain,
    "the row the panel exists to surface must not be buried at position 9 of 14");
});

test("services set up here are listed; ones never configured collapse", () => {
  const s = Model.summarize(fixture("healthy"));
  const g = Model.serviceGroups(s);

  assert.ok(g.installed.every((r) => r.installed));
  assert.ok(g.available.every((r) => !r.installed));
  assert.equal(g.availableCount, g.available.length);
  assert.equal(g.installed.length + g.available.length, s.services.rows.length);
});

test("a broken service sorts first, then running, then the rest", () => {
  const s = Model.summarize(fixture("autostart-service-stopped"));
  const g = Model.serviceGroups(s);
  const broken = g.installed.filter((r) => r.broken);

  assert.ok(broken.length > 0, "fixture precondition");
  assert.equal(g.installed[0].broken, true);
});

test("envRows always leads with Caddy and carries one row per PHP version", () => {
  const s = Model.summarize(fixture("healthy"));
  const rows = Model.envRows(s);

  assert.equal(rows[0].key, "caddy");
  assert.equal(rows[0].level, "ok");

  const php = rows.filter((r) => r.key.startsWith("php-"));
  assert.equal(php.length, s.php.rows.length);
  assert.ok(php.some((r) => r.label.includes("(default)")));

  // Every row is complete — the view never branches on undefined.
  for (const r of rows) {
    for (const key of ["key", "label", "value", "level"])
      assert.ok(key in r, `${r.key}: missing ${key}`);
  }
});

test("a non-default PHP with its pool down is a fact, not a fault", () => {
  const s = Model.summarize(fixture("healthy"));
  const rows = Model.envRows(s);
  const secondary = rows.find((r) => r.key.startsWith("php-") && !r.label.includes("(default)"));

  assert.ok(secondary, "fixture precondition: more than one PHP version");
  assert.ok(secondary.level !== "warn" && secondary.level !== "down",
    "this machine idles with 8.5 stopped; colouring it would cry wolf forever");
});

test("Caddy stopped reads as down in the panel, not merely as a value", () => {
  const rows = Model.envRows(Model.summarize(fixture("caddy-down")));
  assert.equal(rows[0].key, "caddy");
  assert.equal(rows[0].level, "down");
  assert.equal(rows[0].value, "stopped");
});

test("Docker missing is only a fault when a service actually needs it", () => {
  const withDocker = Model.envRows(Model.summarize(fixture("docker-down")))
    .find((r) => r.key === "docker");
  assert.equal(withDocker.level, "warn");

  const doc = fixture("docker-down");
  for (const svc of doc.services) svc.mode = "native";
  const withoutDocker = Model.envRows(Model.summarize(doc)).find((r) => r.key === "docker");
  assert.equal(withoutDocker.level, "idle",
    "a machine running everything natively must not be told Docker is down");
});

test("the diagnostics roll-up counts every check and takes the worst level", () => {
  const s = Model.summarize(fixture("healthy"));
  const d = Model.checksSummary(s);

  assert.equal(d.total, s.env.flags.length);
  assert.equal(d.ok, s.env.flags.filter((f) => f.level === "ok").length);
  assert.equal(d.level, s.env.flags.some((f) => f.level === "down") ? "down"
    : s.env.flags.some((f) => f.level !== "ok") ? "warn" : "ok");
  assert.match(d.label, /^\d+\/\d+ passing$/);
});

test("a snapshot with no health section produces no diagnostics row", () => {
  const s = Model.summarize(fixture("minimal"));
  assert.equal(Model.checksSummary(s).total, 0);
  assert.ok(!Model.envRows(s).some((r) => r.key === "diagnostics"));
});

test("check ids survive into the summary", () => {
  const s = Model.summarize(fixture("healthy"));
  assert.ok(s.env.flags.length > 0);
  assert.ok(s.env.flags.every((f) => typeof f.id === "string" && f.id.length > 0),
    "envRows groups on the id; dropping it makes the Environment section unbuildable");
});

test("panel projections never throw on the empty or unreachable shape", () => {
  for (const s of [Model.empty(), Model.unreachable("nope")]) {
    assert.doesNotThrow(() => Model.siteGroups(s));
    assert.doesNotThrow(() => Model.serviceGroups(s));
    assert.doesNotThrow(() => Model.envRows(s));
    assert.doesNotThrow(() => Model.checksSummary(s));
  }
});

test("only versions that are numbers get a v", () => {
  assert.equal(Model.versionLabel("8.0"), "v8.0");
  assert.equal(Model.versionLabel("16"), "v16");
  assert.equal(Model.versionLabel("latest"), "latest", "'vlatest' is not a version");
  assert.equal(Model.versionLabel("alpine"), "alpine");
  assert.equal(Model.versionLabel("2025-latest"), "v2025-latest");
  assert.equal(Model.versionLabel(""), "");
  assert.equal(Model.versionLabel(undefined), "");
});

test("with Caddy stopped no site is serving, even though route_present is absent", () => {
  const doc = fixture("caddy-down");
  assert.ok(doc.sites.every((s) => !("route_present" in s)),
    "the CLI omits route_present with Caddy down — the fixture must match it");

  const s = Model.summarize(doc);
  assert.ok(s.sites.rows.every((r) => r.routePresent),
    "absent is unknown, not missing — this is what stops 15 duplicate issues");
  assert.ok(s.sites.rows.every((r) => !r.serving),
    "...but unknown must not read as fine: nothing is reachable with no reverse proxy");

  // The issue is still raised exactly once, by Caddy, not once per site.
  assert.equal(s.issues.filter((i) => /Caddy route/.test(i)).length, 0);
  assert.equal(s.issues.filter((i) => /Caddy is stopped/.test(i)).length, 1);
});

test("a site is serving only when it is active, routed and Caddy is up", () => {
  const s = Model.summarize(fixture("healthy"));
  for (const r of s.sites.rows)
    assert.equal(r.serving, r.active && r.routePresent && s.caddy.running);
  assert.ok(s.sites.rows.some((r) => r.serving), "fixture precondition");
});

// ------------------------------------------------- environment ordering ----

test("DNS and the hosts file sit directly under Caddy, not below Docker", () => {
  const rows = Model.envRows(Model.summarize(fixture("healthy")));
  const at = (key) => rows.findIndex((r) => r.key === key);

  // Caddy, DNS, hosts file: one question — will a URL resolve — asked three
  // ways. Contiguity is the whole reason the order is worth a test.
  assert.equal(at("caddy"), 0);
  assert.equal(at("dns_test"), 1);
  assert.equal(at("hosts_file"), 2);

  assert.ok(at("docker") > at("hosts_file"));
  assert.ok(at("nodejs") > at("docker"), "Node belongs with the runtimes");
  assert.equal(rows[rows.length - 1].key, "diagnostics");
});

test("a promoted check is renamed for the panel but keeps its own words when it fails", () => {
  const doc = fixture("healthy");
  const dns = doc.health.checks.find((c) => c.id === "dns_test");
  assert.match(dns.label, /\(\.test\)/, "fixture precondition");

  const ok = Model.envRows(Model.summarize(doc)).find((r) => r.key === "dns_test");
  assert.equal(ok.label, "DNS", "the TLD names one of three on this machine");
  assert.equal(ok.value, "Port 80 listening");

  // The override is decoration over a green check. Over a red one it would be
  // a lie printed next to the dot that contradicts it.
  dns.level = "down";
  dns.detail = "Port 80 is not listening";
  const bad = Model.envRows(Model.summarize(doc)).find((r) => r.key === "dns_test");
  assert.equal(bad.label, "DNS");
  assert.equal(bad.value, "Port 80 is not listening");
  assert.equal(bad.level, "down");
});

test("a check the CLI did not send draws no row at all", () => {
  const doc = fixture("healthy");
  doc.health.checks = doc.health.checks.filter((c) => c.id !== "hosts_file");
  const rows = Model.envRows(Model.summarize(doc));

  assert.equal(rows.filter((r) => r.key === "hosts_file").length, 0);
  assert.equal(rows[1].key, "dns_test", "the rest of the block closes up");
});

// -------------------------------------------------------------- siteUrl ----

test("a site opens over the scheme it actually serves", () => {
  assert.equal(Model.siteUrl({ domain: "beacon.lab", tls: true }), "https://beacon.lab");
  assert.equal(Model.siteUrl({ domain: "beacon.lab", tls: false }), "http://beacon.lab");
  // Absent is not true: an unknown TLS state must not promise https.
  assert.equal(Model.siteUrl({ domain: "beacon.lab" }), "http://beacon.lab");
});

test("every site in every fixture yields a URL the browser can be handed", () => {
  for (const name of fixtureNames()) {
    for (const row of Model.summarize(fixture(name)).sites.rows) {
      const url = Model.siteUrl(row);
      assert.match(url, /^https?:\/\/[a-z0-9.-]+$/i, `${name}: ${row.domain} -> ${url}`);
    }
  }
});

test("a domain that is not a hostname opens nothing rather than something", () => {
  // The domain reaches a command line. It comes from HubDev's own config and
  // is very probably fine — but a row that silently does nothing is a far
  // smaller failure than a row that runs something.
  for (const domain of ["", "no-dot", "a b.test", "x.test; id", "$(id).test",
                        "-lead.test", "http://x.test", "x.test/../..",
                        "x".repeat(300) + ".test"]) {
    assert.equal(Model.siteUrl({ domain, tls: true }), "",
      `${JSON.stringify(domain)} must not become a URL`);
  }
  assert.equal(Model.siteUrl(null), "");
  assert.equal(Model.siteUrl({}), "");
});
