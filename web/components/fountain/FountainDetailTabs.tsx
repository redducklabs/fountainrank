"use client";

import type React from "react";
import { createContext, useContext, useId, useState } from "react";

export type FountainDetailTab = {
  id: "primary" | "details" | "photos";
  label: string;
  content: React.ReactNode;
};

const FountainDetailTabsContext = createContext<{
  setActive: (id: FountainDetailTab["id"]) => void;
} | null>(null);

/** Read the enclosing tabs controller — lets content inside a tab body (the Info
 *  `PhotoHero`) switch to another tab. Throws if used outside `FountainDetailTabs`. */
export function useFountainDetailTabs() {
  const ctx = useContext(FountainDetailTabsContext);
  if (!ctx) throw new Error("useFountainDetailTabs must be used within FountainDetailTabs");
  return ctx;
}

export function FountainDetailTabs({ tabs }: { tabs: FountainDetailTab[] }) {
  const baseId = useId();
  const [active, setActive] = useState<FountainDetailTab["id"]>(tabs[0]?.id ?? "primary");
  const activeTab = tabs.find((tab) => tab.id === active) ?? tabs[0];

  return (
    <FountainDetailTabsContext.Provider value={{ setActive }}>
      <div className="flex min-h-0 flex-1 flex-col">
        <div
          role="tablist"
          aria-label="Fountain detail sections"
          className="mr-14 grid grid-cols-3 border-b border-border bg-surface-raised"
        >
          {tabs.map((tab) => {
            const selected = tab.id === activeTab.id;
            const tabId = `${baseId}-${tab.id}-tab`;
            const panelId = `${baseId}-${tab.id}-panel`;
            return (
              <button
                key={tab.id}
                id={tabId}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={panelId}
                onClick={() => setActive(tab.id)}
                className={`min-h-12 border-b-2 px-2 text-sm font-bold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset ${
                  selected
                    ? "border-brand bg-surface text-brand-ink"
                    : "border-transparent text-muted hover:bg-surface hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        {tabs.map((tab) => {
          const selected = tab.id === activeTab.id;
          return (
            <div
              key={tab.id}
              id={`${baseId}-${tab.id}-panel`}
              role="tabpanel"
              aria-labelledby={`${baseId}-${tab.id}-tab`}
              hidden={!selected}
              className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
            >
              {tab.content}
            </div>
          );
        })}
      </div>
    </FountainDetailTabsContext.Provider>
  );
}
