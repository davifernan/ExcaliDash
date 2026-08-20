import React from "react";
import { AdminTabsHeader, type AdminTab } from "./AdminTabsHeader";

export type AdminApiKey = {
  id: string;
  name: string;
  prefix: string;
  scopes: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  user: { id: string; name: string; email: string; username: string | null };
};

type AgentsTableProps = {
  apiKeys: AdminApiKey[];
  loading: boolean;
  revokingId: string | null;
  activeTab: AdminTab;
  onTabChange: (tab: AdminTab) => void;
  onRevoke: (key: AdminApiKey) => void;
};

const formatDate = (value: string | null): string =>
  value ? new Date(value).toLocaleDateString() : "never";

export const AgentsTable: React.FC<AgentsTableProps> = ({
  apiKeys,
  loading,
  revokingId,
  activeTab,
  onTabChange,
  onRevoke,
}) => (
  <div className="bg-white dark:bg-neutral-900 border-2 border-black dark:border-neutral-700 rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.2)] overflow-hidden">
    <AdminTabsHeader active={activeTab} onChange={onTabChange} loading={loading} />

    <div className="px-4 sm:px-6 py-3 text-sm text-slate-600 dark:text-neutral-400 border-b-2 border-slate-100 dark:border-neutral-800">
      An agent acts as the user its key belongs to, so anything it creates is already theirs. Users
      create keys under <strong>Profile → API keys</strong>.
    </div>

    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 dark:bg-neutral-800/70">
          <tr className="text-left">
            <th className="px-4 sm:px-6 py-3 font-bold text-slate-600 dark:text-neutral-300">
              Agent
            </th>
            <th className="px-4 sm:px-6 py-3 font-bold text-slate-600 dark:text-neutral-300">
              Acts as
            </th>
            <th className="px-4 sm:px-6 py-3 font-bold text-slate-600 dark:text-neutral-300">
              Scopes
            </th>
            <th className="px-4 sm:px-6 py-3 font-bold text-slate-600 dark:text-neutral-300">
              Last used
            </th>
            <th className="px-4 sm:px-6 py-3 font-bold text-slate-600 dark:text-neutral-300">
              Status
            </th>
            <th className="px-4 sm:px-6 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-neutral-800">
          {apiKeys.length === 0 && !loading && (
            <tr>
              <td
                colSpan={6}
                className="px-4 sm:px-6 py-8 text-center text-slate-500 dark:text-neutral-400"
              >
                No agents yet.
              </td>
            </tr>
          )}
          {apiKeys.map((key) => (
            <tr key={key.id} className={key.revokedAt ? "opacity-60" : ""}>
              <td className="px-4 sm:px-6 py-3">
                <div className="font-bold text-slate-900 dark:text-white">{key.name}</div>
                <div className="text-xs text-slate-500 dark:text-neutral-400 font-mono">
                  {key.prefix}…
                </div>
              </td>
              <td className="px-4 sm:px-6 py-3">
                <div className="text-slate-900 dark:text-white">{key.user.name}</div>
                <div className="text-xs text-slate-500 dark:text-neutral-400">{key.user.email}</div>
              </td>
              <td className="px-4 sm:px-6 py-3">
                <div className="flex flex-wrap gap-1">
                  {key.scopes
                    .split(",")
                    .filter(Boolean)
                    .map((scope) => (
                      <span
                        key={scope}
                        className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-neutral-800 text-xs text-slate-700 dark:text-neutral-300 font-mono"
                      >
                        {scope.trim()}
                      </span>
                    ))}
                </div>
              </td>
              <td className="px-4 sm:px-6 py-3 text-slate-600 dark:text-neutral-400">
                {formatDate(key.lastUsedAt)}
              </td>
              <td className="px-4 sm:px-6 py-3">
                {key.revokedAt ? (
                  <span className="text-slate-500 dark:text-neutral-400 font-bold">Revoked</span>
                ) : (
                  <span className="text-emerald-600 dark:text-emerald-400 font-bold">Active</span>
                )}
              </td>
              <td className="px-4 sm:px-6 py-3 text-right">
                {!key.revokedAt && (
                  <button
                    type="button"
                    onClick={() => onRevoke(key)}
                    disabled={revokingId === key.id}
                    className="px-3 py-2 rounded-xl border-2 border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 font-bold text-xs disabled:opacity-60"
                  >
                    {revokingId === key.id ? "Revoking…" : "Revoke"}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);
