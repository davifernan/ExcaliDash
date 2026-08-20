import { beforeAll, describe, expect, it } from "vitest";
import { setCustomTextMetricsProvider } from "@excalidraw/excalidraw";
import { FONT_SIZE_LADDER, fitTextToNote, ladderFrom } from "./stickyFit";
import { STICKY_BASE_FONT_SIZE, STICKY_SIZE, createStickyNote } from "./stickyNote";

/**
 * Real fonts are not loaded in jsdom, so the numbers a browser would produce
 * are unavailable. Excalidraw lets a caller supply its own metrics, which makes
 * these tests exact instead of approximately right: every character is half the
 * font size wide, so at 20pt a 19 character line is 190px and fills a 200px
 * note precisely.
 */
beforeAll(() => {
  setCustomTextMetricsProvider({
    getLineWidth: (text: string, font: string) => text.length * (parseFloat(font) / 2),
  });
});

const label = (note: any, text: string) => ({
  id: "label",
  type: "text",
  x: note.x,
  y: note.y,
  width: 10,
  height: 10,
  angle: 0,
  strokeColor: "#000000",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 1,
  strokeStyle: "solid",
  roughness: 0,
  opacity: 100,
  seed: 1,
  version: 1,
  versionNonce: 1,
  index: "a2",
  isDeleted: false,
  groupIds: [],
  frameId: null,
  roundness: null,
  boundElements: null,
  updated: 1,
  link: null,
  locked: false,
  text,
  originalText: text,
  fontSize: STICKY_BASE_FONT_SIZE,
  fontFamily: 5,
  textAlign: "center",
  verticalAlign: "middle",
  containerId: note.id,
  lineHeight: 1.25,
  autoResize: true,
});

const noteWith = (text: string) => {
  const note = createStickyNote(0, 0);
  note.boundElements = [{ id: "label", type: "text" }];
  return { note, text: label(note, text) };
};

describe("the ladder", () => {
  it("starts at the note's own size and only goes down", () => {
    expect(ladderFrom(20)).toEqual([20, 16, 12, 10, 8]);
  });

  it("offers a chosen size the ladder does not contain", () => {
    expect(ladderFrom(15)[0]).toBe(15);
  });

  it("never grows past what the author picked", () => {
    expect(Math.max(...ladderFrom(12))).toBe(12);
    expect(FONT_SIZE_LADDER[0]).toBeGreaterThan(12);
  });
});

describe("fitting the writing to the note", () => {
  it("leaves a short note at its chosen size", () => {
    const { note, text } = noteWith("Ship it");
    const fit = fitTextToNote(note, text, STICKY_BASE_FONT_SIZE)!;
    expect(fit.fontSize).toBe(STICKY_BASE_FONT_SIZE);
    expect(fit.fits).toBe(true);
  });

  it("wraps at the note's width, not the label's", () => {
    const { note, text } = noteWith("hello world this is a fairly long sticky note text");
    const fit = fitTextToNote(note, text, STICKY_BASE_FONT_SIZE)!;
    // 200 wide minus five points of padding a side leaves 190.
    expect(fit.width).toBeLessThanOrEqual(STICKY_SIZE - 10);
    expect(fit.text).toContain("\n");
  });

  it("shrinks the writing rather than growing the note", () => {
    const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
    const { note, text } = noteWith(long);
    const fit = fitTextToNote(note, text, STICKY_BASE_FONT_SIZE)!;
    expect(fit.fontSize).toBeLessThan(STICKY_BASE_FONT_SIZE);
    expect(fit.height).toBeLessThanOrEqual(STICKY_SIZE - 10);
    expect(fit.fits).toBe(true);
  });

  it("says so when even the smallest writing overflows", () => {
    const essay = Array.from({ length: 400 }, (_, i) => `word${i}`).join(" ");
    const { note, text } = noteWith(essay);
    const fit = fitTextToNote(note, text, STICKY_BASE_FONT_SIZE)!;
    expect(fit.fits).toBe(false);
    expect(fit.fontSize).toBe(FONT_SIZE_LADDER[FONT_SIZE_LADDER.length - 1]);
  });

  it("measures from the unwrapped text, so shrinking does not keep the old breaks", () => {
    // The regression this guards: after one fit the label's `text` already
    // carries newlines. Wrapping that again preserves them, so a smaller font
    // reports the same number of lines and the note never actually shrinks.
    const sentence = "alpha beta gamma delta epsilon zeta eta theta iota kappa";
    const { note, text } = noteWith(sentence);
    const shrunk = { ...text, text: sentence.split(" ").join("\n"), originalText: sentence };
    const fit = fitTextToNote(note, shrunk, 12)!;
    expect(fit.text.split("\n").length).toBeLessThan(10);
  });

  it("climbs back to the chosen size when the text is deleted again", () => {
    const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
    const { note, text } = noteWith(long);
    const shrunk = fitTextToNote(note, text, STICKY_BASE_FONT_SIZE)!;
    expect(shrunk.fontSize).toBeLessThan(STICKY_BASE_FONT_SIZE);

    const emptied = { ...text, text: "Short", originalText: "Short", fontSize: shrunk.fontSize };
    const grown = fitTextToNote(note, emptied, STICKY_BASE_FONT_SIZE)!;
    expect(grown.fontSize).toBe(STICKY_BASE_FONT_SIZE);
  });

  it("uses the whole note when the note was made bigger", () => {
    const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
    const small = noteWith(long);
    const roomy = noteWith(long);
    roomy.note.width = 600;
    roomy.note.height = 600;

    const tight = fitTextToNote(small.note, small.text, STICKY_BASE_FONT_SIZE)!;
    const loose = fitTextToNote(roomy.note, roomy.text, STICKY_BASE_FONT_SIZE)!;
    expect(loose.fontSize).toBeGreaterThan(tight.fontSize);
  });

  it("returns nothing rather than guessing when there is no label", () => {
    expect(fitTextToNote(createStickyNote(0, 0), null, 20)).toBeNull();
    expect(fitTextToNote(null, label({ id: "x", x: 0, y: 0 }, "hi"), 20)).toBeNull();
  });
});
