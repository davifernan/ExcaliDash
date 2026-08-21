import crypto from "crypto";

/**
 * A stable, opaque stand-in for an account, scoped to where it is shown.
 *
 * The dashboard needs to match "this person is a member here" against "this
 * person is connected here", which needs an identifier both sides agree on. The
 * account id would do the job and is exactly what should not leave the server:
 * it is a handle to a real row, and once it is in a client it is in every client
 * that shares the board.
 *
 * Scoping by collection or drawing means the same person carries a different key
 * in each place, so a key learned in one board says nothing about another.
 */
export const subjectKey = (secret: string, scope: string, userId: string): string =>
  crypto
    .createHmac("sha256", secret)
    .update(`subject:v1:${scope}:${userId}`)
    .digest("base64url")
    .slice(0, 22);
