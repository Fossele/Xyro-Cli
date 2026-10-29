import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runInWorkspace } from "../agent/workspace.js";
import {
  addAllowRule,
  addDenyRule,
  getPermissionMode,
  loadPermissions,
  matchesRule,
  projectSettingsPath,
  ruleFor,
  setPermissionMode,
} from "../config/permissions-store.js";
import { permissionVerdict, shouldAskPermission } from "../tools/permissions.js";
import { PermissionModal } from "../tui/overlays.js";
import { TuiApp } from "../tui/app.js";

let dir: string;
let previousNoApprove: string | undefined;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "xyro-perms-"));
  previousNoApprove = process.env.XYRO_NO_APPROVE;
  delete process.env.XYRO_NO_APPROVE;
});

afterEach(() => {
  if (previousNoApprove === undefined) delete process.env.XYRO_NO_APPROVE;
  else process.env.XYRO_NO_APPROVE = previousNoApprove;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("permission modes — verdict matrix", () => {
  it("asks for mutating tools in ask mode", () =>
    runInWorkspace(dir, async () => {
      setPermissionMode("ask");
      assert.equal(permissionVerdict("write_file", { path: "a.ts" }), "ask");
      assert.equal(permissionVerdict("run_command", { command: "ls" }), "ask");
      assert.equal(permissionVerdict("read_file", { path: "a.ts" }), "allow");
      assert.equal(shouldAskPermission("write_file", { path: "a.ts" }), true);
    }));

  it("accept-edits runs file edits but still asks for commands", () =>
    runInWorkspace(dir, async () => {
      setPermissionMode("accept-edits");
      assert.equal(permissionVerdict("write_file", { path: "a.ts" }), "allow");
      assert.equal(permissionVerdict("edit_file", { path: "a.ts" }), "allow");
      assert.equal(permissionVerdict("run_command", { command: "ls" }), "ask");
    }));

  it("plan mode is read-only: mutating tools are denied, not merely prompted", () =>
    runInWorkspace(dir, async () => {
      addAllowRule("write_file(src/*)");
      setPermissionMode("plan");
      assert.equal(permissionVerdict("read_file", { path: "a.ts" }), "allow");
      assert.equal(permissionVerdict("write_file", { path: "src/a.ts" }), "deny");
      assert.equal(permissionVerdict("run_command", { command: "ls" }), "deny");
      assert.equal(permissionVerdict("exit_plan"), "allow");
    }));

  it("yolo allows everything", () =>
    runInWorkspace(dir, async () => {
      setPermissionMode("yolo");
      assert.equal(permissionVerdict("run_command", { command: "rm -rf build" }), "allow");
    }));

  it("XYRO_NO_APPROVE still wins (scripts and CI)", () =>
    runInWorkspace(dir, async () => {
      setPermissionMode("plan");
      process.env.XYRO_NO_APPROVE = "1";
      assert.equal(permissionVerdict("write_file", { path: "a.ts" }), "allow");
    }));
});

describe("permission modes — persisted rules", () => {
  it("writes .xyro/settings.json inside the project, not the user config", () =>
    runInWorkspace(dir, async () => {
      setPermissionMode("accept-edits");
      assert.equal(getPermissionMode(), "accept-edits");
      const p = projectSettingsPath();
      assert.equal(p, path.join(dir, ".xyro", "settings.json"));
      assert.equal(fs.existsSync(p), true);
      assert.equal(loadPermissions().mode, "accept-edits");
    }));

  it("allow rules match exact commands and paths", () =>
    runInWorkspace(dir, async () => {
      const rule = ruleFor("run_command", { command: "npm test" });
      addAllowRule(rule);
      assert.equal(matchesRule(rule, "run_command", { command: "npm test" }), true);
      assert.equal(matchesRule(rule, "run_command", { command: "npm publish" }), false);
      assert.equal(permissionVerdict("run_command", { command: "npm test" }), "allow");
      assert.equal(permissionVerdict("run_command", { command: "npm publish" }), "ask");
    }));

  it("supports wildcards in rules", () =>
    runInWorkspace(dir, async () => {
      addAllowRule("run_command(npm test*)");
      assert.equal(permissionVerdict("run_command", { command: "npm test -- --watch" }), "allow");
      assert.equal(permissionVerdict("run_command", { command: "npm install" }), "ask");
    }));

  it("deny rules win over allow rules and yolo", () =>
    runInWorkspace(dir, async () => {
      addAllowRule("run_command(npm publish)");
      addDenyRule("run_command(npm publish)");
      setPermissionMode("yolo");
      assert.equal(permissionVerdict("run_command", { command: "npm publish" }), "deny");
      assert.equal(permissionVerdict("run_command", { command: "npm test" }), "allow");
    }));
});

describe("permission modes — TUI", () => {
  it("Shift+Tab cycles the mode through the app callback", () => {
    const app = new TuiApp();
    let calls = 0;
    app.onPermissionModeCycle(() => {
      calls++;
      app.setPermissionMode(calls === 1 ? "accept-edits" : "plan");
    });
    (app as unknown as { handleKey(k: string): void }).handleKey("\u001b[Z");
    assert.equal(calls, 1);
    (app as unknown as { handleKey(k: string): void }).handleKey("\u001b[Z");
    assert.equal(calls, 2);
  });

  it("footer shows the active permission mode", () => {
    const app = new TuiApp();
    app.setPermissionMode("yolo");
    const footer = (app as unknown as { footerLine(): { spans: { text: string }[] } }).footerLine();
    const text = footer.spans.map((s) => s.text).join("");
    assert.match(text, /YOLO/);
    app.setPermissionMode("plan");
    const plan = (app as unknown as { footerLine(): { spans: { text: string }[] } }).footerLine();
    assert.match(plan.spans.map((s) => s.text).join(""), /PLAN/);
  });

  it("the permission modal offers always-allow and returns it", async () => {
    const modal = new PermissionModal();
    const answer = modal.ask("run_command: npm test");
    assert.match(modal.render(100).map((l) => l.spans.map((s) => s.text).join("")).join("\n"), /always allow/);
    modal.handleKey("a");
    assert.equal(await answer, "always");
  });

  it("deny and escape still deny", async () => {
    const modal = new PermissionModal();
    const denied = modal.ask("run_command: rm -rf /");
    modal.handleKey("n");
    assert.equal(await denied, false);
    const escaped = modal.ask("run_command: rm -rf /");
    modal.handleKey("\u001b");
    assert.equal(await escaped, false);
  });
});
