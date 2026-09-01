import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { scanText, scanFiles, trackedFiles } from "../tools/privacy-scan.mjs";

// This repo is public, and it was built from a machine full of client work.
// The fixtures once carried fifteen real client names, domains and paths, and
// removing them meant rewriting eleven commits. This test is what makes that a
// one-off: it runs in the same `npm test` any CI runs.
//
// NOTE ON THIS FILE. A test for a leak scanner must not itself contain leaks —
// the first draft did, and the pre-commit hook rejected it, which is the most
// useful thing the guard has done so far. So every sample below is either the
// synthetic canary or assembled from fragments at runtime, and this file scans
// clean like any other.

// Assembled, not written: the canary is on the denylist, so spelling it out
// here would make this file fail the very scan it is testing.
const CANARY = ["privacy", "scan", "selftest", "canary"].join("-");

test("no tracked file leaks a client project, a real home path, or a secret", () => {
  const found = scanFiles(trackedFiles());
  const report = found.map((f) => `${f.file}:${f.line} [${f.rule}] ${f.say}`).join("\n");
  assert.equal(found.length, 0, `privacy-scan found ${found.length}:\n${report}`);
});

// A guard nobody has watched fire is a guess. One case per rule.
test("the scanner catches every shape it claims to", () => {
  const mustCatch = [
    [`{"domain": "${CANARY}"}`, "denylisted-token"],
    [`{"path": "/${"home"}/someone/Projects/x"}`, "home-path"],
    [`cloned at ~/Projects/${["Current", "Clients"].join("")}/x`, "client-folder"],
    [`${"pass"}word: "s3cr3t-real-value"`, "secret-value"],
    [`-----BEGIN RSA ${"PRIVATE"} KEY-----`, "private-key"]
  ];
  for (const [line, rule] of mustCatch) {
    const rules = scanText(line, "planted").map((f) => f.rule);
    assert.ok(rules.includes(rule), `missed ${rule}`);
  }
});

// The other half of a usable scanner. A rule that fires on ordinary prose gets
// switched off the first time it is inconvenient, and then guards nothing.
test("the scanner stays quiet on the redacted fixtures and on prose", () => {
  const mustNotFire = [
    '{"domain": "beacon.lab"}',
    '{"domain": "sonata.craft"}',
    '{"path": "/home/dev/Projects/Beacon/beacon-main-web"}',
    "Never emits a secret: services carry no `password`.",
    'password: "hunter2-SHOULD-NOT-APPEAR",',
    "hubdev.test and terminal-radio.test are ours and stay"
  ];
  for (const line of mustNotFire) {
    const found = scanText(line, "quiet");
    assert.equal(found.length, 0, `false positive: ${line} -> ${JSON.stringify(found)}`);
  }
});

// The canary proves the hashing path works; only the real map proves the
// denylist has the real names in it. That file is gitignored, so this check
// covers the developer's machine and skips everywhere else rather than
// pretending to cover what it cannot see.
test("the denylist actually contains the names that were removed", { skip: !existsSync("docs/lessons-learned/redaction-map.py") }, () => {
  const map = readFileSync("docs/lessons-learned/redaction-map.py", "utf8");
  const olds = [...map.matchAll(/\(\s*"([a-z0-9-]+)",\s*"([a-z0-9-]+\.(?:test|lab|craft))"/g)]
    .map((m) => m[2])
    .filter((d) => !d.startsWith("hubdev") && !d.startsWith("terminal-radio"));

  assert.ok(olds.length >= 10, `expected the full site list, saw ${olds.length}`);
  for (const domain of olds) {
    const rules = scanText(`{"domain": "${domain}"}`, "map").map((f) => f.rule);
    assert.ok(rules.includes("denylisted-token"), "a removed domain is not on the denylist");
  }
});
