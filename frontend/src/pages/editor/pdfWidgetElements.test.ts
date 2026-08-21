import { describe, expect, it } from "vitest";
import { vi } from "vitest";

vi.mock("@excalidraw/excalidraw", () => ({
  convertToExcalidrawElements: (elements: Array<Record<string, unknown>>) =>
    elements.map((element, index) => ({ id: `element-${index}`, ...element })),
}));

import {
  ASSET_WIDGET_LINK,
  createAssetWidgetElement,
  createPdfWidgetElement,
  getAssetWidgetData,
  getPdfWidgetAssetId,
  PDF_WIDGET_LINK,
} from "./pdfWidgetElements";

describe("PDF widget elements", () => {
  it("stores only the schema, widget kind, and asset id in customData", () => {
    const element = createPdfWidgetElement({
      assetId: "asset-123",
      x: 400,
      y: 500,
    });

    expect(element.type).toBe("embeddable");
    expect(element.link).toBe(PDF_WIDGET_LINK);
    expect(element.customData).toEqual({
      schemaVersion: 1,
      widgetKind: "pdf",
      assetId: "asset-123",
    });
    expect(Object.keys(element.customData ?? {})).toHaveLength(3);
    expect(getPdfWidgetAssetId(element)).toBe("asset-123");
  });

  it("uses the generic asset schema for text-backed widgets", () => {
    const element = createAssetWidgetElement({
      assetId: "asset-md",
      widgetKind: "markdown",
      x: 100,
      y: 200,
    });

    expect(element.link).toBe(ASSET_WIDGET_LINK);
    expect(getAssetWidgetData(element)).toEqual({
      schemaVersion: 1,
      widgetKind: "markdown",
      assetId: "asset-md",
    });
    expect(getPdfWidgetAssetId(element)).toBeNull();
  });
});
