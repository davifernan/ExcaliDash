# Share link token migration

Share links now contain a high-entropy secret in the URL fragment. The server stores only its
SHA-256 hash, and HTTP, document, and live-collaboration access all require the current secret.

This is an intentional breaking change. Existing links of the form `/shared/<drawingId>` no
longer grant access, and there is no legacy fallback. Disable and re-enable General access (or
choose **Replace & Copy Link**) to create a new link. Revoking or replacing a link invalidates
every previously issued URL for that board.

The secret remains visible in the browser history to anyone with access to that browser profile.
ExcaliDash sends `Referrer-Policy: no-referrer`, keeps the secret out of the initial HTTP request by
placing it in the URL fragment, and configures the bundled nginx and backend request logs not to
record query strings. Operators should apply equivalent redaction to any external reverse-proxy
or observability layer.
