// @-file picker: fuzzy-search project files and insert the chosen path into the
// prompt. The file list is loaded lazily (fast-glob) so opening it is instant.

import fg from "fast-glob";
import { IGNORED_DIRS } from "../config/constants.js";
import { currentTheme, tint } from "../ui/theme.js";
import { RenderLine, StyledSpan, span, visualWidth } from "./core.js";
import { modalFrame } from "./overlays.js";

const BRAND_LEMON = "#C6F135";
const BRAND_BLUE = "#38BDF8";

/** Subsequence score: higher is better, -1 when `query` is not in `text`. */
export function fuzzyScore(text: string, query: string): number {
  const hay = text.toLowerCase();
  const needle = query.toLowerCase().trim();
  if (!needle) return 0;
  let at = 0;
  let score = 0;
  let previous = -2;
  for (const ch of needle) {
    const hit = hay.indexOf(ch, at);
    if (hit < 0) return -1;
    const consecutive = hit === previous + 1;
    const boundary = hit === 0 || /[\/_.\-]/.test(hay[hit - 1] ?? "");
    score += consecutive ? 6 : boundary ? 4 : 1;
    previous = hit;
    at = hit + 1;
  }
  // Prefer short paths and matches near the beginning.
  return score - hay.length * 0.01 - (previous - needle.length) * 0.02;
}

export class FilePicker {
  private visible = false;
  private query = "";
  private cwd = process.cwd();
  private files: string[] = [];
  private matches: string[] = [];
  private cursor = 0;
  private loading = false;

  private onSelectCb: ((path: string) => void) | null = null;
  private onUpdateCb: (() => void) | null = null;

  isOpen(): boolean { return this.visible; }
  onSelect(cb: (path: string) => void): void { this.onSelectCb = cb; }
  onUpdate(cb: () => void): void { this.onUpdateCb = cb; }

  open(cwd: string): void {
    this.visible = true;
    this.cwd = cwd || process.cwd();
    this.query = "";
    this.cursor = 0;
    this.matches = [];
    this.loading = true;
    void this.load();
  }

  close(): void { this.visible = false; }

  private async load(): Promise<void> {
    try {
      const ignore = [...IGNORED_DIRS].flatMap((d) => [`**/${d}/**`, `**/${d}`]);
      ignore.push("**/.git/**");
      const files = await fg("**/*", {
        cwd: this.cwd,
        onlyFiles: true,
        dot: false,
        followSymbolicLinks: false,
        ignore,
      });
      files.sort();
      this.files = files.slice(0, 5000);
    } catch {
      this.files = [];
    }
    this.loading = false;
    if (!this.visible) return;
    this.rebuild();
    this.onUpdateCb?.();
  }

  private rebuild(): void {
    const q = this.query.trim();
    if (!q) {
      this.matches = this.files.slice(0, 12);
    } else {
      this.matches = this.files
        .map((path) => ({ path, score: fuzzyScore(path, q) }))
        .filter((m) => m.score >= 0)
        .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
        .slice(0, 12)
        .map((m) => m.path);
    }
    this.cursor = Math.min(this.cursor, Math.max(0, this.matches.length - 1));
  }

  handleKey(key: string): boolean {
    if (!this.visible) return false;
    const cp = key.codePointAt(0) ?? 0;
    if (key === "\u001b") {
      this.close();
      return true;
    }
    if (cp === 13) {
      const picked = this.matches[this.cursor];
      if (picked) {
        this.close();
        this.onSelectCb?.(picked);
      }
      return true;
    }
    if (key === "\u001b[A") {
      if (this.matches.length) this.cursor = (this.cursor - 1 + this.matches.length) % this.matches.length;
      return true;
    }
    if (key === "\u001b[B") {
      if (this.matches.length) this.cursor = (this.cursor + 1) % this.matches.length;
      return true;
    }
    if (cp === 127 || cp === 8) {
      if (this.query.length) {
        this.query = this.query.slice(0, -1);
        this.cursor = 0;
        this.rebuild();
      }
      return true;
    }
    if (cp < 32) return true;
    // Ignore escape sequences (arrows are handled above)
    if (key.startsWith("\u001b")) return true;
    this.query += key;
    this.cursor = 0;
    this.rebuild();
    return true;
  }

  render(termWidth: number): RenderLine[] {
    if (!this.visible) return [];
    const t = currentTheme();
    const boxW = Math.max(56, Math.min(96, termWidth - 6));
    const innerW = boxW - 2;
    const muted = tint(t.textMuted, 0.85);
    const fit = (s: string, w: number) => (visualWidth(s) > w ? s.slice(0, Math.max(1, w - 1)) + "…" : s + " ".repeat(Math.max(0, w - visualWidth(s))));

    const body: (StyledSpan[] | { spans: StyledSpan[]; bg: string })[] = [];
    const search: StyledSpan[] = [
      span("  @ ", { fg: BRAND_LEMON, bold: true }),
      this.query
        ? span(this.query, { fg: t.text, bold: true })
        : span("search project files", { fg: tint(t.textMuted, 0.6), italic: true }),
      span("▌", { fg: BRAND_LEMON }),
    ];
    const used = search.reduce((w, s) => w + visualWidth(s.text), 0);
    body.push([...search, span(" ".repeat(Math.max(1, innerW - used - 14))), span("project files", { fg: muted })]);
    body.push([span("  " + "─".repeat(innerW - 4), { fg: tint(t.border, 0.6) })]);

    if (this.loading) {
      body.push([span("  scanning project…", { fg: muted })]);
    } else if (!this.matches.length) {
      body.push([span("  No file matches ", { fg: muted }), span(`"${this.query}"`, { fg: t.text })]);
    } else {
      this.matches.forEach((path, i) => {
        const selected = i === this.cursor;
        const bg = selected ? t.backgroundMenu : t.backgroundPanel;
        const bar = span(selected ? " ▌ " : "   ", { fg: BRAND_LEMON, bold: true });
        body.push({
          spans: [
            bar,
            span(fit(path, innerW - 4), { fg: selected ? t.text : tint(t.text, 0.9), bold: selected }),
          ],
          bg,
        });
      });
    }
    body.push([span("  " + "─".repeat(innerW - 4), { fg: tint(t.border, 0.45) })]);
    body.push([span("  ↑↓ choose · enter insert · esc cancel", { fg: tint(t.textMuted, 0.75) })]);
    return modalFrame("Insert a file", boxW, body, "type to filter · enter insert · esc cancel", BRAND_BLUE);
  }
}
