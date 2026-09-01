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
      // `route_present` is a PROPOSED contract field. Absent means "unknown",
      // which must not read as "missing" — only an explicit false is a fault.
      routePresent: v.route_present !== false,
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
