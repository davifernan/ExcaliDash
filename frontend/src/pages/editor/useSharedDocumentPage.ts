import { useCallback, useEffect, useState } from "react";

export type DocumentPageSharing = {
  /** The board element this widget is drawn into; what the room keys a page by. */
  elementId: string;
  assetId: string;
  /** The page the room is on, once the server has said so. */
  sharedPage?: number;
  /** Whether a page turn here is everybody's, or only this reader's. */
  canControl: boolean;
  onRequestPage?: (elementId: string, assetId: string, page: number) => void;
};

const clamp = (page: number, pageCount: number) =>
  Math.min(Math.max(1, page), Math.max(1, pageCount));

/**
 * The page a document widget shows.
 *
 * Everyone follows the room: whenever the shared page moves, every widget
 * follows it, whether or not that reader may turn pages themselves. The
 * difference is what a click does. Someone who may edit the board turns the
 * page for the room; someone who may only look turns it for themselves, so a
 * read-only link is still a readable document rather than a fixed first page.
 *
 * The turn is applied here as well as sent, so paging feels immediate. The
 * server's answer overwrites it either way — this is a head start, not a
 * second opinion.
 */
export const useSharedDocumentPage = ({
  sharing,
  pageCount,
}: {
  sharing: DocumentPageSharing;
  pageCount: number;
}) => {
  const [page, setPage] = useState(1);
  const { assetId, canControl, elementId, onRequestPage, sharedPage } = sharing;

  useEffect(() => {
    if (sharedPage === undefined) return;
    setPage(clamp(sharedPage, pageCount));
  }, [pageCount, sharedPage]);

  const goToPage = useCallback(
    (next: number) => {
      const wanted = clamp(next, pageCount);
      setPage(wanted);
      if (canControl) onRequestPage?.(elementId, assetId, wanted);
    },
    [assetId, canControl, elementId, onRequestPage, pageCount],
  );

  return { page, goToPage };
};
