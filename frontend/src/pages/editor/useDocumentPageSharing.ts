import { useCallback, useState } from "react";
import type { Socket } from "socket.io-client";
import {
  bindSocketDocumentPages,
  DOCUMENT_PAGE_COMMAND_EVENT,
  type DocumentPageController,
  type SharedDocumentPages,
} from "./documentPages";

/**
 * The room's page for every document widget on the board.
 *
 * Asking is all this does. The server decides whether the turn is allowed and
 * sends the result to everyone, so what arrives back is the room's page rather
 * than this client's opinion of it.
 */
export const useDocumentPageSharing = ({
  drawingId,
  socketRef,
}: {
  drawingId: string | undefined;
  socketRef: React.MutableRefObject<Socket | null>;
}): {
  controller: DocumentPageController;
  bind: (socket: Socket) => ReturnType<typeof bindSocketDocumentPages>;
} => {
  const [pages, setPages] = useState<SharedDocumentPages>({});

  const requestPage = useCallback(
    (elementId: string, assetId: string, page: number) => {
      if (!drawingId || !socketRef.current) return;
      socketRef.current.emit(DOCUMENT_PAGE_COMMAND_EVENT, {
        drawingId,
        elementId,
        assetId,
        page,
      });
    },
    [drawingId, socketRef],
  );

  const bind = useCallback(
    (socket: Socket) =>
      bindSocketDocumentPages({ socket, drawingId: drawingId || "", onChange: setPages }),
    [drawingId],
  );

  return { controller: { pages, requestPage }, bind };
};
