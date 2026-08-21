export const toPresenceName = (value: unknown): string => {
  if (typeof value !== "string") return "User";
  const trimmed = value.trim().slice(0, 120);
  return trimmed || "User";
};

export const toPresenceInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }
  return name.trim().slice(0, 2).toUpperCase() || "U";
};

export const toPresenceColor = (value: unknown): string => {
  if (typeof value !== "string") return "#4f46e5";
  return /^#[0-9a-fA-F]{3,8}$/.test(value.trim()) ? value.trim() : "#4f46e5";
};

/**
 * The same palette and hash the frontend uses for its own avatar
 * (`frontend/src/pages/editor/shared.ts`), so a person sees the colour everyone
 * else sees. It is derived here rather than read from the client: the colour is
 * how a team recognises each other, and a value the browser picks is a value a
 * browser can also pick to look like somebody else.
 */
const PRESENCE_COLORS = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#84cc16",
  "#22c55e",
  "#10b981",
  "#14b8a6",
  "#06b6d4",
  "#0ea5e9",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#a855f7",
  "#d946ef",
  "#ec4899",
  "#f43f5e",
] as const;

const hashSeed = (seed: string): number => {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = seed.charCodeAt(index) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
};

export const derivePresenceColor = (seed: string): string =>
  PRESENCE_COLORS[hashSeed(seed) % PRESENCE_COLORS.length];

const GUEST_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

/**
 * A visitor holding a share link is not an account, so nothing they send about
 * themselves can be checked. Rather than render an unverifiable name next to
 * verified ones, the server names them.
 */
export const deriveGuestName = (seed: string): string => {
  const hash = hashSeed(seed);
  const letter = GUEST_LETTERS[hash % GUEST_LETTERS.length];
  const digit = Math.floor(hash / GUEST_LETTERS.length) % 10;
  return `Guest ${letter}${digit}`;
};
