import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getConfigDir } from "./platform.js";
import { workspaceRoot } from "../agent/workspace.js";

export type PermissionMode = "ask" | "accept-edits" | "plan" | "yolo";

export type PermissionRule = {
  pattern: string;
  tool?: string;
};

export type PersistedPermissions = {
  allow?: string[];
  deny?: string[];
  /** Permission mode: ask, accept-edits, plan, yolo */
  mode?: PermissionMode;
};

const MODES: PermissionMode[] = ["ask", "accept-edits", "plan", "yolo"];

/** User-wide settings (all projects). */
function userSettingsPath(): string {
  return join(getConfigDir(), "settings.json");
}

/**
 * Per-project settings. Permission modes and rules belong to the project they
 * were granted in, so a "yolo" session in a scratch repo cannot silently
 * apply to your production checkout.
 */
export function projectSettingsPath(root = workspaceRoot()): string {
  return join(root, ".xyro", "settings.json");
}

/**
 * Read from the project file when it exists, otherwise fall back to the user
 * file (legacy / user-wide rules). New rules are always written per project.
 */
function settingsPath(root = workspaceRoot()): string {
  const project = projectSettingsPath(root);
  if (existsSync(project)) return project;
  const user = userSettingsPath();
  if (existsSync(user)) return user;
  return project;
}

function tightenFile(p: string): void {
  try {
    if (process.platform !== "win32" && existsSync(p) && (statSync(p).mode & 0o077) !== 0) {
      chmodSync(p, 0o600);
    }
  } catch {
    // best effort
  }
}

function normaliseMode(value: unknown): PermissionMode | undefined {
  return MODES.includes(value as PermissionMode) ? (value as PermissionMode) : undefined;
}

export function loadPermissions(root = workspaceRoot()): PersistedPermissions {
  try {
    const p = settingsPath(root);
    if (!existsSync(p)) return {};
    const data = JSON.parse(readFileSync(p, "utf-8")) as PersistedPermissions;
    if (!data || typeof data !== "object") return {};
    const allow = Array.isArray(data.allow) ? data.allow.filter((r): r is string => typeof r === "string") : undefined;
    const deny = Array.isArray(data.deny) ? data.deny.filter((r): r is string => typeof r === "string") : undefined;
    return { allow, deny, mode: normaliseMode(data.mode) };
  } catch {
    return {};
  }
}

/** Save merged permissions to the project's `.xyro/settings.json`. */
export function savePermissions(perms: Partial<PersistedPermissions>, root = workspaceRoot()): void {
  const existing = loadPermissions(root);
  const merged: PersistedPermissions = {
    ...existing,
    ...perms,
    allow: perms.allow !== undefined ? perms.allow : existing.allow,
    deny: perms.deny !== undefined ? perms.deny : existing.deny,
    mode: perms.mode !== undefined ? normaliseMode(perms.mode) : existing.mode,
  };
  const p = projectSettingsPath(root);
  const dir = join(root, ".xyro");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(p, JSON.stringify(merged, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 });
  tightenFile(p);
}

export function addAllowRule(rule: string, root = workspaceRoot()): void {
  const perms = loadPermissions(root);
  const allow = perms.allow || [];
  if (!allow.includes(rule)) {
    allow.push(rule);
    savePermissions({ allow }, root);
  }
}

export function addDenyRule(rule: string, root = workspaceRoot()): void {
  const perms = loadPermissions(root);
  const deny = perms.deny || [];
  if (!deny.includes(rule)) {
    deny.push(rule);
    savePermissions({ deny }, root);
  }
}

export function getPermissionMode(root = workspaceRoot()): PermissionMode {
  return loadPermissions(root).mode || "ask";
}

export function setPermissionMode(mode: PermissionMode, root = workspaceRoot()): void {
  savePermissions({ mode }, root);
}

/** Build the rule persisted by "always allow this action". */
export function ruleFor(name: string, args: Record<string, unknown>): string {
  if (name === "run_command" && typeof args.command === "string" && args.command.trim()) {
    return `${name}(${args.command.trim()})`;
  }
  if (typeof args.path === "string" && args.path.trim()) {
    return `${name}(${args.path.trim()})`;
  }
  if (typeof args.url === "string" && args.url.trim()) {
    return `${name}(${args.url.trim()})`;
  }
  return name;
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

export function matchesRule(pattern: string, tool: string, args: Record<string, unknown>): boolean {
  try {
    const trimmed = pattern.trim();
    if (!trimmed) return false;
    if (trimmed === tool) return true;

    const m = trimmed.match(/^([^(]+)\(([\s\S]+)\)$/);
    if (!m) return false;
    const ruleTool = m[1].trim();
    const ruleArg = m[2].trim();
    if (ruleTool !== tool) return false;

    if (tool === "run_command" && typeof args.command === "string") {
      return globToRegExp(ruleArg).test(args.command.trim());
    }
    if (typeof args.path === "string") {
      return globToRegExp(ruleArg).test(args.path.trim());
    }
    if (typeof args.url === "string") {
      return globToRegExp(ruleArg).test(args.url.trim());
    }
    return false;
  } catch {
    return false;
  }
}
