import { api } from "./client";

export type DrawingPresence = {
  drawingId: string;
  connectedMemberKeys: string[];
  guestCount: number;
};

/**
 * Which of the boards on screen have someone on them.
 *
 * The ids are what the dashboard is showing, not what it is allowed to see: the
 * server checks every one and answers for a board you cannot reach exactly as it
 * answers for an empty one.
 */
export const getDashboardPresence = async (
  drawingIds: readonly string[],
): Promise<DrawingPresence[]> => {
  if (drawingIds.length === 0) return [];
  const response = await api.get<{ results: DrawingPresence[] }>("/dashboard/presence", {
    params: { ids: drawingIds.join(",") },
  });
  return response.data.results;
};
