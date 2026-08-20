import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockToast, mockUploadPdfAsset } = vi.hoisted(() => ({
  mockToast: {
    loading: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
  mockUploadPdfAsset: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: mockToast }));
vi.mock("@excalidraw/excalidraw", () => ({
  CaptureUpdateAction: { IMMEDIATELY: "IMMEDIATELY" },
  convertToExcalidrawElements: (elements: unknown[]) => elements,
}));
vi.mock("../../api", () => ({
  isAxiosError: (error: unknown) => Boolean((error as { isAxiosError?: boolean })?.isAxiosError),
  uploadPdfAsset: mockUploadPdfAsset,
}));

import { addDroppedPdfWidgets } from "./pdfDrop";

const axiosError = (status: number, message?: string) => ({
  isAxiosError: true,
  response: { status, data: message ? { message } : {} },
});

describe("PDF drop errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    [413, "File exceeds the 30 MB upload limit.", "The file is too large (max 30 MB)."],
    [507, "Storage limit reached", "No storage space is available."],
    [
      422,
      "The PDF has a damaged cross-reference table.",
      "The PDF has a damaged cross-reference table.",
    ],
    [403, "Read-only access", "You can view this board, but you cannot add anything to it."],
  ])("shows a useful message for HTTP %i", async (status, serverMessage, expected) => {
    mockUploadPdfAsset.mockRejectedValueOnce(axiosError(status, serverMessage));
    await addDroppedPdfWidgets({
      canvasApi: {
        getSceneElementsIncludingDeleted: () => [],
        updateScene: vi.fn(),
      },
      drawingId: "drawing-1",
      files: [new File(["pdf"], "brief.pdf", { type: "application/pdf" })],
      point: { x: 100, y: 200 },
    });

    expect(mockToast.error).toHaveBeenCalledWith(expected, {
      id: expect.stringMatching(/^pdf-upload-/),
    });
  });
});
