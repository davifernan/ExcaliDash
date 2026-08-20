import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Loader2 } from "lucide-react";
import { getPdfAsset, getPdfOriginalUrl, getPdfPageUrl, type PdfAsset } from "../../api";
import "./PdfWidget.css";

type PdfWidgetProps = {
  assetId: string;
  drawingId: string;
  theme: "light" | "dark";
};

export const PdfWidget = ({ assetId, drawingId, theme }: PdfWidgetProps) => {
  const [asset, setAsset] = useState<PdfAsset | null>(null);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [requestedPage, setRequestedPage] = useState(1);
  const [displayedPage, setDisplayedPage] = useState<number | null>(null);
  const directionRef = useRef<1 | -1>(1);

  useEffect(() => {
    let active = true;
    setAsset(null);
    setMetadataError(null);
    setPageError(null);
    setRequestedPage(1);
    setDisplayedPage(null);
    getPdfAsset(drawingId, assetId)
      .then((nextAsset) => {
        if (!active) return;
        if (!Number.isInteger(nextAsset.pageCount) || nextAsset.pageCount < 1) {
          setMetadataError("This document has no viewable pages.");
          return;
        }
        setAsset(nextAsset);
      })
      .catch(() => {
        if (active) setMetadataError("Unable to load this document.");
      });
    return () => {
      active = false;
    };
  }, [assetId, drawingId]);

  useEffect(() => {
    if (!asset || displayedPage === null) return;
    const nextPage = displayedPage + directionRef.current;
    if (nextPage < 1 || nextPage > asset.pageCount) return;
    const preload = new Image();
    preload.src = getPdfPageUrl(drawingId, assetId, nextPage);
  }, [asset, assetId, displayedPage, drawingId]);

  const requestPage = (direction: 1 | -1) => {
    if (!asset) return;
    directionRef.current = direction;
    setPageError(null);
    setRequestedPage((current) => Math.min(asset.pageCount, Math.max(1, current + direction)));
  };

  const requestedPageUrl = asset ? getPdfPageUrl(drawingId, assetId, requestedPage) : null;
  const displayedPageUrl = displayedPage ? getPdfPageUrl(drawingId, assetId, displayedPage) : null;

  return (
    <div
      className={`pdf-widget${theme === "dark" ? " pdf-widget--dark" : ""}`}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="pdf-widget__title" title={asset?.name}>
        {asset?.name ?? "PDF document"}
      </div>
      <div className="pdf-widget__page">
        {displayedPageUrl && asset ? (
          <img
            className="pdf-widget__page-image"
            src={displayedPageUrl}
            alt={`${asset.name}, page ${displayedPage}`}
          />
        ) : null}
        {requestedPageUrl && displayedPage !== requestedPage ? (
          <img
            className="pdf-widget__page-image pdf-widget__page-image--pending"
            src={requestedPageUrl}
            alt=""
            aria-hidden="true"
            onLoad={() => {
              setDisplayedPage(requestedPage);
              setPageError(null);
            }}
            onError={() => setPageError("Unable to load this page.")}
          />
        ) : null}
        {!displayedPage && !metadataError && !pageError ? (
          <Loader2 aria-label="Loading page" className="animate-spin" size={24} />
        ) : null}
        {metadataError ? <p className="pdf-widget__status">{metadataError}</p> : null}
        {pageError ? <p className="pdf-widget__status">{pageError}</p> : null}
      </div>
      {asset ? (
        <div className="pdf-widget__controls">
          <button
            type="button"
            className="pdf-widget__button"
            aria-label="Previous page"
            disabled={requestedPage <= 1}
            onClick={() => requestPage(-1)}
          >
            <ChevronLeft size={18} />
          </button>
          <span className="pdf-widget__page-number">
            Page {requestedPage} of {asset.pageCount}
          </span>
          <button
            type="button"
            className="pdf-widget__button"
            aria-label="Next page"
            disabled={requestedPage >= asset.pageCount}
            onClick={() => requestPage(1)}
          >
            <ChevronRight size={18} />
          </button>
          <a
            className="pdf-widget__button"
            href={getPdfOriginalUrl(drawingId, assetId)}
            download={asset.name}
            aria-label="Download original PDF"
            title="Download original PDF"
          >
            <Download size={17} />
          </a>
        </div>
      ) : null}
    </div>
  );
};
