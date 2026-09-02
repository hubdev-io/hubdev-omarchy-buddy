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
    // **`installed` does not mean what its name suggests, and this cost a
    // shipped bug.** In HubDev it means "starting this would be immediate" —
    // for a docker service, that the container object exists. HubDev's own
    // `service:stop` REMOVES the container, so the flag flips to false on
    // every stop. Verified on the machine: stopping Redis and Mailpit turned
    // `installed` false for both while their images stayed local.
    //
    // Three rules below were reading it as "is this one of my services", and
    // all three broke the moment Phase 4e handed the user a stop button: the
    // row dropped out of the Services list into "not set up", its start button
    // went with it, and the "set to start automatically but is stopped"
    // warning fell silent — so the bar stayed green with two services down.
    //
    // It is now used for exactly what it says, and the two questions it was
    // being asked instead are answered on their own terms:
    var immediate = v.installed === true;
    var autoStart = v.auto_start === true;
    var mode = str(v.mode);
    // Is this service part of THIS machine's setup? Running, or set to come
    // up on boot, or immediately startable. Survives a stop, which is the
    // property the old rule did not have.
    var configured = up || autoStart || immediate;
    // Could it be brought up right now without installing a package first? A
    // docker service always can — worst case it re-pulls an image it already
    // has. A native one needs its package present, and `immediate` is the only
    // signal there is for that. This is what keeps a start button off the rows
    // where pressing it would mean a package install (plan §5.3).
    var startable = immediate || mode === "docker";
    return {
      name: str(v.name),
      display: str(v.display) || str(v.name),
      up: up,
      // `broken` is the only thing that earns a warning: a service the machine
      // is set to bring up, which is not running and could be. That last
      // clause is what keeps `reverb` — auto_start:true, native, no binary —
      // from warning forever about something never set up, which is the job
      // `installed` was doing here before it turned out to mean something else.
      broken: autoStart && startable && !up,
      immediate: immediate,
      configured: configured,
      startable: startable,
      mode: mode,
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
    // A stopped-but-configured docker service still needs Docker to come
    // back, so this asks `configured` rather than `immediate` too.
    if (svcRows[j].mode === "docker" && svcRows[j].configured)
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
      return v.mode === "docker" && v.configured;
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

// Services split by whether they are set up here at all.
//
// The split is on `configured` — running, or set to come up on boot, or
// immediately startable — and NOT on `installed`, which is the mistake this
// used to make. HubDev's `installed` means "starting is immediate", and its own
// stop removes the container, so splitting on it moved a service into "not set
// up" the moment you stopped it: the row you had just acted on vanished from
// the list, taking its start button with it. See the note in summarize().
//
// What is left in the collapsed group is the real thing it was always for:
// services HubDev offers that this machine has never set up — meilisearch and
// minio here. Listing those as "stopped" alongside real ones reads as things
// broken, which is why they collapse behind a count. Broken services sort
// first, for the same reason routeless sites do.
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

// The site rows the panel actually draws, in the order it draws them —
// serving, then the collapsed count, then the parked ones it hides.
//
// This exists because two separate things have to agree on that order and
// neither can be the authority: SitesSection renders it, and the keyboard
// cursor walks it. While the order lived in the .qml, "what is the row below
// this one" was a question nothing could answer without re-reading the view,
// and a search changes the answer completely. Here it is one value, computed
// once, and node can test it.
//
// `url` is resolved here rather than in the row for the same reason: whether a
// row is openable decides whether the cursor may land on it, and that must be
// the same answer the row's click gives.
function visibleSites(s, search, expanded) {
  var q = search && search.active === true;

  if (q) {
    // One flat, ranked list: the serving/parked split is dropped, because
    // finding a parked site is the search's whole point.
    var matches = arr(search.sites);
    var found = [];
    for (var i = 0; i < matches.length; i++) {
      var m = obj(matches[i]);
      found.push({ site: m.site, spans: m.spans || [], url: siteUrl(m.site) });
    }
    return { serving: found, parked: [], collapse: null, searching: true, total: found.length };
  }

  var g = siteGroups(s);
  var serving = [];
  for (var j = 0; j < g.active.length; j++)
    serving.push({ site: g.active[j], spans: [], url: siteUrl(g.active[j]) });

  var parked = [];
  var collapse = null;
  if (g.inactiveCount > 0) {
    collapse = {
      count: g.inactiveCount,
      expanded: expanded === true,
      label: plural(g.inactiveCount, "parked site", "parked sites")
    };
    if (expanded === true) {
      for (var k = 0; k < g.inactive.length; k++)
        parked.push({ site: g.inactive[k], spans: [], url: siteUrl(g.inactive[k]) });
    }
  }

  return {
    serving: serving,
    parked: parked,
    collapse: collapse,
    searching: false,
    total: serving.length + parked.length
  };
}

function serviceGroups(s) {
  var configured = [];
  var others = [];
  var rows = s && s.services ? s.services.rows : [];
  for (var i = 0; i < rows.length; i++)
    (rows[i].configured ? configured : others).push(rows[i]);

  configured.sort(function (a, b) {
    if (a.broken !== b.broken)
      return a.broken ? -1 : 1;
    if (a.up !== b.up)
      return a.up ? -1 : 1;
    return a.display < b.display ? -1 : a.display > b.display ? 1 : 0;
  });
  others.sort(function (a, b) {
    return a.display < b.display ? -1 : a.display > b.display ? 1 : 0;
  });

  return { configured: configured, others: others, otherCount: others.length };
}

// The service rows the panel draws, in the order it draws them — set up, then
// the collapsed count, then the ones it hides.
//
// The twin of `visibleSites`, and it exists now for the same reason that one
// did: the Services section grew buttons in Phase 4e, so the keyboard cursor
// has to walk it, and two files cannot both be the authority on what "the row
// below this one" means.
//
// One asymmetry with sites, and it is deliberate. The parked-sites count is a
// cursor stop because the rows behind it can be acted on; the "not set up"
// count is **not**, because the rows behind it cannot — `Actions.serviceArgv`
// refuses an uninstalled service, so expanding the group from the keyboard
// would walk the cursor into a group with nothing in it that can be pressed.
// It stays a mouse-only disclosure, which is what it already was.
function visibleServices(s, search, expanded) {
  var q = search && search.active === true;

  if (q) {
    // Flat and ranked, and it deliberately includes services that are not set
    // up: the collapsed group is exactly where the thing you cannot find has
    // been. Their rows simply draw no buttons.
    var matches = arr(search.services);
    var found = [];
    for (var i = 0; i < matches.length; i++) {
      var m = obj(matches[i]);
      found.push({ service: m.service, spans: m.spans || [] });
    }
    return { rows: found, others: [], collapse: null, searching: true, total: found.length };
  }

  var g = serviceGroups(s);
  var rows = [];
  for (var j = 0; j < g.configured.length; j++)
    rows.push({ service: g.configured[j], spans: [] });

  var others = [];
  var collapse = null;
  if (g.otherCount > 0) {
    collapse = {
      count: g.otherCount,
      expanded: expanded === true,
      label: g.otherCount + " not set up"
    };
    if (expanded === true) {
      for (var k = 0; k < g.others.length; k++)
        others.push({ service: g.others[k], spans: [] });
    }
  }

  return {
    rows: rows,
    others: others,
    collapse: collapse,
    searching: false,
    total: rows.length + others.length
  };
}

// -------------------------------------------------------------- search ----
//
// Type-to-filter. The panel opens with keyboard focus already, so the cheapest
// possible "find it" is to start typing: no field to click into, no shortcut to
// remember, and nothing on screen at all until the first character arrives.
//
// The matcher is a SUBSEQUENCE match, not a substring one — "cpa" finds
// "clinic-portal-app.test" the way a launcher would. That is the whole reason
// to do this in a panel that already shows every site: fifteen rows is few
// enough to read and too many to scan mid-thought.
//
// Ranking, not just filtering, is the part worth testing. Scattered matches are
// legal but should never outrank the obvious one: typing "hub" must put
// "hubdev.test" first even though the letters also appear, spread out, in
// something else. Hence the bonuses below — contiguity and word starts are what
// make a match feel intentional.

// Whitespace is dropped from the query rather than matched. A space is never
// part of a domain or a service name, so a typed one can only ever be a slip,
// and treating it literally would silently empty the list.
function foldQuery(q) {
  return (typeof q === "string" ? q : "").replace(/\s+/g, "").toLowerCase();
}

// Where a "word" begins inside a domain or a service name. `-` and `.` are what
// HubDev's own labels are built from (`clinic-portal-app.test`), so a match at
// one of those seams is the user aiming at a part of the name.
var WORD_BREAK = /[-._/ ]/;

// Where a run of the query is ALLOWED to continue. This is the rule that keeps
// a subsequence matcher from being useless.
//
// A plain subsequence match will find "saf" inside "sonata.craft" —
// s(onata.cr)a(f)t — which is true, and is not what anybody meant. So after
// the first character, every next one must either sit immediately after the
// last (a run) or begin a word. Nothing else counts. That single rule is the
// difference between a filter and a list of coincidences.
//
// The FIRST character is exempt: it may land anywhere. "dev" has to find
// "hubdev.test", and requiring a word start there would mean only ever matching
// from the front of a name or a segment.
function isWordStart(text, i) {
  return i === 0 || WORD_BREAK.test(text.charAt(i - 1));
}

// One alignment, anchored at `start`. null when the rule above cannot be
// satisfied from there.
function alignFrom(text, lower, q, start) {
  var spans = [[start, 1]];
  var score = 1;
  if (isWordStart(text, start))
    score += 10;                        // began at a seam: aimed, not accidental
  score -= start * 0.5;                 // earlier in the name is better
  var prev = start;

  for (var i = 1; i < q.length; i++) {
    var c = q.charAt(i);

    if (lower.charAt(prev + 1) === c) {
      spans[spans.length - 1][1] += 1;
      score += 9;                       // 1, plus 8 for continuing a real word
      prev = prev + 1;
      continue;
    }

    var at = -1;
    for (var j = prev + 1; j < lower.length; j++) {
      if (lower.charAt(j) === c && isWordStart(text, j)) {
        at = j;
        break;
      }
    }
    if (at < 0)
      return null;

    spans.push([at, 1]);
    score += 11 - 3;                    // 1, plus 10 for a word start, less the
    prev = at;                          // cost of opening another run
  }

  return { score: score, spans: spans };
}

// null, or { score, spans } where spans are [start, length] runs into `text`.
//
// Every occurrence of the first query character is tried as an anchor and the
// best-scoring alignment wins. A single greedy pass would be O(n) instead, but
// it can also fail on a query that does match: leftmost-first commits to the
// first `a` in "clinic-portal-app" and then cannot satisfy the word-start rule,
// even though anchoring one segment later works. At these sizes — a query of a
// few characters against a domain of a few dozen — exhaustive is free, and it
// removes a class of "why did that not match" that would be impossible to
// explain to the person typing.
function fuzzyMatch(text, query) {
  var t = typeof text === "string" ? text : "";
  var q = foldQuery(query);
  if (!t || !q)
    return null;

  var lower = t.toLowerCase();
  var first = q.charAt(0);
  var best = null;

  for (var s = 0; s < lower.length; s++) {
    if (lower.charAt(s) !== first)
      continue;
    var m = alignFrom(t, lower, q, s);
    if (m && (!best || m.score > best.score))
      best = m;
  }

  return best;
}

// A row matches on the text the panel actually draws, and falls back to the
// text it does not.
//
// Highlighting is only honest when it marks the string on screen, so a match
// found in the fallback carries NO spans — the row appears, nothing lights up,
// and that is the correct signal. HubDev builds a domain as name + TLD, so on
// an ordinary machine the fallback never fires; it exists for the site linked
// to a domain that has nothing to do with what the user called it.
function matchLabel(text, fallback, query) {
  var m = fuzzyMatch(text, query);
  if (m)
    return m;
  var alt = fuzzyMatch(fallback, query);
  return alt ? { score: alt.score - 20, spans: [] } : null;
}

function byRelevance(key) {
  return function (a, b) {
    if (a.score !== b.score)
      return b.score - a.score;
    if (a.live !== b.live)
      return a.live ? -1 : 1;
    return a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0;
  };
}

// Matches across BOTH site groups — serving and parked. Finding a parked site
// is the search's best moment: it is the one the collapsed row was hiding.
function searchSites(s, query) {
  var out = [];
  var rows = s && s.sites ? s.sites.rows : [];
  for (var i = 0; i < rows.length; i++) {
    var m = matchLabel(rows[i].domain, rows[i].name, query);
    if (m)
      out.push({ site: rows[i], spans: m.spans, score: m.score, live: rows[i].active === true, label: rows[i].domain });
  }
  out.sort(byRelevance("label"));
  return out;
}

function searchServices(s, query) {
  var out = [];
  var rows = s && s.services ? s.services.rows : [];
  for (var i = 0; i < rows.length; i++) {
    var m = matchLabel(rows[i].display, rows[i].name, query);
    if (m)
      out.push({ service: rows[i], spans: m.spans, score: m.score, live: rows[i].up === true, label: rows[i].display });
  }
  out.sort(byRelevance("label"));
  return out;
}

// Everything the panel needs for one keystroke, computed once and handed down.
// `active` is the switch the whole UI reads: false restores the normal panel,
// so clearing the query can never leave a section filtered.
function searchResults(s, query) {
  var q = foldQuery(query);
  if (!q)
    return { query: "", active: false, sites: [], services: [], total: 0, searched: 0 };

  var sites = searchSites(s, q);
  var services = searchServices(s, q);
  var siteTotal = s && s.sites ? s.sites.total : 0;
  var serviceTotal = s && s.services ? s.services.total : 0;
  return {
    query: q,
    active: true,
    sites: sites,
    services: services,
    total: sites.length + services.length,
    searched: siteTotal + serviceTotal
  };
}

// ---- highlight -----------------------------------------------------------

function escapeHtml(text) {
  return (typeof text === "string" ? text : "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// A colour is only ever allowed through as a literal. Qt stringifies a colour
// as #rrggbb or #aarrggbb, and anything else is dropped rather than pasted into
// markup — the rule costs nothing and means this function cannot be turned into
// an injection point by a future caller passing something clever.
var COLOR_RE = /^#[0-9A-Fa-f]{3,8}$/;

// Array-like, checked by duck-typing rather than by `Array.isArray`.
//
// This is the one function in the model that receives data back OUT of QML: the
// spans are computed here, held in a `property var` on the row, and handed in
// again to be rendered. That round trip turns a real JS Array into a QVariantList
// wrapper — it indexes, it has `.length`, and `Array.isArray` on it is FALSE.
// Under `node --test` both sides are real arrays, so the check passed every test
// and silently rendered every label as plain text on screen. Anything crossing
// back from QML has to be duck-typed.
function listLike(v) {
  return v && typeof v === "object" && typeof v.length === "number" ? v : null;
}

// The row label as Text.StyledText, with the matched runs marked.
//
// This exists here rather than in the .qml for the usual reason and one more:
// it builds markup out of data. Every non-matching character is escaped, the
// spans are bounds-checked against the text they claim to index, and both rules
// are things a test can hold. A .qml string concatenation could not be.
function highlightHtml(text, spans, color) {
  var t = typeof text === "string" ? text : "";
  var runs = listLike(spans);
  if (!runs || !runs.length)
    return escapeHtml(t);

  var tint = typeof color === "string" && COLOR_RE.test(color) ? color : "";
  var out = "";
  var at = 0;

  for (var i = 0; i < runs.length; i++) {
    var run = listLike(runs[i]);
    if (!run || run.length < 2)
      continue;
    var start = num(run[0]);
    var len = num(run[1]);
    if (len <= 0 || start < at || start + len > t.length)
      continue;

    out += escapeHtml(t.slice(at, start));
    var piece = escapeHtml(t.slice(start, start + len));
    out += tint ? '<b><font color="' + tint + '">' + piece + "</font></b>" : "<b>" + piece + "</b>";
    at = start + len;
  }

  return out + escapeHtml(t.slice(at));
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
    if (s.services.rows[d].mode === "docker" && s.services.rows[d].configured)
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
