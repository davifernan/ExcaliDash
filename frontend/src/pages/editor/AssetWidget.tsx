import { PdfWidget } from "./PdfWidget";
import { TextDocumentWidget } from "./TextDocumentWidget";
import type { AssetWidgetData, AssetWidgetKind } from "./pdfWidgetElements";

type AssetWidgetProps = {
  data: AssetWidgetData;
  drawingId: string;
  theme: "light" | "dark";
};

type WidgetComponent = (props: AssetWidgetProps) => React.ReactNode;

const widgets: Record<AssetWidgetKind, WidgetComponent> = {
  pdf: ({ data, drawingId, theme }) => (
    <PdfWidget assetId={data.assetId} drawingId={drawingId} theme={theme} />
  ),
  markdown: ({ data, drawingId, theme }) => (
    <TextDocumentWidget
      assetId={data.assetId}
      drawingId={drawingId}
      theme={theme}
      widgetKind="markdown"
    />
  ),
  text: ({ data, drawingId, theme }) => (
    <TextDocumentWidget
      assetId={data.assetId}
      drawingId={drawingId}
      theme={theme}
      widgetKind="text"
    />
  ),
};

export const AssetWidget = (props: AssetWidgetProps) => {
  const Widget = widgets[props.data.widgetKind];
  return <Widget {...props} />;
};
