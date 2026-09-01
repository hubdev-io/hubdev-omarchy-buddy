.pragma library

// Reduces a `hubdev snapshot --json` envelope to the fixed shape the views bind
// to. Pure: no QML, no I/O, no Qt. `node --test` runs this exact file (see
// test/harness.mjs), so every rule worth getting wrong lives here rather than
// in a .qml where it cannot be tested.
//
// The shape is ALWAYS complete. Views never branch on undefined — an absent
// section is an empty one, and `level` is always one of ok/warn/down.

var SCHEMA = 1;

// Certificates inside this many days of expiry raise a warning.
var CERT_WARN_DAYS = 14;

// ---------------------------------------------------------------- shape ----

// The zero value. Every field the views touch exists here.
function empty() {
  return {
    reachable: false,
    version: "",
    updateAvailable: null,
    level: "down",
    sites: { total: 0, active: 0, rows: [] },
    services: { total: 0, up: 0, rows: [] },
    php: { default: "", rows: [] },
    caddy: { running: false, version: "", routes: 0 },
    docker: { available: false, running: 0, exited: 0, reclaimableLabel: "" },
    env: { flags: [] },
    tunnels: [],
    backups: { count: 0, sizeLabel: "", lastAt: null },
    license: { plan: "", status: "" },
    issues: [],
    resources: { shown: false }
  };
}

// The same shape, marked unreachable, carrying exactly one issue that says why.
// `reason` is shown to the user verbatim, so it must be plain language.
function unreachable(reason) {
  var s = empty();
  s.issues = [reason || "HubDev is not running"];
  return s;
}

// ------------------------------------------------------------- helpers ----

function arr(v) {
  // The CLI emits `null` for empty collections in at least one place
  // (`tunnels` — observed live via `hubdev mcp`), so null-vs-[] is not a
  // distinction worth trusting anywhere.
  return Array.isArray(v) ? v : [];
}

function obj(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

function num(v) {
  return typeof v === "number" && isFinite(v) ? v : 0;
}

function str(v) {
  return typeof v === "string" ? v : "";
}

// Bytes as something a bar panel can show. Deliberately coarse — this is a
// glance, and "1.2 GB" is as much precision as the question deserves.
function sizeLabel(bytes) {
  var b = num(bytes);
  if (b <= 0)
    return "";
  var units = ["B", "KB", "MB", "GB", "TB"];
  var i = 0;
  while (b >= 1024 && i < units.length - 1) {
    b /= 1024;
    i++;
  }
  return (b >= 10 || i === 0 ? Math.round(b) : Math.round(b * 10) / 10) + " " + units[i];
}

// Grammar that reads correctly at both 1 and n. Bar tooltips are prose.
function plural(n, one, many) {
  return n + " " + (n === 1 ? one : many);
}

function listNames(names, limit) {
  var cap = limit || 3;
  if (names.length <= cap)
    return names.join(", ");
  return names.slice(0, cap).join(", ") + " and " + (names.length - cap) + " more";
}

// --------------------------------------------------------------- merge ----

// Lay a partial snapshot over the last one.
//
// The cheap tier asks for `caddy,php,sites` and gets a document with no
// `services`, no `docker`, no `health`. Handing that straight to summarize()
// makes the tooltip say "Services 0/0" every five seconds while the panel is
// open, then "Services 5/8" again on the next full read — numbers that flicker
// between true and false are worse than numbers that lag.
//
// This works without a section list because the CLI contract makes an
// unrequested section ABSENT rather than empty (`hubdev snapshot` omits the
// key; a section that was requested and has nothing in it is `[]`). So the
// rule is exactly: a key that is present wins, a key that is missing is
// inherited. The envelope — schema, hubdev, generated_at — is on every reply,
// so it always reflects the newest read.
//
// What is inherited is stale by up to one full-tier interval (30s). That is
// the trade, and it is the right way round: the expensive sections are the
// slow-moving ones, and the sections that carry the states worth reacting to
// fast — Caddy, the default PHP FPM, the site list — are in the cheap tier and
// are never inherited.
function merge(prev, fresh) {
  var out = {};
  var k;
  if (prev && typeof prev === "object" && !Array.isArray(prev)) {
    for (k in prev) {
      if (prev.hasOwnProperty(k))
        out[k] = prev[k];
    }
  }
  if (fresh && typeof fresh === "object" && !Array.isArray(fresh)) {
    for (k in fresh) {
      if (fresh.hasOwnProperty(k) && fresh[k] !== undefined)
        out[k] = fresh[k];
    }
  }
  return out;
}

// -------------------------------------------------------------- reduce ----

function summarize(snapshot) {
  var snap = obj(snapshot);

  // Refuse a newer major outright rather than mis-rendering it. An older
  // snapshot is fine — the contract is additive within a schema version.
  var schema = num(snap.schema);
  if (schema > SCHEMA) {
    return unreachable("HubDev speaks snapshot schema " + schema + "; this widget understands " + SCHEMA + ". Update HubDev Buddy.");
  }
  if (schema < 1) {
    return unreachable("HubDev returned no usable snapshot");
  }

  var s = empty();
  var issues = [];

  s.reachable = true;

  var hubdev = obj(snap.hubdev);
  s.version = str(hubdev.version);
  s.updateAvailable = typeof hubdev.update_available === "string" ? hubdev.update_available : null;

  // ---- caddy -------------------------------------------------------------
  var caddy = obj(snap.caddy);
  s.caddy = {
    running: caddy.running === true,
    version: str(caddy.version),
    routes: num(caddy.routes)
  };
  if (!s.caddy.running)
    issues.push("Caddy is stopped — no site will resolve");

  // ---- php ---------------------------------------------------------------
  var phpRows = arr(snap.php).map(function (p) {
    return {
      version: str(p.version),
      isDefault: p.default === true,
      fpmRunning: p.fpm_running === true,
      xdebug: p.xdebug === true
    };
  });
  var defaultPhp = null;
  for (var i = 0; i < phpRows.length; i++) {
    if (phpRows[i].isDefault) {
      defaultPhp = phpRows[i];
      break;
    }
  }
  s.php = { default: defaultPhp ? defaultPhp.version : "", rows: phpRows };
  if (defaultPhp && !defaultPhp.fpmRunning)
    issues.push("PHP " + defaultPhp.version + " FPM is stopped — the default version cannot serve");

  // ---- docker ------------------------------------------------------------
  var docker = obj(snap.docker);
  var containers = obj(docker.containers);
  s.docker = {
    available: docker.available === true,
    running: num(containers.running),
    exited: num(containers.exited),
    reclaimableLabel: sizeLabel(docker.reclaimable_bytes)
  };

  // ---- services ----------------------------------------------------------
  var svcRows = arr(snap.services).map(function (v) {
    var up = v.status === "running";
    var installed = v.installed === true;
    var autoStart = v.auto_start === true;
    return {
      name: str(v.name),
      display: str(v.display) || str(v.name),
      up: up,
      // `broken` is the only thing that earns a warning: a service the user
      // installed AND asked to start automatically, which is not running.
      // An uninstalled service with auto_start would otherwise warn forever
      // about something the user never set up — observed on this machine,
      // where `reverb` ships auto_start:true and installed:false.
      broken: autoStart && installed && !up,
      installed: installed,
      mode: str(v.mode),
      port: num(v.port),
      version: str(v.version),
      autoStart: autoStart
    };
  });
  var upCount = 0;
  var brokenNames = [];
  var dockerModeEnabled = false;
  for (var j = 0; j < svcRows.length; j++) {
    if (svcRows[j].up)
      upCount++;
    if (svcRows[j].broken)
      brokenNames.push(svcRows[j].display);
    if (svcRows[j].mode === "docker" && svcRows[j].installed)
      dockerModeEnabled = true;
  }
  s.services = { total: svcRows.length, up: upCount, rows: svcRows };
  if (brokenNames.length === 1)
    issues.push(brokenNames[0] + " is set to start automatically but is stopped");
  else if (brokenNames.length > 1)
    issues.push(listNames(brokenNames) + " are set to start automatically but are stopped");

  // Docker missing only matters if something actually depends on it.
  if (!s.docker.available && dockerModeEnabled)
    issues.push("Docker is unavailable and " + plural(svcRows.filter(function (v) {
      return v.mode === "docker" && v.installed;
    }).length, "service needs", "services need") + " it");

  // ---- sites -------------------------------------------------------------
  var siteRows = arr(snap.sites).map(function (v) {
    var tls = v.tls === true;
    var domain = str(v.domain);
    return {
      name: str(v.name),
      domain: domain,
      php: str(v.php_version),
      mode: str(v.mode),
      driver: str(v.driver),
      active: v.active === true,
      tls: tls,
      // Absent means "unknown", which must not read as "missing" — only an
      // explicit false is a fault. The CLI omits the field entirely when Caddy
      // is down, precisely so a stopped Caddy is reported once instead of
      // fifteen times.
      routePresent: v.route_present !== false,
      // ...but "unknown" must not read as "fine" either. A site is serving
      // only if Caddy is up AND has a route for it: with Caddy stopped there
      // is no route table to consult and nothing is reachable, so the rows
      // have to say so. Drawing fifteen emerald sites under a red Caddy is the
      // one way this panel could actively mislead.
      serving: v.active === true && v.route_present !== false && s.caddy.running,
      expiresInDays: typeof v.tls_expires_in_days === "number" ? v.tls_expires_in_days : null,
      url: (tls ? "https://" : "http://") + domain
    };
  });
  var activeCount = 0;
  var routeless = [];
  var expiring = [];
  for (var k = 0; k < siteRows.length; k++) {
    var site = siteRows[k];
    if (!site.active)
      continue;
    activeCount++;
    // A stopped Caddy already explains every missing route; saying it once is
    // the honest report, saying it fifteen times is noise.
    if (!site.routePresent && s.caddy.running)
      routeless.push(site.domain);
    if (site.expiresInDays !== null && site.expiresInDays <= CERT_WARN_DAYS)
      expiring.push(site.domain);
  }
  s.sites = { total: siteRows.length, active: activeCount, rows: siteRows };
  if (routeless.length)
    issues.push(listNames(routeless) + (routeless.length === 1 ? " is active but has no Caddy route" : " are active but have no Caddy route"));
  if (expiring.length)
    issues.push("A certificate for " + listNames(expiring) + " expires within " + CERT_WARN_DAYS + " days");

  // ---- health flags ------------------------------------------------------
  s.env.flags = arr(obj(snap.health).checks).map(function (c) {
    return {
      // The id is the stable name; the label is prose and may be reworded.
      // envRows() groups on the id, so dropping it here — as the first cut
      // did — makes the Environment section impossible to build from a
      // contract that is allowed to add checks.
      id: str(c.id),
      label: str(c.label),
      ok: c.level === "ok",
      level: str(c.level) || "ok",
      detail: str(c.detail)
    };
  });

  // ---- tunnels / backups / license --------------------------------------
  s.tunnels = arr(snap.tunnels).map(function (t) {
    return { site: str(t.site), url: str(t.url), running: t.running === true };
  });

  var backups = obj(snap.backups);
  s.backups = {
    count: num(backups.count),
    sizeLabel: sizeLabel(backups.bytes),
    lastAt: typeof backups.last_at === "string" ? backups.last_at : null
  };

  var license = obj(snap.license);
  s.license = { plan: str(license.plan), status: str(license.status) };
  // An absent license block is not a fault — a v1 contract may omit it.
  if (s.license.status && s.license.status !== "active")
    issues.push("HubDev license is " + s.license.status);

  s.issues = issues;
  s.level = levelFor(s);
  s.resources = resourcesFor(s);
  return s;
}

// Red is reserved for "nothing will work": no reverse proxy, or no default PHP.
// Everything else that is wrong is yellow. Anything else is quiet.
function levelFor(s) {
  if (!s.reachable)
    return "down";
  if (!s.caddy.running)
    return "down";
  for (var i = 0; i < s.php.rows.length; i++) {
    if (s.php.rows[i].isDefault && !s.php.rows[i].fpmRunning)
      return "down";
  }
  return s.issues.length ? "warn" : "ok";
}

// Container resource strip: drawn only when docker-mode services are actually
// running, per plan §5.2. Nothing to show is not the same as zero.
function resourcesFor(s) {
  return { shown: s.docker.available && s.docker.running > 0, running: s.docker.running };
}

// ------------------------------------------------- panel projections ----
//
// Everything below turns the summary into the rows the panel draws. It lives
// here, not in a .qml, for the usual reason: `node --test` runs this file and
// cannot run a view. A view that needs a decision — what to collapse, what to
// call something, which of eighteen health checks earn a line — asks for it
// here and binds to the answer.

// Sites split into what is serving and what is not.
//
// This machine has 15 sites where lerd Glance assumes 1, so the panel cannot
// simply list them: inactive sites collapse behind a count and the active ones
// sort by domain, which is what the user actually reads them by. A site that is
// active but has no Caddy route sorts to the top of its group — it is the row
// the panel exists to surface.
function siteGroups(s) {
  var active = [];
  var inactive = [];
  var rows = s && s.sites ? s.sites.rows : [];
  for (var i = 0; i < rows.length; i++)
    (rows[i].active ? active : inactive).push(rows[i]);

  active.sort(function (a, b) {
    var af = a.routePresent ? 1 : 0;
    var bf = b.routePresent ? 1 : 0;
    if (af !== bf)
      return af - bf;
    return a.domain < b.domain ? -1 : a.domain > b.domain ? 1 : 0;
  });
  inactive.sort(function (a, b) {
    return a.domain < b.domain ? -1 : a.domain > b.domain ? 1 : 0;
  });

  return { active: active, inactive: inactive, inactiveCount: inactive.length };
}

// Services split by whether they are set up at all.
//
// `installed: false` services are offered by HubDev but never configured here —
// on this machine that is meilisearch, minio and reverb. Listing them as
// "stopped" alongside real ones reads as three things broken, which is why they
// collapse behind a count. Broken services (auto-start, installed, stopped)
// sort first for the same reason routeless sites do.
// The URL a site row opens, or "" if it cannot safely be built.
//
// This lives here rather than in the .qml for both of the usual reasons: it is
// a rule (the scheme follows `tls`, which is per-site — this machine has some
// of each), and it is the one string in the panel that reaches a command line.
// The domain comes from HubDev's own config and is very probably fine, but
// "probably fine" is not the standard for an argument to a browser, so it is
// validated as a plain hostname rather than trusted. Anything else opens
// nothing, which is the correct failure: a row that does not respond is a much
// smaller problem than a row that runs something.
var DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

function siteUrl(site) {
  var v = obj(site);
  var domain = str(v.domain);
  if (!domain || domain.length > 253 || !DOMAIN_RE.test(domain))
    return "";
  return (v.tls === true ? "https://" : "http://") + domain;
}

function serviceGroups(s) {
  var installed = [];
  var available = [];
  var rows = s && s.services ? s.services.rows : [];
  for (var i = 0; i < rows.length; i++)
    (rows[i].installed ? installed : available).push(rows[i]);

  installed.sort(function (a, b) {
    if (a.broken !== b.broken)
      return a.broken ? -1 : 1;
    if (a.up !== b.up)
      return a.up ? -1 : 1;
    return a.display < b.display ? -1 : a.display > b.display ? 1 : 0;
  });
  available.sort(function (a, b) {
    return a.display < b.display ? -1 : a.display > b.display ? 1 : 0;
  });

  return { installed: installed, available: available, availableCount: available.length };
}

function checkById(s, id) {
  var flags = s && s.env ? s.env.flags : [];
  for (var i = 0; i < flags.length; i++) {
    if (flags[i].id === id)
      return flags[i];
  }
  return null;
}

// Health checks that envRows() promotes to a line of their own. Everything
// else — ports, Composer, the two API reachability probes, disk usage — is
// counted into the single "Diagnostics" row instead. Anything non-ok is
// already named in `issues`, so nothing is lost by not drawing it.
//
// `after` places the row. DNS and the hosts file sit directly under Caddy
// because the three of them are one question asked three ways — will a URL
// resolve at all — and reading them as a block is the point of the section.
// Stranded below Docker they read as trivia. Node stays with the runtimes.
//
// `label` and `value` override what the CLI sends. `hubdev doctor` writes for
// a full-screen report and can afford "Port 80 listening, .test domains should
// resolve"; a 420px row cannot, and the trailing clause only restates the dot.
// The TLD leaves the label because it is wrong as well as long — this machine
// serves .test, .lab and .craft, so "(.test)" names one of three.
var ENV_CHECKS = [
  { id: "dns_test", after: "caddy", label: "DNS", value: "Port 80 listening" },
  { id: "hosts_file", after: "caddy" },
  { id: "nodejs", after: "docker" }
];

// A promoted check as a row. The label override always applies — a name does
// not depend on state — but the value override applies only while the check is
// green. A passing check's detail is decoration and can be shortened; a
// failing one's detail is the *reason*, and replacing it with our cheerful
// stand-in would put "Port 80 listening" next to a red dot.
function envCheckRows(s, after) {
  var rows = [];
  for (var i = 0; i < ENV_CHECKS.length; i++) {
    var spec = ENV_CHECKS[i];
    if (spec.after !== after)
      continue;
    var check = checkById(s, spec.id);
    if (!check)
      continue;
    rows.push({
      key: check.id,
      label: spec.label || check.label,
      value: spec.value && check.level === "ok" ? spec.value : check.detail,
      level: check.level
    });
  }
  return rows;
}

// The Environment section: the state of the machine rather than of the things
// running on it (plan §5.2, which replaces lerd's Resources column with this —
// HubDev has no CPU figure and its memory figure costs a Docker stats sample
// per service, about a second, which is not a price a 30s poll should pay).
//
// Rows are { key, label, value, level }. `level` drives the dot; ok is quiet.
function envRows(s) {
  var rows = [];

  rows.push({
    key: "caddy",
    label: "Caddy",
    value: s.caddy.running
      ? (s.caddy.version || "running") + " · " + plural(s.caddy.routes, "route", "routes")
      : "stopped",
    level: s.caddy.running ? "ok" : "down"
  });

  rows = rows.concat(envCheckRows(s, "caddy"));

  for (var i = 0; i < s.php.rows.length; i++) {
    var php = s.php.rows[i];
    rows.push({
      key: "php-" + php.version,
      label: "PHP " + php.version + (php.isDefault ? " (default)" : ""),
      value: php.fpmRunning ? "FPM running" : "FPM stopped",
      // Only the default version failing stops the machine serving. A second
      // version with its pool down is a fact, not a fault — this machine idles
      // with 8.5 stopped and that is not something to colour.
      level: php.fpmRunning ? "ok" : (php.isDefault ? "down" : "idle")
    });
  }

  // Docker being absent is only a fault when something here depends on it —
  // the same rule summarize() uses to decide whether to raise the issue. A
  // machine running every service natively should not be told Docker is down.
  var dockerNeeded = false;
  for (var d = 0; d < s.services.rows.length; d++) {
    if (s.services.rows[d].mode === "docker" && s.services.rows[d].installed)
      dockerNeeded = true;
  }
  rows.push({
    key: "docker",
    label: "Docker",
    value: s.docker.available
      ? s.docker.running + " running" + (s.docker.exited ? " · " + s.docker.exited + " exited" : "")
      : "unavailable",
    level: s.docker.available ? "ok" : (dockerNeeded ? "warn" : "idle")
  });

  rows = rows.concat(envCheckRows(s, "docker"));

  var diag = checksSummary(s);
  if (diag.total)
    rows.push({ key: "diagnostics", label: "Diagnostics", value: diag.label, level: diag.level });

  return rows;
}

// The one-line roll-up of every health check, drawn as the last Environment
// row. Counting all of them — including the ones with their own line — is
// deliberate: this row answers "did the doctor pass?", and an answer that
// silently excluded three checks would be a worse answer than a redundant one.
function checksSummary(s) {
  var flags = s && s.env ? s.env.flags : [];
  var ok = 0;
  var worst = "ok";
  for (var i = 0; i < flags.length; i++) {
    if (flags[i].level === "ok")
      ok++;
    else if (flags[i].level === "down")
      worst = "down";
    else if (worst === "ok")
      worst = "warn";
  }
  return {
    total: flags.length,
    ok: ok,
    level: worst,
    label: flags.length ? ok + "/" + flags.length + " passing" : ""
  };
}

// A version as it should read on a row. HubDev reports a service version as
// whatever the provider calls it, which is a number for MySQL ("8.0") and a
// tag for others ("latest", "alpine", "2025-latest"). Prefixing every one with
// "v" produced "vlatest" and "valpine" in the panel — so the prefix is only
// for versions that are actually numbers.
function versionLabel(version) {
  var v = str(version);
  if (!v)
    return "";
  return /^[0-9]/.test(v) ? "v" + v : v;
}

// ------------------------------------------------------------- tooltip ----

// The bar tooltip. Two summary lines, then what is actually wrong, in plain
// words — nothing more when nothing is wrong.
function tooltip(s) {
  if (!s.reachable)
    return s.issues.length ? s.issues[0] : "HubDev is not running";

  var lines = [
    "Sites " + s.sites.active + "/" + s.sites.total + "  ·  Services " + s.services.up + "/" + s.services.total
  ];

  var second = [];
  if (s.php.default)
    second.push("PHP " + s.php.default + " (default)");
  second.push(s.caddy.running ? "Caddy " + (s.caddy.version || "running") : "Caddy stopped");
  lines.push(second.join("  ·  "));

  if (s.issues.length)
    lines.push("");
  for (var i = 0; i < s.issues.length; i++)
    lines.push("• " + s.issues[i]);

  return lines.join("\n");
}
