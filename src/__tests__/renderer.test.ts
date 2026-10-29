import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { ScrollRegion, emptyLine, invalidateFrame, line, paintFrame, span } from "../tui/core.js";

let captured = "";
let originalWrite: typeof process.stdout.write;
let originalColumns: number | undefined;
let originalRows: number | undefined;

beforeEach(() => {
  captured = "";
  originalColumns = process.stdout.columns;
  originalRows = process.stdout.rows;
  originalWrite = process.stdout.write.bind(process.stdout);
  (process.stdout as unknown as { write: (chunk: string) => boolean }).write = (chunk: string) => {
    captured += chunk;
    return true;
  };
  invalidateFrame();
});

afterEach(() => {
  (process.stdout as unknown as { write: typeof originalWrite }).write = originalWrite;
  if (originalColumns !== undefined) process.stdout.columns = originalColumns;
  if (originalRows !== undefined) process.stdout.rows = originalRows;
  invalidateFrame();
});

function frame(region: ScrollRegion): void {
  paintFrame(region, [line(span("footer"))], [line(span("header"))]);
}

describe("differential TUI renderer", () => {
  it("never emits a trailing newline (which scrolled the alt screen)", () => {
    const region = new ScrollRegion();
    region.append(line(span("hello")));
    frame(region);
    assert.ok(captured.length > 0);
    assert.equal(captured.includes("\n"), false);
    assert.match(captured, /^\u001b\[\?2026h/);
    assert.match(captured, /\u001b\[\?2026l$/);
  });

  it("writes nothing when the frame did not change", () => {
    const region = new ScrollRegion();
    region.append(line(span("hello")));
    frame(region);
    const first = captured;
    frame(region);
    assert.equal(captured, first, "an identical frame must not touch the terminal");
  });

  it("repaints only the rows that changed", () => {
    const region = new ScrollRegion();
    for (let i = 0; i < 10; i++) region.append(line(span(`row ${i}`)));
    frame(region);
    captured = "";
    region.setLine(2, line(span("row 2 changed")));
    frame(region);
    // Header is row 1, so the changed content line is screen row 4.
    const positions = [...captured.matchAll(/\u001b\[(\d+);1H/g)].map((m) => Number(m[1]));
    assert.deepEqual(positions, [4]);
    assert.match(captured, /row 2 changed/);
    assert.doesNotMatch(captured, /row 0/);
  });

  it("paints new rows without flicker when content grows", () => {
    const region = new ScrollRegion();
    region.append(line(span("one")));
    frame(region);
    captured = "";
    region.append(line(span("two")));
    frame(region);
    const positions = [...captured.matchAll(/\u001b\[(\d+);1H/g)].map((m) => Number(m[1]));
    assert.ok(positions.length >= 1);
    assert.ok(positions.every((p) => p >= 1));
    assert.match(captured, /two/);
  });

  it("full-repaints after invalidation", () => {
    const region = new ScrollRegion();
    region.append(line(span("hello")));
    frame(region);
    captured = "";
    invalidateFrame();
    frame(region);
    const positions = [...captured.matchAll(/\u001b\[(\d+);1H/g)].map((m) => Number(m[1]));
    assert.ok(positions.length > 1, "expected every row to be painted");
    assert.match(captured, /\u001b\[2J/);
  });

  it("pads rows to the terminal width and clears previous content", () => {
    const region = new ScrollRegion();
    region.append(line(span("short")));
    frame(region);
    captured = "";
    region.setLine(0, emptyLine());
    frame(region);
    assert.doesNotMatch(captured, /short/);
  });
});
