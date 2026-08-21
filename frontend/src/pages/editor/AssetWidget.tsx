import { PdfWidget } from "./PdfWidget";
import { TextDocumentWidget } from "./TextDocumentWidget";
import type { AssetWidgetData, AssetWidgetKind } from "./pdfWidgetElements";
import type { DocumentPageSharing } from "./useSharedDocumentPage";

type AssetWidgetProps = {
  data: AssetWidgetData;
  drawingId: string;
  theme: "light" | "dark";
  sharing: DocumentPageSharing;
};

type WidgetComponent = (props: AssetWidgetProps) => React.ReactNode;

const widgets: Record<AssetWidgetKind, WidgetComponent> = {
  pdf: ({ data, drawingId, theme, sharing }) => (
    <PdfWidget assetId={data.assetId} drawingId={drawingId} theme={theme} sharing={sharing} />
  ),
  markdown: ({ data, drawingId, theme, sharing }) => (
    <TextDocumentWidget
      assetId={data.assetId}
      drawingId={drawingId}
      theme={theme}
      widgetKind="markdown"
      sharing={sharing}
    />
  ),
  text: ({ data, drawingId, theme, sharing }) => (
    <TextDocumentWidget
      assetId={data.assetId}
      drawingId={drawingId}
      theme={theme}
      widgetKind="text"
      sharing={sharing}
    />
  ),
};

export const AssetWidget = (props: AssetWidgetProps) => {
  const Widget = widgets[props.data.widgetKind];
  return <Widget {...props} />;
};
