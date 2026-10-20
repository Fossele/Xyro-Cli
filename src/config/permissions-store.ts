import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getConfigDir } from "./platform.js";

export type PermissionRule = {
  pattern: string;
  tool?: string;
};

export type PersistedPermissions = {
  allow?: string[];
  deny?: string[];
  /** Permission mode: ask, accept-edits, plan, yolo */
  mode?: "ask" | "accept-edits" | "plan" | "yolo";
};

function permissionsPath(): string {
  return join(getConfigDir(), "settings.json");
}

function tightenFile(p: string): void {
  try {
    if (process.platform !== "win32" && existsSync(p) && (require("fs").statSync(p).mode & 0o077) !== 0) {
      require("fs").chmodSync(p, 0o600);
    }
  } catch {
    // best effort
  }
}

export function loadPermissions(): PersistedPermissions {
  try {
    const p = permissionsPath();
    if (!existsSync(p)) return {};
    const data = readFileSync(p, "utf-8");
    return JSON.parse(data) as PersistedPermissions;
  } catch {
    return {};
  }
}

export function savePermissions(perms: Partial<PersistedPermissions>): void {
  const dir = getConfigDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const existing = loadPermissions();
  const merged: PersistedPermissions = {
    ...existing,
    ...perms,
    allow: perms.allow !== undefined ? perms.allow : existing.allow,
    deny: perms.deny !== undefined ? perms.deny : existing.deny,
    mode: perms.mode !== undefined ? perms.mode : existing.mode,
  };
  writeFileSync(permissionsPath(), JSON.stringify(merged, null, 2), { encoding: "utf-8", mode: 0o600 });
  tightenFile(permissionsPath());
}

export function addAllowRule(rule: string): void {
  const perms = loadPermissions();
  const allow = perms.allow || [];
  if (!allow.includes(rule)) {
    allow.push(rule);
    savePermissions({ allow });
  }
}

export function addDenyRule(rule: string): void {
  const perms = loadPermissions();
  const deny = perms.deny || [];
  if (!deny.includes(rule)) {
    deny.push(rule);
    savePermissions({ deny });
  }
}

export function getPermissionMode(): "ask" | "accept-edits" | "plan" | "yolo" {
  const perms = loadPermissions();
  return perms.mode || "ask";
}

export function setPermissionMode(mode: "ask" | "accept-edits" | "plan" | "yolo"): void {
  savePermissions({ mode });
}

export function matchesRule(pattern: string, tool: string, args: Record<string, unknown>): boolean {
  try {
    // Simple pattern matching: tool name or tool(args) patterns
    if (pattern === tool) return true;
    // Check for tool(pattern) style like run_command(npm test*)
    const m = pattern.match(/^([^(]+)\((.+)\)$/);
    if (m) {
      const pTool = m[1].trim();
      const pArg = m[2].trim();
      if (pTool !== tool) return false;
      // Check common args
      if (tool === "run_command" && typeof args.command === "string") {
        const cmd = args.command;
        if (pArg.includes("*")) {
          const re = new RegExp("^" + pArg.replace(/\*/g, ".*").replace(/[.+?^${}()|[\]\\]/g, "\\$&") + "$");
          return re.test(cmd) || cmd.includes(pArg.replace(/\*/g, ""));
        }
        return cmd.includes(pArg);
      }
      if (typeof args.path === "string") {
        if (pArg.includes("*")) {
          const re = new RegExp(pArg.replace(/\*/g, ".*"));
          return re.test(args.path);
        }
        return args.path.includes(pArg);
      }
    }
  } catch {
    // ignore
  }
  return false;
}
