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
