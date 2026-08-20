import React from "react";
import { Bot, Shield } from "lucide-react";

export type AdminTab = "users" | "agents";

type AdminTabsHeaderProps = {
  active: AdminTab;
  onChange: (tab: AdminTab) => void;
  loading?: boolean;
};

const TABS: { id: AdminTab; label: string; icon: typeof Shield }[] = [
  { id: "users", label: "Users", icon: Shield },
  { id: "agents", label: "Agents", icon: Bot },
];

/** One header for both tables, so switching does not move anything on screen. */
export const AdminTabsHeader: React.FC<AdminTabsHeaderProps> = ({
  active,
  onChange,
  loading,
}) => (
  <div className="px-4 sm:px-6 py-4 border-b-2 border-slate-200 dark:border-neutral-700 flex items-center gap-3">
    {TABS.map(({ id, label, icon: Icon }) => {
      const selected = active === id;
      return (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          aria-pressed={selected}
          className={`flex items-center gap-2 px-3 py-2 rounded-xl border-2 font-bold transition-all ${
            selected
              ? "border-indigo-200 dark:border-neutral-600 bg-indigo-50 dark:bg-neutral-800 text-slate-900 dark:text-white"
              : "border-transparent text-slate-500 dark:text-neutral-400 hover:text-slate-800 dark:hover:text-neutral-200"
          }`}
        >
          <Icon size={18} className={selected ? "text-indigo-600 dark:text-indigo-400" : ""} />
          <span className="text-lg">{label}</span>
        </button>
      );
    })}
    {loading && (
      <span className="text-sm text-slate-500 dark:text-neutral-500 font-medium">
        Loading…
      </span>
    )}
  </div>
);
