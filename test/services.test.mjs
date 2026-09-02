// The service allowlist — start, stop, restart — and everything that decides
// whether one of them is allowed to reach the machine.
//
// These are the first verbs in this plugin that CHANGE something, so the tests
// are written the same way `actions.test.mjs` is written for the detached
// three: against the argv element by element, plus every refusal. The array
// asserted here is the array bash receives.

import { test } from "node:test";
import assert from "node:assert/strict";
import { load, fixture } from "./harness.mjs";

const Actions = load("Actions.js");
const Model = load("Model.js");

const healthy = Model.summarize(fixture("healthy"));
const stopped = Model.summarize(fixture("all-stopped"));
const mixed = Model.summarize(fixture("autostart-service-stopped"));

const byName = (s, name) => s.services.rows.find((r) => r.name === name);
const running = byName(healthy, "mysql");
const down = byName(mixed, "redis");
const neverSetUp = byName(healthy, "meilisearch");

// ------------------------------------------------------------- the table --

test("the allowlist is exactly start, restart and stop", () => {
  assert.deepEqual(
    Actions.serviceActions().map((a) => a.key),
    ["start", "restart", "stop"]
  );
});

test("every action carries an icon name, a label and its confirm rule", () => {
  for (const action of Actions.serviceActions()) {
    // Icon NAMES, never codepoints — Theme.js owns glyphs.
    assert.match(action.icon, /^[a-z-]+$/);
    assert.ok(action.label.length > 0, `${action.key} has no label`);
    assert.equal(typeof action.confirm, "boolean");
  }
});

test("the view never receives the argv, and cannot mutate the table", () => {
  const rows = Actions.serviceActions();
  for (const row of rows) {
    assert.equal(row.args, undefined);
    assert.equal(row.needs, undefined);
    assert.equal(row.timeout, undefined);
  }

  rows[0].key = "mutated";
  rows.push({ key: "injected" });
  assert.deepEqual(
    Actions.serviceActions().map((a) => a.key),
    ["start", "restart", "stop"]
  );
});

// -------------------------------------------------------------------- argv --

test("each key produces its exact command line", () => {
  assert.deepEqual(Actions.serviceArgv(healthy, running, "stop"), [
    "hubdev",
    "service:stop",
    "mysql"
  ]);
  assert.deepEqual(Actions.serviceArgv(healthy, running, "restart"), [
    "hubdev",
    "service:restart",
    "mysql"
  ]);
  assert.deepEqual(Actions.serviceArgv(mixed, down, "start"), [
    "hubdev",
    "service:start",
    "redis"
  ]);
});

test("the service name is always the last element, and hubdev the first", () => {
  for (const key of ["restart", "stop"]) {
    const argv = Actions.serviceArgv(healthy, running, key);
    assert.equal(argv[0], "hubdev");
    assert.equal(argv[argv.length - 1], "mysql");
  }
});

test("every service in every fixture resolves to exactly one verb set", () => {
  // The invariant that makes the row legible: a service offers start, or it
  // offers restart and stop, and never both sets at once — and a service this
  // machine never set up offers nothing.
  for (const name of ["healthy", "all-stopped", "autostart-service-stopped",
                      "caddy-down", "stopped-by-hubdev"]) {
    const s = Model.summarize(fixture(name));
    for (const row of s.services.rows) {
      const offered = Actions.serviceActions()
        .map((a) => a.key)
        .filter((k) => Actions.serviceArgv(s, row, k).length > 0);

      if (!row.configured) {
        assert.deepEqual(offered, [], `${name}/${row.name} was never set up here`);
      } else if (row.up) {
        assert.deepEqual(offered, ["restart", "stop"], `${name}/${row.name} is running`);
      } else if (row.startable) {
        assert.deepEqual(offered, ["start"], `${name}/${row.name} is stopped`);
      } else {
        // Configured, stopped, and starting it would mean installing a package
        // first. Listed, so it is not hidden, but not actionable from a bar.
        assert.deepEqual(offered, [], `${name}/${row.name} needs an install`);
      }
    }
  }
});

test("a service HubDev's own stop removed the container for can be started again", () => {
  // THE BUG THIS FILE WAS WRITTEN TWICE FOR. The first gate asked `installed`,
  // which HubDev flips to false on stop — so the panel could stop Redis and
  // then had no way to start it. Found by using it, not by the tests.
  const s = Model.summarize(fixture("stopped-by-hubdev"));
  for (const name of ["redis", "mailpit"]) {
    const row = s.services.rows.find((r) => r.name === name);
    assert.equal(row.immediate, false, "HubDev removed the container");
    assert.deepEqual(Actions.serviceArgv(s, row, "start"),
                     ["hubdev", "service:start", name]);
  }
});

// ---------------------------------------------------------------- refusals --

test("a verb the current state cannot use runs nothing", () => {
  // The two presses that could not possibly do anything. Note both are asked
  // of the SNAPSHOT's row, not the one handed in — see the stale-panel test.
  assert.deepEqual(Actions.serviceArgv(healthy, running, "start"), []);
  assert.deepEqual(Actions.serviceArgv(mixed, down, "stop"), []);
  assert.deepEqual(Actions.serviceArgv(mixed, down, "restart"), []);
});

test("a service that was never set up runs nothing at all", () => {
  // `service:start` on one of these is an image pull, minutes long — which is
  // out of scope for v1 (plan §5.3) and would make the timeouts a fiction.
  for (const key of ["start", "restart", "stop"]) {
    assert.deepEqual(Actions.serviceArgv(healthy, neverSetUp, key), []);
  }
});

test("a stale row is judged by the snapshot, not by itself", () => {
  // The panel has been open a while; the row it holds says "running" and the
  // machine has since disagreed. The gate must follow the machine.
  const staleRow = Object.assign({}, byName(healthy, "redis"));
  assert.equal(staleRow.up, true);
  assert.deepEqual(Actions.serviceArgv(stopped, staleRow, "stop"), []);
  assert.deepEqual(Actions.serviceArgv(stopped, staleRow, "start"), [
    "hubdev",
    "service:start",
    "redis"
  ]);
});

test("a service the snapshot does not list runs nothing", () => {
  const gone = { name: "elasticsearch", display: "Elasticsearch", up: true, installed: true };
  assert.deepEqual(Actions.serviceArgv(healthy, gone, "stop"), []);
  assert.deepEqual(Actions.serviceArgv(Model.empty(), running, "stop"), []);
  assert.deepEqual(Actions.serviceArgv({}, running, "stop"), []);
  assert.deepEqual(Actions.serviceArgv(null, running, "stop"), []);
});

test("an unknown verb runs nothing", () => {
  for (const key of ["", "reset", "logs", "service:reset", "autostart", null, undefined, 0]) {
    assert.deepEqual(Actions.serviceArgv(healthy, running, key), []);
  }
});

test("a garbage service object runs nothing", () => {
  for (const bad of [null, undefined, {}, [], "redis", 42, { name: 42 }]) {
    assert.deepEqual(Actions.serviceArgv(healthy, bad, "stop"), []);
  }
});

test("nothing that could be read as a flag or a path becomes the argument", () => {
  // Same rule and same reason as siteRef: `hubdev` parses its own flags out of
  // the argv it is handed. A service has no second identity to fall back to.
  for (const name of ["--print", "-q", "../../etc", "~/x", "/etc/passwd", ".env"]) {
    assert.equal(Actions.serviceRef({ name }), "");
  }
  for (const name of ["svc; rm -rf /", "svc && curl evil", "svc$(id)", "svc`id`", "svc svc"]) {
    assert.equal(Actions.serviceRef({ name }), "");
  }
  assert.equal(Actions.serviceRef({ name: "", display: "Redis" }), "");
});

test("display is never used as an argument, however unusable the name is", () => {
  // "SQL Server" has a space in it. A fallback to `display` would be a fallback
  // to something that was never an identifier.
  assert.equal(Actions.serviceRef({ name: "-x", display: "SQL Server" }), "");
});

// ----------------------------------------------------------------- gating --

test("only stop arms, and the reason is that only stop leaves things down", () => {
  assert.equal(Actions.needsConfirm("stop"), true);
  assert.equal(Actions.needsConfirm("start"), false);
  assert.equal(Actions.needsConfirm("restart"), false);
  assert.equal(Actions.needsConfirm("nonsense"), false);
});

test("the confirm token names the button, not the row", () => {
  // Arming is per button: pressing a different one on the same row must re-arm
  // rather than fire, which only works if the token carries the verb.
  assert.notEqual(
    Actions.confirmToken("mysql", "stop"),
    Actions.confirmToken("mysql", "restart")
  );
  assert.notEqual(
    Actions.confirmToken("mysql", "stop"),
    Actions.confirmToken("redis", "stop")
  );
  // An empty half can never match a real token, so a cleared gate is cleared.
  assert.equal(Actions.confirmToken("", "stop"), "");
  assert.equal(Actions.confirmToken("mysql", ""), "");
  assert.equal(Actions.confirmToken(null, undefined), "");
});

test("every verb has a hard ceiling, and a stop waits less than a start", () => {
  for (const action of Actions.serviceActions()) {
    const ms = Actions.timeoutMs(action.key);
    assert.ok(ms > 0, `${action.key} has no timeout`);
    // Generous next to the 15s snapshot timeout, because a container start is
    // genuinely slow — but not unbounded, because the whole point of the guard
    // is that a polkit dialog cannot hold the child forever (plan §7.1).
    assert.ok(ms <= 120000, `${action.key} waits too long`);
  }
  assert.ok(Actions.timeoutMs("stop") < Actions.timeoutMs("start"));
  // An unknown verb still gets a ceiling — the Process must never be started
  // without one, whatever the caller passed.
  assert.ok(Actions.timeoutMs("nonsense") > 0);
});

test("the label names the verb and the service, in that order", () => {
  assert.equal(Actions.serviceActionLabel("stop", "SQL Server"), "Stop SQL Server");
  assert.equal(Actions.serviceActionLabel("restart", "Redis"), "Restart Redis");
  // No display to use: the verb alone still reads.
  assert.equal(Actions.serviceActionLabel("start", ""), "Start");
  assert.equal(Actions.serviceActionLabel("nonsense", "Redis"), "Redis");
});

// ----------------------------------------------------------------- result --

const ESC = "\u001b";
const ok = (verb, name) => `${verb} ${name}... ${ESC}[32mOK${ESC}[0m\n`;
const fail = (verb, name, why) =>
  `${verb} ${name}... ${ESC}[31mFAIL${ESC}[0m\n  ${why}\n`;

test("exit 0 is success, whatever was printed", () => {
  assert.deepEqual(Actions.parseResult(ok("Starting", "redis"), 0), { ok: true, message: "" });
  assert.deepEqual(Actions.parseResult("", 0), { ok: true, message: "" });
});

test("the reason is taken off stdout, where HubDev actually puts it", () => {
  // Not stderr. cli_services.go writes the error with Fprintf(os.Stdout, ...),
  // so a parser reading stderr would report every failure as silent.
  const r = Actions.parseResult(fail("Starting", "redis", "docker daemon not reachable"), 1);
  assert.equal(r.ok, false);
  assert.equal(r.message, "docker daemon not reachable");
});

test("ANSI colour never reaches the panel", () => {
  // The CLI colours unconditionally — there is no isatty check anywhere in it —
  // so without stripping, the user would read "ESC[31mFAILESC[0m" on screen.
  const r = Actions.parseResult(fail("Stopping", "mysql", `${ESC}[1mport 3306 still bound${ESC}[0m`), 1);
  assert.equal(r.message, "port 3306 still bound");
  assert.doesNotMatch(r.message, /\u001b/);
  assert.doesNotMatch(r.message, /\[[0-9;]*m/);
});

test("the banner line is not the reason, and is never reported as one", () => {
  // "Starting redis... FAIL" says nothing the panel does not already know.
  for (const verb of ["Starting", "Stopping", "Restarting"]) {
    const r = Actions.parseResult(`${verb} redis... FAIL\n`, 1);
    assert.equal(r.ok, false);
    assert.equal(r.message, "HubDev exited with code 1");
  }
});

test("a missing binary reads the same on both halves of the plugin", () => {
  for (const code of [127, -1, -2]) {
    assert.deepEqual(Actions.parseResult("", code), {
      ok: false,
      message: "HubDev is not installed"
    });
  }
});

test("a runaway error is cut, not allowed to push the panel off the screen", () => {
  const r = Actions.parseResult(fail("Starting", "mysql", "x".repeat(4000)), 1);
  assert.ok(r.message.length <= 160, `message is ${r.message.length} chars`);
  assert.match(r.message, /…$/);
});

test("a failure always says something, even when HubDev says nothing", () => {
  const r = Actions.parseResult("", 1);
  assert.equal(r.ok, false);
  assert.ok(r.message.length > 0);
});

test("parseResult never throws, whatever it is handed", () => {
  for (const bad of [null, undefined, 42, {}, []]) {
    assert.equal(Actions.parseResult(bad, 1).ok, false);
    assert.equal(Actions.parseResult(bad, 0).ok, true);
  }
});

// ---------------------------------------------------------------- privacy --

test("no service argv ever carries anything but the binary, the verb and the name", () => {
  // R6, same sweep the site actions get: nothing that looks like a path, and
  // nothing that was not already a public identifier.
  for (const name of ["healthy", "all-stopped", "autostart-service-stopped"]) {
    const s = Model.summarize(fixture(name));
    for (const row of s.services.rows) {
      for (const action of Actions.serviceActions()) {
        const argv = Actions.serviceArgv(s, row, action.key);
        for (const arg of argv) assert.doesNotMatch(arg, /\//, `"${arg}" looks like a path`);
        if (argv.length) assert.equal(argv.length, 3);
      }
    }
  }
});
