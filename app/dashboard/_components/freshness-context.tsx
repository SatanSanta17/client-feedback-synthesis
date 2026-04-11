"use client";

import { createContext, useContext } from "react";

// ---------------------------------------------------------------------------
// Lightweight context so every `useDashboardFetch` instance can report its
// latest successful fetch timestamp without prop-drilling through 8 widgets.
// ---------------------------------------------------------------------------

interface FreshnessContextValue {
  /** Called by `useDashboardFetch` after a successful fetch completes. */
  onFetchComplete: () => void;
}

const FreshnessContext = createContext<FreshnessContextValue>({
  onFetchComplete: () => {},
});

export { FreshnessContext };

export function useFreshnessContext(): FreshnessContextValue {
  return useContext(FreshnessContext);
}
