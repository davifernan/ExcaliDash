import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { toast } from "sonner";
import { isAxiosError, uploadPdfAsset } from "../../api";
import { createPdfWidgetElement, PDF_WIDGET_HEIGHT } from "./pdfWidgetElements";

type CanvasApi = {
  getSceneElementsIncludingDeleted: () => readonly unknown[];
  updateScene: (scene: Record<string, unknown>) => void;
};

type DropPoint = { x: number; y: number };

const responseMessage = (error: unknown): string | null => {
  if (!isAxiosError(error)) return null;
  const data = error.response?.data;
  if (typeof data !== "object" || data === null) return null;
  const message = (data as { message?: unknown }).message;
  return typeof message === "string" ? message : null;
};

export const getPdfUploadErrorMessage = (error: unknown): string => {
  if (!isAxiosError(error)) return "Failed to upload the PDF.";
  const status = error.response?.status;
  const serverMessage = responseMessage(error);
  if (status === 413) {
    const limit = serverMessage?.match(/(\d+(?:\.\d+)?)\s*MB/i)?.[1];
    return limit
      ? `The file is too large (max ${limit} MB).`
      : "The file is too large.";
  }
  if (status === 507) return "No storage space is available.";
  if (status === 422) return serverMessage || "The PDF could not be read.";
  if (status === 403) {
    return "You can view this board, but you cannot add anything to it.";
  }
  if (status === 415) return serverMessage || "Only PDF documents can be added.";
  return serverMessage || "Failed to upload the PDF.";
};

export const isPdfFile = (file: File) =>
  file.type.toLowerCase() === "application/pdf" ||
  (file.type === "" && file.name.toLowerCase().endsWith(".pdf"));

export const addDroppedPdfWidgets = async ({
  canvasApi,
  drawingId,
  files,
  point,
}: {
  canvasApi: CanvasApi;
  drawingId: string;
  files: File[];
  point: DropPoint;
}) => {
  const elements = [];
  for (const [index, file] of files.entries()) {
    const toastId = `pdf-upload-${Date.now()}-${index}`;
    toast.loading(`Uploading ${file.name}...`, {
      id: toastId,
      description: "0%",
    });
    try {
      const asset = await uploadPdfAsset(drawingId, file, (progress) => {
        toast.loading(`Uploading ${file.name}...`, {
          id: toastId,
          description: `${progress}%`,
        });
      });
      elements.push(
        createPdfWidgetElement({
          assetId: asset.id,
          x: point.x,
          y: point.y + index * (PDF_WIDGET_HEIGHT + 24),
        }),
      );
      toast.success(`${file.name} added`, { id: toastId });
    } catch (error) {
      toast.error(getPdfUploadErrorMessage(error), { id: toastId });
    }
  }

  if (elements.length === 0) return;
  canvasApi.updateScene({
    elements: [...canvasApi.getSceneElementsIncludingDeleted(), ...elements],
    appState: {
      selectedElementIds: Object.fromEntries(
        elements.map((element) => [element.id, true]),
      ),
    },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
};
