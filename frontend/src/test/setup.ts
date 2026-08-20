import "@testing-library/jest-dom/vitest";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

URL.createObjectURL = vi.fn(() => "blob:mock-url");
URL.revokeObjectURL = vi.fn();

global.fetch = vi.fn();

/**
 * A canvas that answers.
 *
 * Excalidraw reads a 2d context at module load to find out whether the browser
 * supports canvas filters, and measures every line of text through one. jsdom
 * hands back null for both, so importing the package used to throw before a
 * single test ran. The width returned here is deliberately naive — tests that
 * care about real text layout install their own metrics provider.
 */
const canvasContext = {
  filter: "none",
  font: "",
  measureText: (text: string) => ({ width: text.length }),
};

HTMLCanvasElement.prototype.getContext = (() =>
  canvasContext) as unknown as HTMLCanvasElement["getContext"];


beforeEach(() => {
  vi.clearAllMocks();
});
