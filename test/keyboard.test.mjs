// The keyboard cursor: the ordered map of what it can reach, and the rules for
// moving over it.
//
// The whole point of lifting this out of QML is that "what is the row below
// this one" becomes a question with an answer a test can check. It is also the
// question a view cannot answer honestly — under a search the list is re-ranked
// on every keystroke, and the row below is a different site than it was.
import { test } from "node:test";
import assert from "node:assert/strict";
import { load, fixture } from "./harness.mjs";

const Model = load("Model.js");
const Actions = load("Actions.js");

const healthy = Model.summarize(fixture("healthy"));
const NO_SEARCH = { active: false, sites: [], services: [] };

const listOf = (summary, expanded = false, search = NO_SEARCH) =>
  Model.visibleSites(summary, search, expanded);
const svcOf = (summary, expanded = false, search = NO_SEARCH) =>
  Model.visibleServices(summary, search, expanded);
// The whole map: sites, then services. The sweep at the foot of this file walks
// it end to end, so every service row is covered by the same "no dead ends"
// assertion the site rows have had since Phase 4c.
const navOf = (summary, expanded = false, search = NO_SEARCH) =>
  Actions.navRows(summary, listOf(summary, expanded, search), svcOf(summary, expanded, search));

// ------------------------------------------------------------ draw order --

test("the draw order is serving, then the collapsed count, then the parked", () => {
  const collapsed = listOf(healthy, false);
  assert.ok(collapsed.serving.length > 0);
  assert.equal(collapsed.parked.length, 0, "parked rows are not drawn while collapsed");
  assert.equal(collapsed.collapse.count, 1);
  assert.equal(collapsed.collapse.expanded, false);

  const open = listOf(healthy, true);
  assert.equal(open.serving.length, collapsed.serving.length);
  assert.equal(open.parked.length, 1);
  assert.equal(open.total, open.serving.length + open.parked.length);
});

test("serving rows are the active ones, and every row carries its own URL", () => {
  const list = listOf(healthy, true);
  for (const row of list.serving) assert.equal(row.site.active, true);
  for (const row of list.parked) assert.equal(row.site.active, false);
  // The URL decides whether the row is openable at all, so it has to be
  // resolved once, here, rather than twice with a chance of disagreeing.
  for (const row of list.serving.concat(list.parked))
    assert.equal(row.url, Model.siteUrl(row.site));
});

test("no collapsed row when nothing is parked", () => {
  const none = Model.summarize(fixture("no-sites"));
  const list = listOf(none, false);
  assert.equal(list.collapse, null);
  assert.equal(list.total, 0);
  assert.deepEqual(Actions.navRows(none, list), []);
});

test("a search flattens the split and drops the collapsed row entirely", () => {
  const search = Model.searchResults(healthy, "app");
  const list = listOf(healthy, false, search);
  assert.equal(list.searching, true);
  assert.equal(list.collapse, null, "a collapsed group is what was hiding the match");
  assert.equal(list.parked.length, 0);
  assert.equal(list.serving.length, search.sites.length);
  // Ranked, not re-sorted: the order is the search's, verbatim.
  assert.deepEqual(
    list.serving.map((r) => r.site.domain),
    search.sites.map((m) => m.site.domain)
  );
  // And the spans come through, or the matched letters could not be marked.
  assert.deepEqual(list.serving[0].spans, search.sites[0].spans);
});

// ------------------------------------------------------------ the columns --

test("column 0 is the row itself, then only the actions that would really run", () => {
  const rows = navOf(healthy);
  assert.deepEqual(rows[0].cols, ["open", "terminal", "folder", "editor"]);
  // Same answer whichever way it is asked — the row builds its buttons from
  // navCols and the map is built from the same call.
  const first = listOf(healthy).serving[0];
  assert.deepEqual(Actions.navCols(healthy, first.site, first.url), rows[0].cols);
});

test("a site the snapshot no longer lists is not a place the cursor can stop", () => {
  const stale = { name: "gone", domain: "gone.test", active: true, php: "8.4" };
  const list = { serving: [{ site: stale, spans: [], url: "https://gone.test" }],
                 parked: [], collapse: null, searching: false, total: 1 };
  const rows = Actions.navRows(healthy, list);
  // It still opens in a browser — that is Model.siteUrl's business, not the
  // snapshot's — but every hubdev verb is refused, so it has one column.
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].cols, ["open"]);
});

test("a row with no URL and no runnable action is left out of the map", () => {
  const unusable = { name: "--print", domain: "not a hostname", active: true };
  const list = { serving: [{ site: unusable, spans: [], url: "" }],
                 parked: [], collapse: null, searching: false, total: 1 };
  assert.deepEqual(Actions.navRows(healthy, list), []);
});

test("the collapsed count sits between the two groups, and only when drawn", () => {
  const collapsed = navOf(healthy, false);
  const at = collapsed.findIndex((r) => r.key === "sites:collapse");
  assert.ok(at > 0, "after the serving rows");
  assert.deepEqual(collapsed[at].cols, ["toggle"]);
  // Everything above it is a serving site; the parked ones are not drawn, so
  // whatever follows belongs to the next section rather than to Sites.
  assert.ok(collapsed.slice(0, at).every((r) => r.kind === "site"));
  assert.equal(collapsed.slice(at + 1).some((r) => r.kind === "site"), false);

  const open = navOf(healthy, true);
  const openAt = open.findIndex((r) => r.key === "sites:collapse");
  assert.equal(openAt, at, "still in the same place, after the serving rows");
  assert.ok(open.slice(openAt + 1).some((r) => r.kind === "site"),
            "and now with parked rows below it");

  const searching = navOf(healthy, false, Model.searchResults(healthy, "app"));
  assert.equal(searching.some((r) => r.kind === "collapse"), false);
});

test("keys are the site's reference, not its position", () => {
  const rows = navOf(healthy, true);
  const keys = rows.map((r) => r.key);
  assert.equal(new Set(keys).size, keys.length, "every key is unique");
  for (const row of rows.filter((r) => r.kind === "site"))
    assert.equal(row.key, "site:" + Actions.siteRef(row.site));
});

// ------------------------------------------------------------- the moving --

test("the first arrow creates the cursor at the end it came from", () => {
  const rows = navOf(healthy, true);
  assert.deepEqual(Actions.navMove(rows, "", 0, 0, 1), { key: rows[0].key, col: 0 });
  assert.deepEqual(Actions.navMove(rows, "", 0, 0, -1),
                   { key: rows[rows.length - 1].key, col: 0 });
  // Sideways with no cursor still has to land somewhere sane.
  assert.deepEqual(Actions.navMove(rows, "", 0, 1, 0), { key: rows[0].key, col: 0 });
});

test("a cursor on a row that has gone is rebuilt, not carried", () => {
  const rows = navOf(healthy);
  const moved = Actions.navMove(rows, "site:deleted-yesterday", 2, 0, 1);
  assert.equal(moved.key, rows[0].key);
  assert.equal(moved.col, 0, "and it does not keep the column of a row that is gone");
  assert.equal(Actions.navTarget(rows, "site:deleted-yesterday", 0), null);
});

test("up and down clamp at the ends rather than wrapping", () => {
  const rows = navOf(healthy, true);
  let at = { key: rows[0].key, col: 0 };
  for (let i = 0; i < 5; i++) at = Actions.navMove(rows, at.key, at.col, 0, -1);
  assert.equal(at.key, rows[0].key, "up at the top stays at the top");

  at = { key: rows[rows.length - 1].key, col: 0 };
  for (let i = 0; i < 5; i++) at = Actions.navMove(rows, at.key, at.col, 0, 1);
  assert.equal(at.key, rows[rows.length - 1].key);
});

test("left and right walk the row's actions and clamp inside it", () => {
  const rows = navOf(healthy);
  const cols = rows[0].cols;
  let at = { key: rows[0].key, col: 0 };
  for (let i = 1; i < cols.length; i++) {
    at = Actions.navMove(rows, at.key, at.col, 1, 0);
    assert.equal(at.col, i);
    assert.equal(at.key, rows[0].key, "sideways never changes row");
  }
  at = Actions.navMove(rows, at.key, at.col, 1, 0);
  assert.equal(at.col, cols.length - 1, "right at the last action stays there");

  for (let i = 0; i < cols.length + 3; i++) at = Actions.navMove(rows, at.key, at.col, -1, 0);
  assert.equal(at.col, 0, "and left walks back to the row itself");
});

test("the column is kept moving down a list, and clamped by the row it lands on", () => {
  const rows = navOf(healthy, true);
  const down = Actions.navMove(rows, rows[0].key, 2, 0, 1);
  assert.equal(down.key, rows[1].key);
  assert.equal(down.col, 2, "walking a column of terminal buttons is the point");

  // The collapsed row has exactly one column, so arriving on it clamps.
  const collapse = rows.find((r) => r.key === "sites:collapse");
  const above = rows[rows.indexOf(collapse) - 1];
  const onto = Actions.navMove(rows, above.key, 3, 0, 1);
  assert.equal(onto.key, "sites:collapse");
  assert.equal(onto.col, 0);
});

test("an out-of-range column is repaired rather than believed", () => {
  const rows = navOf(healthy);
  assert.equal(Actions.navMove(rows, rows[0].key, 99, 0, 0).col, rows[0].cols.length - 1);
  assert.equal(Actions.navMove(rows, rows[0].key, -5, 0, 0).col, 0);
  assert.equal(Actions.navMove(rows, rows[0].key, "nonsense", 0, 0).col, 0);
  assert.deepEqual(Actions.navMove([], "", 0, 0, 1), { key: "", col: 0 });
  assert.deepEqual(Actions.navMove(null, "", 0, 0, 1), { key: "", col: 0 });
});

// ---------------------------------------------------------- what it means --

test("navTarget says what Enter would do, and nothing else has to decide", () => {
  const rows = navOf(healthy, true);
  const site = rows[0];

  const open = Actions.navTarget(rows, site.key, 0);
  assert.equal(open.kind, "site");
  assert.equal(open.action, "open");
  assert.equal(open.site.domain, site.site.domain);

  const terminal = Actions.navTarget(rows, site.key, 1);
  assert.equal(terminal.action, "terminal");
  // And the action it names is one the allowlist will actually build an argv
  // for — the two must not be able to disagree.
  assert.ok(Actions.siteArgv(healthy, terminal.site, terminal.action).length > 0);

  const collapse = Actions.navTarget(rows, "sites:collapse", 0);
  assert.equal(collapse.kind, "collapse");
  assert.equal(collapse.action, "toggle");
  assert.equal(collapse.site, null);
});

test("navColOf is the button's own enabled, asked the other way round", () => {
  const rows = navOf(healthy);
  assert.equal(Actions.navColOf(rows[0].cols, "open"), 0);
  assert.equal(Actions.navColOf(rows[0].cols, "terminal"), 1);
  assert.equal(Actions.navColOf(rows[0].cols, "not-an-action"), -1);
  assert.equal(Actions.navColOf(null, "terminal"), -1);
  assert.equal(Actions.navColOf(["open"], "terminal"), -1);
});

// ------------------------------------------------------------ the boundary --

test("the map survives the round trip back out of QML", () => {
  // A QML `property var` hands a JS array back as a QVariantList wrapper: it
  // indexes and it has `.length`, but `Array.isArray` on it is FALSE. Every
  // one of these functions reads the map back out of exactly such a property,
  // so none of them may brand-check. This has already shipped one silently
  // broken feature; the stand-in is the cheapest possible guard against a
  // second.
  const asQml = (a) => {
    const out = { length: a.length };
    a.forEach((v, i) => { out[i] = Array.isArray(v) ? asQml(v) : v; });
    return out;
  };
  const rows = navOf(healthy, true);
  const wrapped = asQml(rows.map((r) => ({ ...r, cols: asQml(r.cols) })));

  assert.equal(Array.isArray(wrapped), false, "the stand-in must not be an Array");
  assert.equal(Array.isArray(wrapped[0].cols), false);

  assert.deepEqual(Actions.navMove(wrapped, rows[0].key, 0, 1, 0),
                   Actions.navMove(rows, rows[0].key, 0, 1, 0));
  assert.deepEqual(Actions.navMove(wrapped, "", 0, 0, -1),
                   Actions.navMove(rows, "", 0, 0, -1));
  assert.equal(Actions.navTarget(wrapped, rows[0].key, 1).action, "terminal");
  assert.equal(Actions.navColOf(wrapped[0].cols, "folder"), 2);
});

// ------------------------------------------------------------------ sweep --

test("every fixture produces a map the cursor can walk end to end", () => {
  for (const name of ["healthy", "all-stopped", "caddy-down", "docker-down",
                      "minimal", "no-sites", "license-inactive"]) {
    const s = Model.summarize(fixture(name));
    for (const expanded of [false, true]) {
      const rows = navOf(s, expanded);
      let at = Actions.navMove(rows, "", 0, 0, 1);
      for (let i = 0; i < rows.length + 4; i++) {
        // Every stop resolves to something runnable, on every row, in both
        // directions — a cursor that can reach a dead end is the bug.
        for (let c = 0; c < 6; c++) {
          const target = Actions.navTarget(rows, at.key, c);
          if (rows.length) assert.ok(target, `${name}/${expanded}: ${at.key} col ${c}`);
        }
        at = Actions.navMove(rows, at.key, at.col, 0, 1);
      }
      if (rows.length) assert.equal(at.key, rows[rows.length - 1].key, name);
    }
  }
});

// --------------------------------------------------------------- services --
//
// Phase 4e put buttons on the Services rows, which is what brought them into
// the map at all. The rules are the same ones the site rows follow; what is
// different is worth its own tests, because each difference was a decision.

test("services follow the sites, in the order the dense view stacks them", () => {
  const rows = navOf(healthy, true);
  const lastSite = rows.map((r) => r.kind).lastIndexOf("site");
  const firstService = rows.findIndex((r) => r.kind === "service");
  assert.ok(firstService > lastSite, "a service never comes before a site");
  assert.ok(rows.slice(firstService).every((r) => r.kind === "service"));
});

test("a service row has no open column — only the verbs that would run", () => {
  // The difference from a site row, and the reason for it: a domain is
  // somewhere to go, a service is not, and Enter on the row would have to
  // silently pick one of start/stop/restart.
  const running = navOf(healthy).find((r) => r.key === "svc:mysql");
  assert.deepEqual(running.cols, ["restart", "stop"]);
  assert.equal(running.cols.includes("open"), false);

  const down = navOf(Model.summarize(fixture("all-stopped"))).find((r) => r.key === "svc:mysql");
  assert.deepEqual(down.cols, ["start"]);
});

test("the cursor cannot stop on a service that was never set up", () => {
  // Not even with the group expanded: there is no verb `serviceArgv` will
  // build for one, so the row is not a place the cursor can reach.
  for (const expanded of [false, true]) {
    const rows = navOf(healthy, expanded);
    for (const name of ["meilisearch", "minio", "reverb"])
      assert.equal(rows.some((r) => r.key === `svc:${name}`), false, name);
  }
});

test("the not-set-up count is not a cursor stop, unlike the parked-sites one", () => {
  // Deliberate asymmetry: parked sites can be acted on once revealed, and
  // these cannot, so a cursor that could open the group would walk into a
  // group with nothing in it to press.
  const rows = navOf(healthy, true);
  assert.equal(rows.some((r) => r.key === "services:collapse"), false);
});

test("navTarget names the service, and never confuses it with a site", () => {
  const rows = navOf(healthy);
  const target = Actions.navTarget(rows, "svc:mysql", 1);
  assert.equal(target.kind, "service");
  assert.equal(target.site, null, "a service row carries no site");
  assert.equal(target.service.name, "mysql");
  assert.equal(target.action, "stop");
  // And the action it names is one the allowlist will really build an argv for.
  assert.ok(Actions.serviceArgv(healthy, target.service, target.action).length > 0);

  const site = Actions.navTarget(rows, rows[0].key, 0);
  assert.equal(site.kind, "site");
  assert.equal(site.service, null, "a site row carries no service");
});

test("arrows walk out of the site list and into the services", () => {
  const rows = navOf(healthy, true);
  const lastSite = rows[rows.map((r) => r.kind).lastIndexOf("site")];
  const next = Actions.navMove(rows, lastSite.key, 0, 0, 1);
  assert.equal(next.key.startsWith("svc:"), true);

  // And back, which is the property that matters: a section boundary must not
  // be a one-way door.
  const back = Actions.navMove(rows, next.key, next.col, 0, -1);
  assert.equal(back.key, lastSite.key);
});

test("the column is clamped when a two-button row follows a four-column one", () => {
  // A site row offers up to four columns and a service row two. Carrying the
  // column down would otherwise put the cursor off the end of the row it
  // lands on — which is the same clamp the site rows already rely on, now
  // across a section boundary where the widths genuinely differ.
  const rows = navOf(healthy, true);
  const lastSiteIndex = rows.map((r) => r.kind).lastIndexOf("site");
  const lastSite = rows[lastSiteIndex];
  assert.ok(lastSite.cols.length > 2);
  const next = Actions.navMove(rows, lastSite.key, lastSite.cols.length - 1, 0, 1);
  const landed = rows.find((r) => r.key === next.key);
  assert.equal(next.col, landed.cols.length - 1);
  assert.ok(Actions.navTarget(rows, next.key, next.col));
});

test("a machine with nothing running still offers every stopped service a start", () => {
  const s = Model.summarize(fixture("all-stopped"));
  const rows = navOf(s, true).filter((r) => r.kind === "service");
  assert.ok(rows.length > 0);
  for (const row of rows) {
    assert.deepEqual(row.cols, ["start"]);
    const target = Actions.navTarget(rows, row.key, 0);
    assert.deepEqual(Actions.serviceArgv(s, target.service, target.action),
                     ["hubdev", "service:start", target.service.name]);
  }
});

test("a search puts service rows in the map alongside the sites it matched", () => {
  // Finding a service by typing three letters and pressing Enter on its stop
  // button is the flow this exists for.
  const search = Model.searchResults(healthy, "redis");
  const rows = navOf(healthy, false, search);
  assert.ok(rows.some((r) => r.key === "svc:redis"));
});

// ------------------------------------------------------- visibleServices --

test("the service draw order is set up, then the count, then the rest", () => {
  const collapsed = Model.visibleServices(healthy, NO_SEARCH, false);
  assert.ok(collapsed.rows.length > 0);
  assert.equal(collapsed.others.length, 0, "hidden rows are not drawn");
  // Two, not three: `reverb` is set to auto-start, so it belongs to this
  // machine's setup and is listed — stopped, and with no buttons, because
  // starting it would mean installing a package first.
  assert.equal(collapsed.collapse.count, 2);
  assert.equal(collapsed.collapse.expanded, false);
  assert.match(collapsed.collapse.label, /^2 not set up$/);

  const open = Model.visibleServices(healthy, NO_SEARCH, true);
  assert.equal(open.rows.length, collapsed.rows.length);
  assert.equal(open.others.length, 2);
  assert.equal(open.total, open.rows.length + open.others.length);
});

test("no collapsed row when every service is set up", () => {
  const s = Model.summarize(fixture("minimal"));
  const list = Model.visibleServices(s, NO_SEARCH, false);
  assert.equal(list.collapse, null);
  assert.equal(list.total, 0);
});

test("a search flattens the services the same way it flattens the sites", () => {
  const search = Model.searchResults(healthy, "mini");
  const list = Model.visibleServices(healthy, search, false);
  assert.equal(list.searching, true);
  assert.equal(list.collapse, null, "the collapsed group is what was hiding it");
  // minio was never set up, and is found anyway — its row simply draws no
  // buttons.
  assert.ok(list.rows.some((r) => r.service.name === "minio"));
});

test("every row carries its own spans, so a view never has to look them up", () => {
  const search = Model.searchResults(healthy, "sql");
  const list = Model.visibleServices(healthy, search, false);
  for (const row of list.rows) assert.ok(Array.isArray(row.spans));
  for (const row of Model.visibleServices(healthy, NO_SEARCH, true).rows)
    assert.deepEqual(row.spans, []);
});
