import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Stops this repo from publishing what it was built from.
//
// The fixtures were captured on a machine full of client work, so the names,
// domains and paths of fifteen real projects were committed here and had to be
// scrubbed out of the history afterwards. This is the thing that makes that a
// one-off rather than a habit: it runs in the test suite, so any CI that runs
// `npm test` gates on it, and `.githooks/pre-commit` runs it on staged
// content before anything is written at all.
//
// THE DENYLIST IS HASHED, AND THAT IS THE WHOLE DESIGN. A scanner that held a
// list of client names in plaintext would be exactly the leak it exists to
// prevent -- the first file anyone greps. Tokens are hashed to 16 hex chars
// and compared; the plaintext mapping lives only in the gitignored
// `../hubdev-omarchy-buddy-docs/docs/lessons-learned/redaction-map.py`. A hit here tells you *that* a
// forbidden token is present and not what it is, which is enough to act on and
// harmless to publish.

const DENY = new Set([
  // A token that is not a client name and never appears in real data,
  // so the self-test can prove the hashing path fires without the test file
  // itself having to carry a client name in plaintext.
  "b14560fd06d8f436",   // the self-test canary; see test/privacy.test.mjs
// 39 hashed tokens
  "01afab73513d8ce0", "1840c1202faae4e7", "24717d9c5e99f707", "308ff2c118a5f84d",
  "3879779b74d74b6c", "3fe433b8de25d9b1", "446c8e19721bd4d5", "4adf60e0cf7d8154",
  "50d0258fed535276", "52518b1e5cd16341", "69db5ef9f1292ae4", "6bdd64748187bf26",
  "6dbe0bef73a06ec4", "6e669c7e00df14cd", "7417c858ef05656f", "74277f28450f67cf",
  "7561cf6e16d2d8f1", "8d4c45244bdf8bfa", "99c30a121b526589", "aa5bff177ed7f627",
  "b64e17062705b711", "c14e0dc621d1231b", "c50dd5fb2c177823", "c9057da98c8e9f5a",
  "c97b0f638e8a884b", "d0910e5a21df5c58", "d344ef7ca4ff328d", "d4968a290a7fbed6",
  "d7cb44643641e7b8", "d8e345cbe22dea1a", "dd792627342feb2a", "e1e4a76b1989ea51",
  "e5874895315df467", "e87558bfadebc2ef", "e95e4cf209d173ed", "eb1ff8e325773382",
  "ee9aa353170da9ab", "f75ee78253b97449", "fe27d8f4bcf64940",
]);

const h = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);

// Every rule names the fix, because a scanner that only says "no" gets
// disabled the first time it is inconvenient.
const RULES = [
  {
    id: "home-path",
    // /home/dev is the neutral stand-in the fixtures use. Anything else is a
    // real account name, and in a fixture it is also just wrong.
    re: /\/(?:home|Users)\/(?!dev\b)[A-Za-z0-9._-]+\//g,
    say: "a real home directory — use /home/dev in fixtures, ~ in prose"
  },
  {
    id: "client-folder",
    // Assembled from fragments so this file does not match its own rule and
    // fail the whole-tree scan. Not cleverness for its own sake: a scanner
    // that cannot be scanned has to be special-cased forever, and the
    // special case is what eventually lets something real through.
    re: new RegExp(["Current", "Clients"].join(""), "g"),
    say: "the client-work folder name — say ~/Projects/<app> instead"
  },
  {
    id: "private-key",
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
    say: "a private key block"
  },
  {
    id: "secret-value",
    // A secret-ish key with an actual value after it. Placeholders and the
    // R6 canaries in model.test.mjs are deliberately allowed.
    re: /\b(password|passwd|secret|api[_-]?key|access[_-]?token|private[_-]?key|license[_-]?key)\b\s*[:=]\s*(["']?)([^"'\s,}]{4,})/gi,
    allow: /SHOULD-NOT-APPEAR|<[^>]*>|\.\.\.|…|\$\{|example|redacted|placeholder/i,
    // Prose says things like "never emits a secret: services carry no
    // password". A bare short lowercase word is English, not a credential —
    // requiring a quote, a digit, a symbol or real length is what keeps this
    // rule quiet enough to stay switched on.
    reject: (m) => !m[2] && /^[a-z]{1,11}$/.test(m[3]),
    say: "a secret with a real-looking value (R6)"
  }
];

export function scanText(text, file) {
  const found = [];
  const lines = text.split("\n");

  lines.forEach((line, i) => {
    for (const rule of RULES) {
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(line)) !== null) {
        if (rule.allow && rule.allow.test(m[0])) continue;
        if (rule.reject && rule.reject(m)) continue;
        found.push({ file, line: i + 1, rule: rule.id, say: rule.say, at: m[0].slice(0, 60) });
      }
    }

    // Hashed tokens: bare words, and whole dev domains, which is how a
    // `client.lab` is caught without `client` alone crying wolf on prose.
    const tokens = [
      ...(line.toLowerCase().match(/[a-z0-9][a-z0-9_-]{3,}/g) || []),
      ...(line.toLowerCase().match(/[a-z0-9-]+\.(?:test|lab|craft|local)\b/g) || [])
    ];
    for (const t of tokens) {
      if (DENY.has(h(t))) {
        found.push({
          file, line: i + 1, rule: "denylisted-token",
          say: "a client project name — see ../hubdev-omarchy-buddy-docs/docs/lessons-learned/redaction-map.py",
          at: "<redacted: " + h(t).slice(0, 8) + ">"   // never echo the hit itself
        });
      }
    }
  });

  return found;
}

export function trackedFiles() {
  return execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

export function scanFiles(files) {
  const found = [];
  for (const f of files) {
    let t;
    try {
      t = readFileSync(f, "utf8");
    } catch {
      continue;   // deleted, or binary we cannot read as text
    }
    found.push(...scanText(t, f));
  }
  return found;
}

// CLI: no args scans every tracked file; --staged scans what is about to be
// committed, which is what the pre-commit hook wants.
if (import.meta.url === `file://${process.argv[1]}`) {
  const staged = process.argv.includes("--staged");
  const files = staged
    ? execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACM"],
        { encoding: "utf8" }).split("\n").filter(Boolean)
    : trackedFiles();

  const found = scanFiles(files);
  if (found.length) {
    console.error(`privacy-scan: ${found.length} finding(s) — this repo is public.\n`);
    for (const f of found)
      console.error(`  ${f.file}:${f.line}  [${f.rule}] ${f.say}\n      ${f.at}`);
    console.error("");
    process.exit(1);
  }
  console.log(`privacy-scan: clean (${files.length} files)`);
}
