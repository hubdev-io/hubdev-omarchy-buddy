import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Runs `omarchy plugin validate` on what would be published, not on the
// working tree.
//
// `omarchy plugin add` clones the repository and validates the clone, so the
// tree a user receives is exactly the tracked files. A working tree carries
// more than that: git-ignored agent tooling, editor state, node_modules. The
// validator refuses any symlink anywhere in the folder, so one ignored link
// under `.claude/` fails `omarchy plugin validate .` for a reason no user will
// ever hit, and hides the reasons they would.
//
// This exports the index (`git checkout-index`), which is what the next commit
// would contain, so it is correct both as `npm run validate` and from the
// pre-commit hook. Exits with the validator's status.

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const dir = mkdtempSync(join(tmpdir(), "hubdev-buddy-validate-"));

let status = 0;
try {
  execFileSync("git", ["checkout-index", "--all", "--force", `--prefix=${dir}/`], { cwd: root });
  execFileSync("omarchy-plugin-validate", [dir], { stdio: "inherit" });
  console.log("omarchy plugin validate: ok (the tracked tree, as `omarchy plugin add` sees it)");
} catch (err) {
  if (err.code === "ENOENT") {
    console.error("validate: omarchy-plugin-validate not found -- run this on an Omarchy Quattro machine");
  }
  status = err.status ?? 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
process.exit(status);
