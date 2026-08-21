/**
 * Cursor chat: press "/", say one thing, let it go.
 *
 * The point is that it does not take your eyes off the board. A side panel
 * makes you look away, type, and look back; this puts the sentence next to the
 * thing you are pointing at. And because it is gone the moment you stop, no
 * unread count builds up and nobody owes anybody a reply. Anything that needs
 * to survive the moment belongs in a comment instead.
 *
 * Remote bubbles are not drawn by us. Excalidraw already paints a name beside
 * every collaborator's cursor and moves it with them, so a message is appended
 * to that name -- which means it tracks the pointer exactly, at no cost, and
 * without a renderer of our own that would have to be kept in step.
 */

export const CURSOR_CHAT_EVENT = "cursor-chat";
/** Matches the server's cap; the server is still the one that enforces it. */
export const CURSOR_CHAT_MAX_LENGTH = 140;
/**
 * How often the draft goes out while somebody types.
 *
 * The server allows ten of these a second and silently drops the rest, so
 * sending one per keystroke loses the end of any sentence typed at a normal
 * speed -- the reader is left looking at the first half. Sending on a timer
 * with a trailing edge means the last thing typed always arrives, which is the
 * only version that has to.
 */
export const CURSOR_CHAT_SEND_INTERVAL_MS = 150;

export type CursorChatSocket = {
  emit: (event: string, payload: unknown) => void;
  on: (event: string, handler: (payload: any) => void) => void;
  off: (event: string, handler: (payload: any) => void) => void;
};

export type CursorChatController = {
  /** What each remote participant is saying right now, by presence id. */
  remote: Map<string, string>;
  /** Our own draft, or null when the composer is closed. */
  draft: string | null;
  open: () => void;
  close: () => void;
  type: (text: string) => void;
  dispose: () => void;
};

/**
 * Whether a keystroke should open the composer.
 *
 * "/" is the key every other whiteboard uses, and it is only free while nothing
 * is being typed into. Excalidraw puts the label editor in a textarea and the
 * shape properties in inputs; a slash meant for any of those must reach them,
 * or people cannot write a slash in a sticky note.
 */
export const shouldOpenCursorChat = (event: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  target?: unknown;
}): boolean => {
  if (event.key !== "/") return false;
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  const target = event.target as { tagName?: string; isContentEditable?: boolean } | undefined;
  const tag = target?.tagName?.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return false;
  return true;
};

export const bindCursorChat = ({
  socket,
  drawingId,
  onRemoteChange,
  onDraftChange,
}: {
  socket: CursorChatSocket;
  drawingId: string;
  /** Somebody else started or stopped saying something. */
  onRemoteChange: () => void;
  /** Our own draft changed, including opening and closing the composer. */
  onDraftChange: (draft: string | null) => void;
}): CursorChatController => {
  const remote = new Map<string, string>();
  let draft: string | null = null;

  let sendTimer: ReturnType<typeof setTimeout> | null = null;
  let queuedText: string | null = null;
  let hasQueued = false;

  const emit = (text: string | null) => socket.emit(CURSOR_CHAT_EVENT, { drawingId, text });

  const flush = () => {
    sendTimer = null;
    if (!hasQueued) return;
    hasQueued = false;
    emit(queuedText);
    // Keep the window open: anything typed during it goes out on the next tick
    // rather than immediately, which is what keeps us under the server's limit.
    sendTimer = setTimeout(flush, CURSOR_CHAT_SEND_INTERVAL_MS);
  };

  /** Throttled, with a trailing edge, so the final state always lands. */
  const send = (text: string | null) => {
    queuedText = text;
    hasQueued = true;
    if (sendTimer === null) flush();
  };

  /** Closing cannot wait for a tick: the bubble has to leave other screens. */
  const sendNow = (text: string | null) => {
    hasQueued = false;
    queuedText = text;
    if (sendTimer !== null) clearTimeout(sendTimer);
    sendTimer = null;
    emit(text);
  };

  const handleRemote = (payload: any) => {
    const presenceId = typeof payload?.presenceId === "string" ? payload.presenceId : null;
    if (!presenceId) return;
    const text = typeof payload?.text === "string" ? payload.text : null;
    if (text) remote.set(presenceId, text.slice(0, CURSOR_CHAT_MAX_LENGTH));
    else remote.delete(presenceId);
    onRemoteChange();
  };

  socket.on(CURSOR_CHAT_EVENT, handleRemote);

  const controller: CursorChatController = {
    remote,
    get draft() {
      return draft;
    },
    open: () => {
      if (draft !== null) return;
      draft = "";
      onDraftChange(draft);
    },
    close: () => {
      if (draft === null) return;
      draft = null;
      sendNow(null);
      onDraftChange(null);
    },
    type: (text: string) => {
      if (draft === null) return;
      draft = text.slice(0, CURSOR_CHAT_MAX_LENGTH);
      send(draft.length ? draft : null);
      onDraftChange(draft);
    },
    dispose: () => {
      if (sendTimer !== null) clearTimeout(sendTimer);
      sendTimer = null;
      socket.off(CURSOR_CHAT_EVENT, handleRemote);
      remote.clear();
    },
  };

  return controller;
};

/**
 * Folds what people are saying into the names Excalidraw draws by their cursors.
 *
 * Kept separate from the socket binding so the rule is testable on its own: a
 * silent participant keeps their plain name, and a speaking one gets the name
 * and the sentence, in that order, so you can still tell who is talking.
 */
export const withCursorChat = (name: string, chat: string | undefined): string =>
  chat ? `${name}: ${chat}` : name;
