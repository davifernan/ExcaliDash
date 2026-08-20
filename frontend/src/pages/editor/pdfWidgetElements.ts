import { convertToExcalidrawElements } from "@excalidraw/excalidraw";

export const PDF_WIDGET_LINK = "excalidash://pdf-widget";
export const PDF_WIDGET_WIDTH = 480;
export const PDF_WIDGET_HEIGHT = 680;

export type PdfWidgetCustomData = {
  schemaVersion: 1;
  widgetKind: "pdf";
  assetId: string;
};

type EmbeddableLike = {
  type?: string;
  link?: string | null;
  customData?: Record<string, unknown>;
};

export const isPdfWidgetLink = (link: string) => link === PDF_WIDGET_LINK;

export const getPdfWidgetAssetId = (element: EmbeddableLike): string | null => {
  const customData = element.customData;
  if (
    element.type !== "embeddable" ||
    element.link !== PDF_WIDGET_LINK ||
    !customData ||
    Object.keys(customData).length !== 3 ||
    customData.schemaVersion !== 1 ||
    customData.widgetKind !== "pdf" ||
    typeof customData.assetId !== "string" ||
    customData.assetId.length === 0
  ) {
    return null;
  }
  return customData.assetId;
};

export const createPdfWidgetElement = ({
  assetId,
  x,
  y,
}: {
  assetId: string;
  x: number;
  y: number;
}) => {
  const customData: PdfWidgetCustomData = {
    schemaVersion: 1,
    widgetKind: "pdf",
    assetId,
  };
  const [baseElement] = convertToExcalidrawElements([
    {
      type: "rectangle",
      x: x - PDF_WIDGET_WIDTH / 2,
      y: y - PDF_WIDGET_HEIGHT / 2,
      width: PDF_WIDGET_WIDTH,
      height: PDF_WIDGET_HEIGHT,
    },
  ]);
  return {
    ...baseElement,
    type: "embeddable" as const,
    link: PDF_WIDGET_LINK,
    customData,
  };
};
