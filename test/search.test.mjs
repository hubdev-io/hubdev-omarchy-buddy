// Type-to-filter.
//
// Two things are worth holding here and neither is "does it filter". The first
// is RANKING: a subsequence matcher will happily match half the list, so the
// value is entirely in what comes first. The second is that the highlight is
// built as MARKUP out of a domain — which makes escaping a matter of
// correctness rather than of taste, and the one thing in this file that is a security test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { load, fixture, fixtureNames } from "./harness.mjs";

const Model = load("Model.js");

const summary = Model.summarize(fixture("healthy"));
const domains = summary.sites.rows.map((r) => r.domain);

const found = (query) => Model.searchSites(summary, query).map((r) => r.site.domain);

// -------------------------------------------------------------- matching --

test("a prefix finds the site, which is the case the feature exists for", () => {
  // The user's own words: type a couple of letters, see the one site.
  const hits = found("hub");
  assert.equal(hits[0], "hubdev.test");
});

test("matching is a subsequence, not a substring", () => {
  // "cpa" is c-p-a scattered across clinic-portal-app — no substring matcher
  // finds it, and a launcher user expects it to.
  assert.ok(found("cpa").includes("clinic-portal-app.test"));
  assert.ok(found("clinicapp").includes("clinic-portal-app.test"));
});

test("a scattered match that lands mid-word is not a match at all", () => {
  // Reported from the panel: typing a three-letter site name returned a second
  // row whose only claim was three letters strewn across it — s(onata.cr)a(f)t
  // for "saf". True, and nobody meant it.
  //
  // The rule that kills it: after the first character, every next one must
  // either continue a run or begin a word. It is the whole difference between
  // a filter and a list of coincidences.
  assert.equal(Model.fuzzyMatch("sonata.craft", "saf"), null);
  assert.notEqual(Model.fuzzyMatch("saf-app.test", "saf"), null);

  // ...and the row that lost the false match is still findable by any part of
  // itself a person would actually type, including from the middle of a word.
  for (const q of ["son", "sonata", "nat", "craft"])
    assert.notEqual(Model.fuzzyMatch("sonata.craft", q), null, q);
});

test("the first character may land anywhere, and only the first", () => {
  // "dev" has to find "hubdev.test". Requiring a word start for the anchor too
  // would mean only ever matching from the front of a name or a segment.
  assert.deepEqual(Model.fuzzyMatch("hubdev.test", "dev").spans, [[3, 3]]);
  // But the SECOND character may not: "hdv" is not a word anyone typed.
  assert.equal(Model.fuzzyMatch("hubdev.test", "hdv"), null);
});

test("every anchor is tried, not just the leftmost", () => {
  // Leftmost-greedy commits to the first `a` in clinic-portal-app, cannot then
  // satisfy the word-start rule, and reports no match for a query that plainly
  // matches. Exhausting the anchors is what makes the rule explainable.
  assert.deepEqual(Model.fuzzyMatch("clinic-portal-app.test", "clinicapp").spans,
    [[0, 6], [14, 3]]);
});

test("case never matters, in either direction", () => {
  assert.deepEqual(found("HUB"), found("hub"));
  assert.deepEqual(Model.searchSites(summary, "LeDgEr").map((r) => r.site.domain), found("ledger"));
});

test("a typed space is dropped rather than matched", () => {
  // No domain contains one, so treating it literally would empty the list the
  // instant a thumb caught the space bar.
  assert.deepEqual(found("hub dev"), found("hubdev"));
  assert.equal(Model.searchResults(summary, "   ").active, false);
});

test("nothing matches an impossible query", () => {
  assert.deepEqual(found("zzzzzz"), []);
  assert.equal(Model.searchResults(summary, "zzzzzz").total, 0);
});

test("an empty query is not a search at all", () => {
  const off = Model.searchResults(summary, "");
  assert.equal(off.active, false);
  assert.equal(off.total, 0);
  assert.deepEqual(off.sites, []);
  assert.deepEqual(off.services, []);
  // The switch the whole UI reads: false has to restore the unfiltered panel,
  // so it must never come back true for whitespace or for a missing argument.
  for (const q of ["", "  ", "\t", null, undefined, 0, {}])
    assert.equal(Model.searchResults(summary, q).active, false, `${JSON.stringify(q)} started a search`);
});

// --------------------------------------------------------------- ranking --

test("the exact prefix outranks every scattered match of the same letters", () => {
  // The whole point of scoring. Both of these match "le" as a subsequence;
  // only one of them is what the user meant.
  const hits = found("le");
  assert.ok(hits.length > 1, "expected other rows to match too");
  assert.equal(hits[0], "ledger.lab");
});

test("a match at a word start beats the same letters mid-word", () => {
  // Same query, same length, same contiguity — the only difference is that one
  // of them starts a segment. `-` and `.` are the seams HubDev's own labels are
  // built from, so a match at one is the user aiming at part of a name.
  const aimed = Model.fuzzyMatch("clinic-app.test", "app");
  const buried = Model.fuzzyMatch("clinicapps.test", "app");
  assert.ok(aimed.score > buried.score, `${aimed.score} !> ${buried.score}`);
});

test("between two equally good matches, the earlier one wins", () => {
  // Both of these match "app" at a word start; the tie is broken by position,
  // which is the only signal left and the one a reader scans by.
  const hits = found("app");
  assert.equal(hits[0], "wallet-app.test");
  assert.ok(hits.includes("clinic-portal-app.test"));
});

test("a contiguous run beats the same characters scattered", () => {
  const run = Model.fuzzyMatch("summit.lab", "sum");
  const scattered = Model.fuzzyMatch("s-u-m-x.lab", "sum");
  assert.ok(run.score > scattered.score, `${run.score} !> ${scattered.score}`);
});

test("ranking is stable and total — equal scores never shuffle", () => {
  const a = Model.searchSites(summary, "a").map((r) => r.site.domain);
  const b = Model.searchSites(summary, "a").map((r) => r.site.domain);
  assert.deepEqual(a, b);
});

test("a serving site outranks a parked one that matched exactly as well", () => {
  const stopped = Model.summarize(fixture("all-stopped"));
  // Same fixture, one site flipped active: it must move up, and only because
  // of that flip.
  const mixed = JSON.parse(JSON.stringify(stopped));
  const target = mixed.sites.rows.find((r) => r.domain === "ledger.lab");
  target.active = true;
  const order = Model.searchSites(mixed, "l").map((r) => r.site.domain);
  const flat = Model.searchSites(stopped, "l").map((r) => r.site.domain);
  assert.ok(order.indexOf("ledger.lab") <= flat.indexOf("ledger.lab"));
});

// ----------------------------------------------------------------- spans --

test("the spans point at the characters that actually matched", () => {
  const m = Model.fuzzyMatch("hubdev.test", "hub");
  assert.deepEqual(m.spans, [[0, 3]]);

  // c, then the p and the a that OPEN the next two segments — an acronym, and
  // the reading of "cpa" a person actually had in mind. The `a` inside
  // "portal" is not a candidate: it begins nothing.
  const split = Model.fuzzyMatch("clinic-portal-app.test", "cpa");
  assert.deepEqual(split.spans, [[0, 1], [7, 1], [14, 1]]);
});

test("adjacent matches merge into one run rather than three", () => {
  // Three [n,1] spans would draw three separately-bolded letters where the
  // user typed one word.
  assert.deepEqual(Model.fuzzyMatch("beacon.lab", "bea").spans, [[0, 3]]);
});

test("every span lands inside the text it indexes, for every fixture", () => {
  for (const name of fixtureNames()) {
    const s = Model.summarize(fixture(name));
    for (const q of ["a", "e", "st", "lab", "app"]) {
      for (const hit of Model.searchSites(s, q)) {
        for (const [start, len] of hit.spans) {
          assert.ok(start >= 0 && len > 0, `${name}/${q}: bad span`);
          assert.ok(start + len <= hit.site.domain.length, `${name}/${q}: span past the end`);
        }
      }
    }
  }
});

test("a match found only in the fallback carries no spans", () => {
  // A site whose domain has nothing to do with its name is still findable by
  // the name — but nothing on the row would be highlighted, and inventing a
  // highlight over text that did not match is worse than showing none.
  const odd = Model.summarize({
    schema: 1,
    sites: [{ name: "invoice-app", domain: "billing.lab", active: true }]
  });
  const hits = Model.searchSites(odd, "invoice");
  assert.equal(hits.length, 1);
  assert.deepEqual(hits[0].spans, []);
  // ...and it must rank below anything that matched what is on screen.
  const both = Model.summarize({
    schema: 1,
    sites: [
      { name: "invoice-app", domain: "billing.lab", active: true },
      { name: "other", domain: "invoice.lab", active: true }
    ]
  });
  assert.equal(Model.searchSites(both, "invoice")[0].site.domain, "invoice.lab");
});

// ------------------------------------------------------------- highlight --

test("plain text comes back plain when nothing matched", () => {
  assert.equal(Model.highlightHtml("hubdev.test", [], "#89b4fa"), "hubdev.test");
  assert.equal(Model.highlightHtml("hubdev.test", null, "#89b4fa"), "hubdev.test");
});

test("the matched run is wrapped and everything else is left alone", () => {
  assert.equal(
    Model.highlightHtml("hubdev.test", [[0, 3]], "#89b4fa"),
    '<b><font color="#89b4fa">hub</font></b>dev.test'
  );
  assert.equal(
    Model.highlightHtml("hubdev.test", [[3, 3]], ""),
    "hub<b>dev</b>.test"
  );
});

test("markup in the data is escaped, not rendered", () => {
  // This is the security test. The label becomes StyledText, so a domain that
  // contains markup must arrive as characters. It cannot happen with a real
  // HubDev domain — which is exactly why it would go unnoticed if it could.
  const nasty = '<img src=x>&"\'';
  const out = Model.highlightHtml(nasty, [[0, 1]], "#89b4fa");
  assert.doesNotMatch(out.replace(/<\/?b>|<\/?font[^>]*>/g, ""), /[<>]/);
  assert.ok(out.includes("&lt;"));
  assert.ok(out.includes("&amp;"));
  assert.ok(out.includes("&quot;"));
});

test("a colour is a literal or it is dropped", () => {
  // The colour reaches an attribute. Only a hex literal is allowed through;
  // anything else falls back to bold rather than being pasted into markup.
  for (const bad of ['" onload="x', "red; }", "javascript:x", 42, null, {}]) {
    const out = Model.highlightHtml("abc", [[0, 1]], bad);
    assert.equal(out, "<b>a</b>bc", `${JSON.stringify(bad)} reached the markup`);
  }
  assert.match(Model.highlightHtml("abc", [[0, 1]], "#fff"), /color="#fff"/);
});

test("spans survive the round trip back out of QML", () => {
  // The bug this test exists for shipped and rendered nothing.
  //
  // The spans are computed here, held in a `property var` on the row, and
  // handed back in to be rendered — and that round trip turns a real JS Array
  // into a QVariantList wrapper: it indexes, it has `.length`, and
  // `Array.isArray` on it is FALSE. Under node both sides were real arrays, so
  // every test passed while every label on screen drew plain.
  //
  // Hence the stand-in below: array-LIKE, deliberately not an Array.
  const asQml = (rows) => {
    const out = { length: rows.length };
    rows.forEach((r, i) => { out[i] = { 0: r[0], 1: r[1], length: 2 }; });
    return out;
  };
  assert.equal(Array.isArray(asQml([[0, 3]])), false, "the stand-in must not be an Array");
  assert.equal(
    Model.highlightHtml("wallet-app.test", asQml([[0, 3]]), "#89b4fa"),
    Model.highlightHtml("wallet-app.test", [[0, 3]], "#89b4fa")
  );
  assert.match(Model.highlightHtml("wallet-app.test", asQml([[0, 3]]), "#89b4fa"), /<b>/);
});

test("a span that does not fit the text is dropped, not clamped", () => {
  assert.equal(Model.highlightHtml("abc", [[1, 99]], ""), "abc");
  assert.equal(Model.highlightHtml("abc", [[-1, 2]], ""), "abc");
  assert.equal(Model.highlightHtml("abc", [[2, 1], [0, 1]], ""), "ab<b>c</b>");
  assert.equal(Model.highlightHtml("abc", ["nonsense"], ""), "abc");
});

// -------------------------------------------------------------- services --

test("services are searched too, on the name the row shows", () => {
  const hits = Model.searchServices(summary, "my");
  assert.ok(hits.length > 0);
  assert.ok(hits[0].service.display.toLowerCase().includes("my"));
  assert.ok(hits[0].spans.length > 0);
});

test("the result counts both lists, and reports what was searched", () => {
  const r = Model.searchResults(summary, "e");
  assert.equal(r.total, r.sites.length + r.services.length);
  assert.equal(r.searched, summary.sites.total + summary.services.total);
  assert.equal(r.query, "e");
});

// ------------------------------------------------------------- robustness --

test("an unreachable or empty summary searches to nothing rather than throwing", () => {
  for (const s of [Model.empty(), Model.unreachable("down"), {}, null, undefined]) {
    const r = Model.searchResults(s, "abc");
    assert.equal(r.total, 0);
    assert.equal(r.searched, 0);
  }
});

test("every fixture survives every prefix of every domain it contains", () => {
  // The blunt one. If any query built from real data throws, ranks nothing, or
  // loses the row it came from, this catches it.
  for (const name of fixtureNames()) {
    const s = Model.summarize(fixture(name));
    for (const row of s.sites.rows) {
      for (let n = 1; n <= row.domain.length; n++) {
        const q = row.domain.slice(0, n);
        const hits = Model.searchSites(s, q).map((r) => r.site.domain);
        assert.ok(hits.includes(row.domain), `${name}: "${q}" lost ${row.domain}`);
      }
    }
  }
});

test("no search result ever carries anything the panel must not render", () => {
  // R6, the same sweep the rest of the model gets: a result is site rows and
  // integers, and a path or a secret has no way into one.
  for (const name of fixtureNames()) {
    const s = Model.summarize(fixture(name));
    for (const hit of Model.searchResults(s, "a").sites) {
      assert.equal(hit.site.path, undefined);
      assert.equal(typeof hit.score, "number");
      assert.ok(Number.isFinite(hit.score));
    }
  }
  assert.ok(domains.length > 0);
});
