import { useEffect, useMemo, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import {
  getDocumentAsset,
  getDocumentContent,
  getDocumentOriginalUrl,
  type TextAsset,
} from "../../api";
import type { AssetWidgetKind } from "./pdfWidgetElements";
import { renderSafeMarkdown } from "./renderMarkdown";
import "./TextDocumentWidget.css";

type TextDocumentWidgetProps = {
  assetId: string;
  drawingId: string;
  theme: "light" | "dark";
  widgetKind: Extract<AssetWidgetKind, "markdown" | "text">;
};

type LoadedDocument = { asset: TextAsset; content: string };

export const TextDocumentWidget = ({
  assetId,
  drawingId,
  theme,
  widgetKind,
}: TextDocumentWidgetProps) => {
  const [loaded, setLoaded] = useState<LoadedDocument | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoaded(null);
    setError(null);
    Promise.all([getDocumentAsset(drawingId, assetId), getDocumentContent(drawingId, assetId)])
      .then(([asset, content]) => {
        if (!active) return;
        const expected = widgetKind === "markdown" ? "MARKDOWN" : "TEXT";
        if (asset.kind !== expected) {
          setError("This document does not match the widget type.");
          return;
        }
        setLoaded({ asset, content });
      })
      .catch(() => {
        if (active) setError("Unable to load this document.");
      });
    return () => {
      active = false;
    };
  }, [assetId, drawingId, widgetKind]);

  const markdownHtml = useMemo(
    () => (loaded?.asset.kind === "MARKDOWN" ? renderSafeMarkdown(loaded.content) : null),
    [loaded],
  );

  return (
    <div
      className={`text-document-widget${theme === "dark" ? " text-document-widget--dark" : ""}`}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div className="text-document-widget__title" title={loaded?.asset.name}>
        {loaded?.asset.name ?? (widgetKind === "markdown" ? "Markdown document" : "Text document")}
      </div>
      <div className="text-document-widget__body">
        {!loaded && !error ? (
          <Loader2 aria-label="Loading document" className="animate-spin" />
        ) : null}
        {error ? <p className="text-document-widget__status">{error}</p> : null}
        {loaded?.asset.kind === "TEXT" ? (
          <pre className="text-document-widget__plain">{loaded.content}</pre>
        ) : null}
        {markdownHtml !== null ? (
          <div
            className="text-document-widget__markdown"
            dangerouslySetInnerHTML={{ __html: markdownHtml }}
          />
        ) : null}
      </div>
      {loaded ? (
        <div className="text-document-widget__controls">
          <span>{loaded.asset.kind === "MARKDOWN" ? "Markdown" : "Plain text"}</span>
          <a
            className="text-document-widget__button"
            href={getDocumentOriginalUrl(drawingId, assetId)}
            download={loaded.asset.name}
            aria-label="Download original document"
            title="Download original document"
          >
            <Download size={17} />
          </a>
        </div>
      ) : null}
    </div>
  );
};
