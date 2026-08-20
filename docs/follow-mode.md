# Follow mode implementation plan

## Recon findings

- The current collaboration protocol has no viewport or follow events. It only
  relays room joins, pointers, scene elements, activity, presence, and storage
  invalidation.
- The backend already includes `socketId` in each presence object, but the
  frontend keys Excalidraw collaborators by the account-style `id`. Excalidraw
  treats the map key as the collaborator socket id, so follow mode appears to
  start without having a routable presence identity.
- Presence is currently deduplicated by account id on join. The replaced socket
  remains in the Socket.IO room but loses its presence record, which breaks its
  pointer updates and makes disconnect cleanup incorrect for two tabs.
- In the installed Excalidraw 0.18.1 bundle, `onUserFollow` is declared as a
  React prop but `ExcalidrawBase` neither reads nor forwards that prop. The
  imperative `excalidrawAPI.onUserFollow()` emitter is wired and is the usable
  integration point.
- Excalidraw 0.18.1's own collaboration client sends
  `getVisibleSceneBounds(appState)` and applies received bounds using
  `zoomToFitBounds({ fitToViewport: true, viewportZoomFactor: 1 })`. This keeps
  the followed world-space rectangle intact across different viewport sizes,
  instead of replaying raw scroll and zoom values.

## Protocol and identity model

1. Represent every connected tab as an independent presence. Its
   `presenceId` is the server-owned `socket.id`; its optional `accountId` comes
   only from the authenticated socket principal. Never accept either identity
   from an event payload.
2. Keep one active drawing membership per socket. A successful board switch,
   explicit leave, disconnect, or detected access loss removes the old
   presence and all follow edges before leaving the Socket.IO room.
3. Add client-to-server events for a follow request and visible scene bounds.
   Follow requests name only the target `presenceId`; the follower is always
   the sending socket. Bounds contain only `drawingId` and a four-number scene
   rectangle.
4. Maintain both directions on the server: one target per follower and a set of
   followers per target. Reject self-follow and targets outside the same
   authorized room. Notify targets with a sanitized follower list and notify a
   follower when its relationship ends.
5. Relay each bounds update only to followers registered for that target, never
   to the room. Re-check server-side membership and current read access for the
   sender and recipients for each accepted event.

## Validation and abuse controls

- Construct every outbound payload from an explicit field whitelist. In
  particular, replace the current `cursor-move` spread and also whitelist
  top-level scene-update fields.
- Validate drawing ids, actions, booleans, pointer coordinates, and viewport
  bounds. All numeric values must be finite and stay within documented world
  coordinate/span limits.
- Apply per-socket rate limits to high-frequency pointers, element updates,
  viewport bounds, activity, and follow changes. The frontend additionally
  coalesces viewport sends to animation frames.
- Viewport messages are ephemeral: they are never written to the drawing,
  included in element updates, or persisted.
- When a fresh permission check fails, remove that socket from the drawing and
  clean both directions of its follow relationships immediately.

## Frontend behavior

1. Store presence and collaborator entries by `presenceId` so two tabs from the
   same account remain separate Excalidraw participants.
2. Subscribe through `excalidrawAPI.onUserFollow()`, not the inert React prop,
   and send follow/unfollow requests to the backend.
3. Subscribe through `excalidrawAPI.onScrollChange()` and a container resize
   observer. While at least one server-registered follower exists, coalesce and
   send `getVisibleSceneBounds()` results. Also send once immediately when the
   first follower is registered.
4. On targeted viewport updates, verify that Excalidraw still follows the
   sender and apply the upstream 0.18.1 `zoomToFitBounds` recipe. Ignore stale
   or unsolicited updates.
5. Mirror the server's reverse relationship into Excalidraw's `followedBy`
   state for cross-follow behavior, and show a small ExcaliDash header badge
   naming/counting followers because 0.18.1 has no adequate target-facing
   indicator.

## Test and delivery plan

- Backend Vitest coverage will exercise access checks, room membership,
  self-follow rejection, bounds and cursor field whitelists, targeted routing,
  disconnect cleanup, permission-loss cleanup, board switching, and two tabs
  belonging to the same account.
- Frontend unit tests will cover viewport payload validation/application helpers
  where practical; the strict TypeScript/Vite production build remains the
  integration check for Excalidraw's public API types.
- Run backend and frontend Vitest suites, both package builds, and source line
  checks. Commit documentation, backend protocol/tests, and frontend behavior
  in separate small English-language commits. Do not push or merge.
