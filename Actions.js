.pragma library

// What the panel is allowed to run, and the exact argv it runs.
//
// Plan §5.4: every action is a FIXED ARGV ARRAY, never a shell string, and the
// subject is validated against the current snapshot before anything is spawned.
// Both rules live here rather than in a .qml precisely so `node --test` can
// hold them — the argv this file returns is the argv the shell executes, byte
// for byte.
//
// The three verbs below are the ones that need no machinery at all: they are
// detached, they produce no output anyone reads, they cannot fail destructively
// and they cannot escalate. HubDev already owns each of them as a first-class
// command (`site:terminal`, `folder`, `edit`) and each resolves the user's own
// default rather than naming a program — terminal via $TERMINAL, file manager
// via xdg-open, editor via omarchy-launch-editor — so "my terminal" means here
// what it means everywhere else on the desktop. None of them wait: HubDev calls
// Start(), not Run(), for all three.
//
// Deliberately NOT here: anything whose output or exit code matters, anything
// that stops something someone may be using, anything that can raise a polkit
// dialog. Those need `Process`, a guard timer and a confirm gate — the rest of
// Phase 4 — and they must not be smuggled in by adding a row to this table.

var BIN = "hubdev";

// The label handed to `hubdev <verb> <site>`. HubDev matches it against site
// names and domains (cli_site_open.go: matchSiteByLabel), so either works.
//
// The leading character is the point of the rule, not decoration. Util.execArgv
// hands bash a fixed argv, so a site name can never be re-tokenised into a
// command — but `hubdev` parses its OWN flags out of that argv, and a site
// called `--print` or `-q` would be read as one. Requiring the first character
// to be alphanumeric closes that, and rejects `..`, `~/x` and `-rf` with it.
var REF_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

// key   — what the UI sends back; also the test's handle on a row.
// icon  — a name in Theme.ICONS, not a codepoint. Theme owns glyphs.
// label — the tooltip. Verb first: it is read on hover, mid-gesture.
// args  — everything between the binary and the site reference.
var SITE_ACTIONS = [
  {
    key: "terminal",
    icon: "terminal",
    label: "Open terminal here",
    args: ["site:terminal"]
  },
  {
    key: "folder",
    icon: "folder",
    label: "Show in file manager",
    args: ["folder"]
  },
  {
    key: "editor",
    icon: "code",
    label: "Open in editor",
    // `--ide=` overrides HubDev's editor for this one call, and it is here for
    // a measured reason rather than a preference.
    //
    // Left alone, `hubdev edit` resolves $EDITOR, which on Omarchy is
    // `omarchy-launch-editor --inline`. `--inline` means "run the editor in
    // THIS terminal" — it is the contract $EDITOR has always had — and a bar
    // widget has no terminal to give it. Verified on this machine: the plain
    // form opens no window at all, this form opens the editor every time.
    //
    // `omarchy-launch-editor` without `--inline` is the desktop's own answer
    // to "open this in my editor": it wraps a terminal editor in a terminal
    // (omarchy-launch-tui) and launches a GUI one under uwsm-app. That is the
    // same reasoning that makes the browser action `omarchy-launch-browser`
    // rather than a hard-coded browser — the desktop resolves "mine", we do
    // not.
    //
    // The cost is honest and worth stating: this ignores `hubdev editor:use`.
    // A user who has set one gets the desktop's editor from the bar and their
    // own from the terminal. Removing `--ide=` is the whole fix if HubDev ever
    // stops forwarding an inline $EDITOR down its detached launch path.
    args: ["edit", "--ide=omarchy-launch-editor"]
  }
];

// The rows the UI draws. A copy, and without `args`: a view has no business
// holding argv, and handing out the live array would let a binding mutate the
// allowlist.
function siteActions() {
  return SITE_ACTIONS.map(function (a) {
    return { key: a.key, icon: a.icon, label: a.label };
  });
}

function actionByKey(key) {
  for (var i = 0; i < SITE_ACTIONS.length; i++) {
    if (SITE_ACTIONS[i].key === key)
      return SITE_ACTIONS[i];
  }
  return null;
}

// The site's own label, or "" when it is not one we are willing to put on a
// command line. Name first (it is what `hubdev site:list` prints and what the
// user types), domain as the fallback for a site whose name is unusable.
function siteRef(site) {
  var v = site && typeof site === "object" ? site : {};
  var name = typeof v.name === "string" ? v.name : "";
  if (REF_RE.test(name))
    return name;
  var domain = typeof v.domain === "string" ? v.domain : "";
  if (REF_RE.test(domain))
    return domain;
  return "";
}

// The whole gate, in one function: unknown verb, unusable reference, or a site
// the current snapshot does not list — any of the three returns [], and []
// means nothing is spawned. Nothing downstream re-checks, so nothing else can
// forget to.
//
// The snapshot check is what stops a stale panel acting on a site that has
// since been unlinked. It compares by the resolved reference, not by object
// identity: the row the view holds is a copy from an earlier poll.
function siteArgv(summary, site, key) {
  var action = actionByKey(key);
  if (!action)
    return [];

  var ref = siteRef(site);
  if (!ref)
    return [];

  if (!knownSite(summary, ref))
    return [];

  return [BIN].concat(action.args, [ref]);
}

function knownSite(summary, ref) {
  var sites = summary && summary.sites ? summary.sites.rows : null;
  if (!sites || !sites.length)
    return false;
  for (var i = 0; i < sites.length; i++) {
    if (siteRef(sites[i]) === ref)
      return true;
  }
  return false;
}

// --------------------------------------------------------------- services --
//
// The first actions here that are NOT detached, and every difference follows
// from that one fact.
//
// `hubdev site:terminal` opens a window and we never hear from it again. These
// three change the machine and then report whether they managed to: they have
// an exit code worth reading, a failure worth showing, and a duration long
// enough that the panel has to say something while it waits. So they go
// through `BarWidget.runAction` — a `Process` with a guard timer — rather than
// `Util.execArgv`, and the panel gains a spinner, a refusal line and a confirm
// gate to match. That machinery is the rest of Phase 4; this table is what it
// is allowed to point at.
//
// **Escalation was checked before this shipped, not assumed** (plan §7.1). The
// native provider reaches root through `platform.RunPrivileged`, which is
// `sudo -n` (never prompts) and then `pkexec` (prompts, but visibly). The two
// things it runs are `bash -c <script>` and `systemctl stop <unit>` — both
// covered NOPASSWD by the sudoers rule HubDev installs, so rung 1 answers and
// rung 2 is never reached. The docker provider does not escalate at all. The
// guard timer is still mandatory: on a machine where that rule is absent, a
// polkit dialog would block the child until somebody answers it, and a bar
// widget must not be able to wait forever on one.
//
// key     — what the UI sends back, and the test's handle on the row.
// icon    — a name in Theme.ICONS. Theme owns glyphs.
// label   — the verb alone. The subject is added where it is shown.
// args    — everything between the binary and the service name.
// needs   — the state the service must ALREADY be in. This is what makes the
//           row show either `start` or `restart`+`stop` and never all three:
//           the pair that cannot apply is not offered, rather than offered and
//           refused.
// confirm — whether a first press only arms the button. See `needsConfirm`.
// timeout — the hard ceiling on the Process, in ms. See the note below it.
var SERVICE_ACTIONS = [
  {
    key: "start",
    icon: "play",
    label: "Start",
    args: ["service:start"],
    needs: "down",
    confirm: false,
    timeout: 90000
  },
  {
    key: "restart",
    icon: "restart",
    label: "Restart",
    args: ["service:restart"],
    needs: "up",
    confirm: false,
    timeout: 90000
  },
  {
    key: "stop",
    icon: "stop",
    label: "Stop",
    args: ["service:stop"],
    needs: "up",
    confirm: true,
    // A stop is a docker graceful shutdown or a `systemctl stop`, and neither
    // pulls anything. It gets half the ceiling because a stop that has not
    // returned in 45s is stuck, not slow.
    timeout: 45000
  }
];

function serviceActionByKey(key) {
  for (var i = 0; i < SERVICE_ACTIONS.length; i++) {
    if (SERVICE_ACTIONS[i].key === key)
      return SERVICE_ACTIONS[i];
  }
  return null;
}

// Only `stop` arms, and the line between the three is worth stating because it
// is not "destructive vs not".
//
// Plan §5.4 gates "anything that stops something someone may be using", and its
// three examples — `caddy:stop`, `php:stop`, `site:stop` — share the property
// that matters: they leave the thing down until a person notices. A restart
// drops open connections too, which is real, but it puts the service back by
// itself; the failure mode is a few seconds of downtime, not an afternoon of
// wondering why the app cannot reach MySQL. Arming both would make two of the
// three buttons on every running row take two presses, which is how a confirm
// gate stops being read at all.
function needsConfirm(key) {
  var action = serviceActionByKey(key);
  return action ? action.confirm === true : false;
}

// The Process ceiling for one verb. Deliberately generous next to the 15s
// snapshot timeout: this machine's SQL Server container takes a while to come
// up, and reporting "did not answer in time" for something that was merely slow
// is worse than waiting, because the panel would then be telling the user a lie
// about their own machine.
//
// A ceiling is not a claim the verb finished — a killed `service:start` can
// leave Docker still starting. That is exactly why the burst refresh runs on
// timeout as well as on success: the snapshot, not the exit code, is what the
// panel finally believes.
function timeoutMs(key) {
  var action = serviceActionByKey(key);
  return action && action.timeout > 0 ? action.timeout : 60000;
}

// The rows the UI draws — a copy, without `args`, for the same reason
// `siteActions` withholds them. `confirm` is exposed because the button has to
// know it will arm before it is pressed, and that is a fact about the verb
// rather than a command line.
function serviceActions() {
  return SERVICE_ACTIONS.map(function (a) {
    return { key: a.key, icon: a.icon, label: a.label, confirm: a.confirm === true };
  });
}

// The service's own name, or "" when it cannot go on a command line. Same rule
// and the same reason as `siteRef`: `hubdev` parses its own flags out of the
// argv it is handed, so a leading `-` would be read as one. Services have no
// second identity to fall back to — `display` is a human label ("SQL Server"),
// never an argument.
function serviceRef(service) {
  var v = service && typeof service === "object" ? service : {};
  var name = typeof v.name === "string" ? v.name : "";
  return REF_RE.test(name) ? name : "";
}

// The row for `ref` in the CURRENT snapshot, or null. The row a view holds is a
// copy from an earlier poll, and every gate below asks its questions of this one
// instead — a panel that has been open for a minute must not be able to stop a
// service that is already stopped, or start one that came up on its own in the
// meantime.
function liveService(summary, ref) {
  var rows = summary && summary.services ? summary.services.rows : null;
  if (!rows || !rows.length)
    return null;
  for (var i = 0; i < rows.length; i++) {
    if (serviceRef(rows[i]) === ref)
      return rows[i];
  }
  return null;
}

// The whole gate, in one function, exactly as `siteArgv` is for sites: [] means
// nothing is spawned, and nothing downstream re-checks.
//
// Four refusals, and the last two are the ones worth naming:
//
//  - **Not set up here.** HubDev lists its whole catalogue, including services
//    this machine never configured. `service:start` on one of those is not a
//    start — it is a setup, and the plan puts installs out of scope for v1
//    (§5.3). `Model.summarize` answers this with `configured`, and the first
//    version of this gate got it wrong by asking `installed` instead: HubDev's
//    stop removes the container, so a service you had just stopped became
//    "not set up" and lost the very button that would bring it back. That was
//    the bug this gate exists to not have.
//  - **Not startable without an install.** `startable` is the other half: a
//    docker service can always be brought up, a native one needs its package
//    present. Without this, the start button on a configured-but-never-built
//    native service would kick off a package install from a bar panel.
//  - **Wrong state.** Start is offered only to a stopped service and
//    stop/restart only to a running one, so the two presses that could not
//    possibly do anything are never on the row to be pressed.
function serviceArgv(summary, service, key) {
  var action = serviceActionByKey(key);
  if (!action)
    return [];

  var ref = serviceRef(service);
  if (!ref)
    return [];

  var live = liveService(summary, ref);
  if (!live || live.configured !== true)
    return [];

  if (action.needs === "up" && live.up !== true)
    return [];
  if (action.needs === "down" && (live.up === true || live.startable !== true))
    return [];

  return [BIN].concat(action.args, [ref]);
}

// The handle for an armed confirm gate: subject and verb together, because
// arming is per BUTTON and not per row. Built here so the panel that sets it
// and the button that reads it cannot disagree about the format — the kind of
// contract that, expressed as string concatenation in two files, fails by
// simply never matching and never saying so.
function confirmToken(ref, key) {
  var r = typeof ref === "string" ? ref : "";
  var k = typeof key === "string" ? key : "";
  return r === "" || k === "" ? "" : "svc:" + r + ":" + k;
}

// What to call this action while it runs and after it fails: "Stop Redis",
// "Restart SQL Server". Built here rather than in the panel so the wording of a
// failure line is under test along with everything else.
function serviceActionLabel(key, display) {
  var action = serviceActionByKey(key);
  var name = typeof display === "string" ? display : "";
  if (!action)
    return name;
  return name ? action.label + " " + name : action.label;
}

// What to say once it worked: "Redis restarted", "Mailpit stopped". Past
// tense, one clause, no exclamation — the panel is confirming, not celebrating.
//
// This exists because a start or a stop is otherwise reported only by a dot
// changing colour somewhere in a list of eight, which is easy to miss when you
// were looking at the button you just pressed. It shares the one status line at
// the foot of the panel with the confirm question and the failure, so it costs
// no new chrome, and it clears itself after a few seconds.
var DONE = {
  start: "started",
  stop: "stopped",
  restart: "restarted"
};

function serviceDoneLabel(key, display) {
  var past = DONE[key];
  var name = typeof display === "string" ? display : "";
  if (!past)
    return "";
  return name ? name + " " + past : "Service " + past;
}

// ------------------------------------------------------------ environment --
//
// Caddy and each PHP-FPM pool, started and stopped from their Environment rows.
//
// The same machinery as the service verbs — `BarWidget.runAction`, a guard
// timer, `parseResult`, a confirm gate on `stop` — pointed at a different kind
// of row. What differs is what the rows ARE, and two of those differences
// changed the design rather than just the plumbing:
//
//   1. **There is no restart.** HubDev has `caddy:start` / `caddy:stop` and
//      `php:start <v>` / `php:stop <v>`, and no restart verb for either. Two
//      buttons that mean stop-then-start would be this file inventing a verb
//      whose failure halfway through it could not describe. A service row has
//      three buttons and these have two, and that asymmetry is the CLI's.
//   2. **The subject is a target, not a name.** A service is identified by
//      something the user typed into HubDev; Caddy and PHP are identified by
//      what they are. `Model.envRows` stamps `target` on exactly the two rows
//      that can be acted on, so a health check promoted into this section — DNS,
//      hosts file, Node — is inert because it carries no target, not because
//      this file recognised its name.
//
// Stopping Caddy is the largest thing this panel can do: every site on the
// machine stops resolving at once. It goes behind the same two-press gate as a
// service stop, for the same reason and with no extra ceremony — a gate that
// escalates by importance is a gate people learn to click through twice.
var ENV_ACTIONS = [
  { key: "start", icon: "play", label: "Start", needs: "down", confirm: false, timeout: 45000 },
  { key: "stop",  icon: "stop", label: "Stop",  needs: "up",   confirm: true,  timeout: 30000 }
];

// A PHP target names a version, and that version reaches a command line. Two
// digits groups separated by a dot and nothing else: no flags, no paths, no
// `..`, and no room for `php:stop --help` to be a "version".
var ENV_TARGET_RE = /^(caddy|php:\d{1,3}\.\d{1,3})$/;

function envActions() {
  return ENV_ACTIONS.map(function (a) {
    return { key: a.key, icon: a.icon, label: a.label };
  });
}

function envActionByKey(key) {
  for (var i = 0; i < ENV_ACTIONS.length; i++) {
    if (ENV_ACTIONS[i].key === key)
      return ENV_ACTIONS[i];
  }
  return null;
}

function envNeedsConfirm(key) {
  var a = envActionByKey(key);
  return !!a && a.confirm === true;
}

function envTimeoutMs(key) {
  var a = envActionByKey(key);
  return a ? a.timeout : 45000;
}

// The target as this file will use it, or "" for anything it will not.
function envTarget(row) {
  var v = row && typeof row === "object" ? row : {};
  var t = typeof v.target === "string" ? v.target : (typeof v === "string" ? v : "");
  return ENV_TARGET_RE.test(t) ? t : "";
}

// The live state of a target, read out of the CURRENT snapshot rather than out
// of the row the view is holding — the row is a copy from an earlier poll, and
// between that poll and this click Caddy may well have stopped. Same rule, and
// same reason, as `liveService`.
//
// Returns null for a target this snapshot cannot account for: a PHP version
// that has since been uninstalled, or a summary with nothing in it at all.
function envLive(summary, target) {
  var s = summary && typeof summary === "object" ? summary : {};

  if (target === "caddy") {
    var caddy = s.caddy && typeof s.caddy === "object" ? s.caddy : null;
    if (!caddy)
      return null;
    return { kind: "caddy", version: "", display: "Caddy", up: caddy.running === true };
  }

  var m = /^php:(\d{1,3}\.\d{1,3})$/.exec(typeof target === "string" ? target : "");
  if (!m)
    return null;
  var version = m[1];
  var rows = s.php && s.php.rows ? s.php.rows : [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i] && typeof rows[i] === "object" ? rows[i] : {};
    if (row.version === version)
      return { kind: "php", version: version, display: "PHP " + version, up: row.fpmRunning === true };
  }
  return null;
}

// The whole gate, in one function, exactly as `serviceArgv` is for services.
// [] means nothing is spawned, and nothing downstream re-checks.
function envArgv(summary, row, key) {
  var action = envActionByKey(key);
  if (!action)
    return [];
  var target = envTarget(row);
  if (!target)
    return [];
  var live = envLive(summary, target);
  if (!live)
    return [];
  if (action.needs === "up" && live.up !== true)
    return [];
  if (action.needs === "down" && live.up === true)
    return [];

  if (live.kind === "caddy")
    return [BIN, "caddy:" + key];
  return [BIN, "php:" + key, live.version];
}

// The handle for an armed gate on an environment row. Prefixed so it can never
// collide with a service's — a machine may perfectly well run a service called
// `caddy`, and two rows sharing one armed token would arm both.
function envToken(target, key) {
  var t = typeof target === "string" ? target : "";
  var k = typeof key === "string" ? key : "";
  return t === "" || k === "" ? "" : "env:" + t + ":" + k;
}

// What to call this while it runs, and after it has run.
function envActionLabel(key, display) {
  var action = envActionByKey(key);
  var name = typeof display === "string" ? display : "";
  if (!action)
    return name;
  return name ? action.label + " " + name : action.label;
}

var ENV_DONE = { start: "started", stop: "stopped" };

function envDoneLabel(key, display) {
  var word = ENV_DONE[key];
  var name = typeof display === "string" ? display : "";
  if (!word)
    return name;
  return name ? name + " " + word : word;
}

// The display name for a target, for a label that has to name it. Taken from
// the live snapshot so it says "PHP 8.4" whatever the row's own label reads —
// the row's says "PHP 8.4 (default)", which is a fact about the row and not a
// name anyone would say out loud.
function envDisplay(summary, row) {
  var live = envLive(summary, envTarget(row));
  return live ? live.display : "";
}

// ----------------------------------------------------------------- update --
//
// The one action the panel can offer when there is no snapshot to act on.
//
// When `hubdev` is too old to answer `snapshot --json`, the panel is empty and
// its footer still says "Refresh" — a button whose only honest outcome is the
// same refusal again, since no amount of re-asking makes a v1.28 grow a verb it
// does not have. `Actions.updateArgv` is what that button becomes instead.
//
// **It runs in a terminal, and that is the design, not a shortcut.** Three
// separate reasons, any one of which would be enough:
//
//   1. It escalates. `hubdev update` reaches root through `RunPrivileged`
//      (`sudo -n`, then a blocking `pkexec` dialog). Plan §7.1 is explicit that
//      such a verb must never be a headless `Process` — the dialog would hang
//      behind the panel with nothing to answer it.
//   2. It outlives any guard timer worth setting. A download plus a package
//      transaction is minutes, and `runAction`'s contract is a hard per-verb
//      timeout; the only way to keep that promise here would be to break the
//      update halfway.
//   3. It replaces the binary the widget is polling, out from under the poll.
//
// And the fourth reason, which is the one that actually decided it: on Arch,
// `hubdev update` delegates to `yay -Syu --noconfirm hubdev-bin`. `-Syu` with a
// package name is a FULL SYSTEM UPGRADE that also installs that package — so
// this button moves more than HubDev, and `--noconfirm` means nothing stops to
// ask. A terminal is where that becomes visible while it happens and
// interruptible with C-c. A silent spawn would make a bar button the least
// reversible thing on the desktop. (Raised for HubDev itself as
// `hubdev-io/devhub-go` issue 12: a targeted update wants `-S`, not `-Syu`.
// If that lands, the terminal is still right for reasons 1-3 — it just stops
// being urgent.)
//
// `omarchy-launch-tui` is the desktop's own answer to "run this in my
// terminal", the same deference as `omarchy-launch-browser` for the URL and
// `omarchy-launch-editor` for the editor. We do not name a terminal.
var UPDATE_ARGV = ["omarchy-launch-tui", BIN, "update"];

// [] unless the snapshot says HubDev is specifically OUT OF DATE.
//
// Not "unreachable": a HubDev that is missing, crashed, or answering nonsense
// is not helped by an update, and offering one there would be guessing at a
// cause the widget does not know. `Model.unreachable` sets `outdated` from
// SourceJson's refusal code, so the one place that can tell the difference is
// the one place that decides.
function updateArgv(summary) {
  var s = summary && typeof summary === "object" ? summary : {};
  if (s.outdated !== true)
    return [];
  return UPDATE_ARGV.slice();
}

// ---------------------------------------------------------------- result --
//
// What came back from running one. This is the counterpart to
// `SourceJson.parse`, and it lives here for the same reason that one lives in
// the transport: the file that decides what may be run is the file that has to
// know what "it worked" looks like.
//
// `service:start` prints `Starting redis... OK` and exits 0, or `FAIL` on the
// same line followed by an indented reason, and exits 1. Both halves go to
// **stdout** — the reason is not on stderr — and both are wrapped in ANSI
// colour unconditionally, with no isatty check anywhere in the CLI. Stripping
// those escapes is therefore not defensive tidying: without it the panel would
// render `ESC[31mFAILESC[0m` at the user.
var ANSI_RE = /\u001b\[[0-9;]*m/g;

// A refusal is going on screen in a panel sized for a domain name. HubDev's own
// errors are short; a Docker daemon's are not, and one of those unwrapped would
// push the sections off the bottom.
var MESSAGE_MAX = 160;

function cleanMessage(text) {
  var t = (typeof text === "string" ? text : "").replace(ANSI_RE, "");
  var lines = t.split("\n");
  var best = "";
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].replace(/^\s+/, "").replace(/\s+$/, "");
    // Skip the "Starting redis... FAIL" banner: the panel already knows which
    // verb it ran and what it ran it on, and the reason is the line under it.
    if (!line || /^(Starting|Stopping|Restarting)\b.*\b(OK|FAIL)$/.test(line))
      continue;
    best = line;
  }
  if (best.length > MESSAGE_MAX)
    best = best.slice(0, MESSAGE_MAX - 1) + "…";
  return best;
}

function parseResult(stdout, exitCode) {
  if (exitCode === 0)
    return { ok: true, message: "" };

  // 127 is the shell's "not found"; Qt reports a failed spawn as -1 or -2. Same
  // wording as the read path, because it is the same fact about the machine and
  // the user should not have to notice which half of the plugin reported it.
  if (exitCode === 127 || exitCode < 0)
    return { ok: false, message: "HubDev is not installed" };

  var message = cleanMessage(stdout);
  return { ok: false, message: message || "HubDev exited with code " + exitCode };
}

// ------------------------------------------------------------------- keys --
//
// Where the keyboard cursor is allowed to be, and how it moves.
//
// This lives in Actions.js rather than in a file of its own because the only
// hard part of building the map is deciding what is *runnable*, and that gate
// is `siteArgv` — the same one the buttons dim on. A cursor that can stop on
// something inert is a dead end the user has to discover by pressing Enter and
// getting nothing, so the map simply does not contain those places.
//
// One entry per navigable row, in draw order. `cols` is what Left/Right walks:
// for a site, the row itself (`"open"`) followed by each action that would
// actually run; for the collapsed count, the single `"toggle"`.

// Array-like, checked by duck-typing. These lists round-trip through a QML
// `property var` on the way back in, and that turns a real Array into a
// QVariantList wrapper: it indexes and it has `.length`, but `Array.isArray`
// on it is FALSE and its array methods are not there. Index and `.length`
// only — never `.map`, never `.indexOf`.
function navList(v) {
  return v && typeof v === "object" && typeof v.length === "number" ? v : null;
}

function navClamp(v, lo, hi) {
  var n = typeof v === "number" && isFinite(v) ? Math.round(v) : 0;
  return n < lo ? lo : (n > hi ? hi : n);
}

// The cursor columns for one site row, in order: the row itself when it opens
// something, then each action that would actually run.
//
// The row calls this too, so the buttons and the map are built by the same
// code rather than by two rules that have to be kept in agreement.
function navCols(summary, site, url) {
  // The row itself is a column only when it opens something. Model.siteUrl
  // already decided that, and this has to give the same answer the click does
  // or Enter and a click would disagree on the same row.
  var cols = [];
  if (typeof url === "string" && url !== "")
    cols.push("open");

  var actions = siteActions();
  for (var i = 0; i < actions.length; i++) {
    if (siteArgv(summary, site, actions[i].key).length)
      cols.push(actions[i].key);
  }
  return cols;
}

// Where an action sits in those columns, or -1 when it is not one of them —
// which is also the button's `enabled`, since the two questions are the same.
function navColOf(cols, key) {
  var list = navList(cols);
  if (!list)
    return -1;
  for (var i = 0; i < list.length; i++) {
    if (list[i] === key)
      return i;
  }
  return -1;
}

function navSites(out, summary, rows) {
  var list = navList(rows);
  if (!list)
    return;
  for (var i = 0; i < list.length; i++) {
    var row = list[i] && typeof list[i] === "object" ? list[i] : {};
    var site = row.site;
    var ref = siteRef(site);
    if (!ref)
      continue;

    var cols = navCols(summary, site, row.url);
    if (!cols.length)
      continue;

    out.push({ key: "site:" + ref, kind: "site", site: site, cols: cols });
  }
}

// The cursor columns for one service row: each verb that would actually run,
// and nothing else.
//
// There is no `"open"` column here and that is the whole difference from a site
// row. A domain is a thing you go to; a service is not — pressing Enter on the
// row itself would have to mean one of start/stop/restart, and guessing which
// is exactly the guess a panel that runs things must never make. So the row is
// only ever a place the cursor passes through on its way to a button, and a
// service with no runnable verb (one that is not set up) has no columns and is
// therefore not in the map at all.
function navServiceCols(summary, service) {
  var cols = [];
  var actions = serviceActions();
  for (var i = 0; i < actions.length; i++) {
    if (serviceArgv(summary, service, actions[i].key).length)
      cols.push(actions[i].key);
  }
  return cols;
}

function navServices(out, summary, rows) {
  var list = navList(rows);
  if (!list)
    return;
  for (var i = 0; i < list.length; i++) {
    var row = list[i] && typeof list[i] === "object" ? list[i] : {};
    var service = row.service;
    var ref = serviceRef(service);
    if (!ref)
      continue;

    var cols = navServiceCols(summary, service);
    if (!cols.length)
      continue;

    out.push({ key: "svc:" + ref, kind: "service", site: null, service: service, cols: cols });
  }
}

// The cursor columns for one Environment row: each verb that would actually
// run, and nothing else — the same rule as a service row, and no `"open"`
// column for the same reason. A row with no target (a promoted health check, the
// Docker line, the diagnostics roll-up) has no columns and never enters the map.
function navEnvCols(summary, row) {
  var cols = [];
  var actions = envActions();
  for (var i = 0; i < actions.length; i++) {
    if (envArgv(summary, row, actions[i].key).length)
      cols.push(actions[i].key);
  }
  return cols;
}

// `rows` are Model.visibleEnv(...).rows — `{ row, spans }`, the same wrapper
// shape the site and service lists use, so all three sections hand the map the
// thing they are drawing rather than something adjacent to it.
function navEnv(out, summary, rows) {
  var list = navList(rows);
  if (!list)
    return;
  for (var i = 0; i < list.length; i++) {
    var entry = list[i] && typeof list[i] === "object" ? list[i] : {};
    var row = entry.row && typeof entry.row === "object" ? entry.row : {};
    var target = envTarget(row);
    if (!target)
      continue;

    var cols = navEnvCols(summary, row);
    if (!cols.length)
      continue;

    out.push({ key: "env:" + target, kind: "env", site: null, service: null, env: row, cols: cols });
  }
}

// `visible` is Model.visibleSites(...) and `services` is Model.visibleServices(...)
// — the panel's own draw order, so the cursor cannot drift out of step with what
// is on screen.
//
// Environment, then sites, then services — the dense view read top to bottom.
// The columns view puts them side by side, so there Down off the last site row
// lands at the top of the next column rather than below where it started. That
// is the honest consequence of one linear cursor over a two-column layout, and
// the alternative — spending Left/Right on moving between columns — would cost
// the row actions the keys they already use.
//
// All three arguments are the panel's own draw order — Model.visibleEnv,
// Model.visibleSites, Model.visibleServices — so the cursor cannot walk a row
// that is not on screen. Under a query that includes the Environment section,
// which narrows to the toggleable rows that matched rather than hiding.
function navRows(summary, visible, services, env) {
  var v = visible && typeof visible === "object" ? visible : {};
  var w = services && typeof services === "object" ? services : {};
  var e = env && typeof env === "object" ? env : {};
  var out = [];
  navEnv(out, summary, e.rows);
  navSites(out, summary, v.serving);
  if (v.collapse)
    out.push({ key: "sites:collapse", kind: "collapse", site: null, cols: ["toggle"] });
  navSites(out, summary, v.parked);
  navServices(out, summary, w.rows);
  return out;
}

function navIndexOf(rows, key) {
  var list = navList(rows);
  if (!list || typeof key !== "string" || key === "")
    return -1;
  for (var i = 0; i < list.length; i++) {
    if (list[i] && list[i].key === key)
      return i;
  }
  return -1;
}

function navAt(rows, key) {
  var i = navIndexOf(rows, key);
  return i < 0 ? null : navList(rows)[i];
}

// Move, and return where the cursor ends up. Never throws, never lands
// outside the map, and never invents a row that is not drawn.
//
// Deliberately clamps rather than wraps, in both directions. The list is
// re-derived from a snapshot that refreshes underneath it every few seconds,
// and clamping is the behaviour that never moves the cursor somewhere the
// user did not ask for. Down at the bottom does nothing, which is dull and
// correct.
function navMove(rows, key, col, dx, dy) {
  var list = navList(rows);
  if (!list || !list.length)
    return { key: "", col: 0 };

  var i = navIndexOf(list, key);
  if (i < 0) {
    // No cursor yet. The first arrow creates one at the end it came from, so
    // Up from nothing lands on the last row rather than jumping to the top.
    return { key: list[dy < 0 ? list.length - 1 : 0].key, col: 0 };
  }

  if (dy)
    i = navClamp(i + (dy > 0 ? 1 : -1), 0, list.length - 1);

  var cols = navList(list[i].cols);
  var span = cols ? cols.length : 0;
  // The column is kept across a vertical move and clamped to the new row —
  // walking down a column of terminal buttons is the point of having one.
  var c = navClamp(col, 0, span - 1);
  if (dx)
    c = navClamp(c + (dx > 0 ? 1 : -1), 0, span - 1);

  return { key: list[i].key, col: c };
}

// What Enter/Space on (key, col) means, resolved in one place so the panel
// only has to switch on the answer. null when the cursor points at nothing —
// a row that has since left the snapshot, most likely.
function navTarget(rows, key, col) {
  var item = navAt(rows, key);
  if (!item)
    return null;
  var cols = navList(item.cols);
  if (!cols || !cols.length)
    return null;
  return {
    kind: item.kind,
    site: item.site,
    // null on every row that is not of that kind, which is what lets the panel
    // switch on `kind` alone and never inspect the other fields.
    service: item.service || null,
    env: item.env || null,
    action: cols[navClamp(col, 0, cols.length - 1)]
  };
}
