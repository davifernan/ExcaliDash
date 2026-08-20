import { useSyncExternalStore } from "react";

export type DashboardDataStatus = {
  drawingsError: string | null;
  collectionsError: string | null;
  loadMoreError: string | null;
  retryDrawings?: () => void;
  retryCollections?: () => void;
  retryMore?: () => void;
};

const emptyStatus: DashboardDataStatus = {
  drawingsError: null,
  collectionsError: null,
  loadMoreError: null,
};

let status = emptyStatus;
const listeners = new Set<() => void>();

export const setDashboardDataStatus = (
  update: Partial<DashboardDataStatus>,
) => {
  status = { ...status, ...update };
  listeners.forEach((listener) => listener());
};

export const resetDashboardDataStatus = () => {
  status = emptyStatus;
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = () => status;

export const useDashboardDataStatus = () =>
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
