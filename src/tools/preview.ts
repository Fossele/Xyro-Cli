// Plain-text diff previews shown in the approval modal before a file changes.
// The tool output keeps its colored diff; this is for the TUI, which styles
// its own spans and must not receive ANSI escapes.

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { workspaceRoot } from "../agent/workspace.js";
import { generateDiff } from "./diff.js";

const ANSI = /\u001b\[[0-9;]*m/g;
const MAX_PREVIEW_LINES = 120;

function absPath(p: string): string {
  return isAbsolute(p) ? p : join(workspaceRoot(), p);
}

/** Lines of a unified diff for a write/edit call (null when not previewable). */
export function previewToolDiff(name: string, args: Record<string, unknown>): string[] | null {
  try {
    if (name === "write_file" && typeof args.path === "string" && typeof args.content === "string") {
      const file = absPath(args.path);
      const before = existsSync(file) ? readFileSync(file, "utf-8") : "";
      return clean(generateDiff(before, args.content, args.path));
    }
    if (name === "edit_file" && typeof args.path === "string" && typeof args.old_text === "string" && typeof args.new_text === "string") {
      const file = absPath(args.path);
      if (!existsSync(file)) return null;
      const before = readFileSync(file, "utf-8");
      if (!before.includes(args.old_text)) return null;
      const after = args.replace_all === true
        ? before.split(args.old_text).join(args.new_text)
        : before.replace(args.old_text, args.new_text);
      return clean(generateDiff(before, after, args.path));
    }
    return null;
  } catch {
    return null;
  }
}

function clean(diff: string): string[] {
  const lines = diff.replace(ANSI, "").split("\n").filter((l) => l.trim().length > 0);
  if (lines.length > MAX_PREVIEW_LINES) {
    lines.splice(MAX_PREVIEW_LINES, lines.length - MAX_PREVIEW_LINES, `… ${lines.length - MAX_PREVIEW_LINES} more lines`);
  }
  return lines;
}
