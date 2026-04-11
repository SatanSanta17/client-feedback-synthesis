"use client";

import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";
import { DashboardCard } from "./dashboard-card";
import { useDashboardFetch } from "./use-dashboard-fetch";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ThemeClientMatrixWidgetProps {
  className?: string;
}

interface ThemeMeta {
  id: string;
  name: string;
}

interface ClientMeta {
  id: string;
  name: string;
}

interface Cell {
  themeId: string;
  clientId: string;
  count: number;
}

interface MatrixData {
  themes: ThemeMeta[];
  clients: ClientMeta[];
  cells: Cell[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Brand primary colour in RGB — used for heatmap opacity mapping. */
const BRAND_RGB = "99, 102, 241"; // indigo-500

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a lookup map from the sparse cells array.
 * Key: "themeId|clientId", Value: count.
 */
function buildCellMap(cells: Cell[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of cells) {
    m.set(`${c.themeId}|${c.clientId}`, c.count);
  }
  return m;
}

// ---------------------------------------------------------------------------
// Tooltip (custom positioned via mouse)
// ---------------------------------------------------------------------------

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  themeName: string;
  clientName: string;
  count: number;
}

const INITIAL_TOOLTIP: TooltipState = {
  visible: false,
  x: 0,
  y: 0,
  themeName: "",
  clientName: "",
  count: 0,
};

// ---------------------------------------------------------------------------
// ThemeClientMatrixWidget
// ---------------------------------------------------------------------------

export function ThemeClientMatrixWidget({
  className,
}: ThemeClientMatrixWidgetProps) {
  const { data, isLoading, error, refetch } =
    useDashboardFetch<MatrixData>({ action: "theme_client_matrix" });

  const [tooltip, setTooltip] = useState<TooltipState>(INITIAL_TOOLTIP);

  const themes = data?.themes ?? [];
  const clients = data?.clients ?? [];
  const cells = data?.cells ?? [];
  const isEmpty = themes.length === 0 || clients.length === 0;

  const cellMap = useMemo(() => buildCellMap(cells), [cells]);

  const maxCount = useMemo(() => {
    let max = 0;
    for (const c of cells) {
      if (c.count > max) max = c.count;
    }
    return max;
  }, [cells]);

  // Name lookup maps for tooltip
  const themeNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of themes) m.set(t.id, t.name);
    return m;
  }, [themes]);

  const clientNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of clients) m.set(c.id, c.name);
    return m;
  }, [clients]);

  const handleCellHover = (
    e: React.MouseEvent,
    themeId: string,
    clientId: string,
    count: number
  ) => {
    const rect = (e.currentTarget as HTMLElement).closest(
      "[data-matrix-container]"
    );
    const containerRect = rect?.getBoundingClientRect();
    const cellRect = (e.currentTarget as HTMLElement).getBoundingClientRect();

    setTooltip({
      visible: true,
      x: cellRect.left - (containerRect?.left ?? 0) + cellRect.width / 2,
      y: cellRect.top - (containerRect?.top ?? 0) - 4,
      themeName: themeNameMap.get(themeId) ?? themeId,
      clientName: clientNameMap.get(clientId) ?? clientId,
      count,
    });
  };

  const handleCellLeave = () => {
    setTooltip(INITIAL_TOOLTIP);
  };

  return (
    <DashboardCard
      title="Theme–Client Matrix"
      isLoading={isLoading}
      error={error}
      onRetry={refetch}
      isEmpty={isEmpty}
      emptyMessage="Themes will appear as you extract more sessions"
      className={cn("lg:col-span-3", className)}
    >
      <div
        data-matrix-container=""
        className="relative max-h-[420px] overflow-auto"
      >
        {/* Tooltip */}
        {tooltip.visible && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border bg-white px-2.5 py-1.5 text-xs shadow-md"
            style={{ left: tooltip.x, top: tooltip.y }}
          >
            <p className="font-medium text-gray-900">
              {tooltip.themeName} + {tooltip.clientName}
            </p>
            <p className="text-gray-500">
              {tooltip.count} signal{tooltip.count !== 1 ? "s" : ""}
            </p>
          </div>
        )}

        {/* Grid table */}
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              {/* Empty corner cell */}
              <th className="sticky left-0 top-0 z-20 min-w-[120px] bg-[var(--surface-page)] p-2 text-left font-medium text-[var(--text-secondary)]" />
              {clients.map((client) => (
                <th
                  key={client.id}
                  className="sticky top-0 z-10 min-w-[80px] bg-[var(--surface-page)] p-2 text-center font-medium text-[var(--text-secondary)]"
                >
                  <span className="block max-w-[80px] truncate" title={client.name}>
                    {client.name}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {themes.map((theme) => (
              <tr key={theme.id}>
                <td className="sticky left-0 z-10 bg-[var(--surface-page)] p-2 font-medium text-[var(--text-primary)]">
                  <span
                    className="block max-w-[120px] truncate"
                    title={theme.name}
                  >
                    {theme.name}
                  </span>
                </td>
                {clients.map((client) => {
                  const key = `${theme.id}|${client.id}`;
                  const count = cellMap.get(key) ?? 0;
                  const opacity =
                    maxCount > 0 ? Math.max(0.08, count / maxCount) : 0;

                  return (
                    <td
                      key={client.id}
                      className="cursor-pointer p-1 text-center transition-transform hover:scale-105"
                      onMouseEnter={(e) =>
                        handleCellHover(e, theme.id, client.id, count)
                      }
                      onMouseLeave={handleCellLeave}
                      onClick={() => {
                        // Drill-down wired in Part 4
                        console.log(
                          "[ThemeClientMatrixWidget] clicked:",
                          { themeId: theme.id, clientId: client.id }
                        );
                      }}
                    >
                      <div
                        className="flex h-8 items-center justify-center rounded-md text-xs font-medium"
                        style={{
                          backgroundColor:
                            count > 0
                              ? `rgba(${BRAND_RGB}, ${opacity})`
                              : "transparent",
                          color:
                            count > 0
                              ? opacity > 0.5
                                ? "#fff"
                                : `rgb(${BRAND_RGB})`
                              : "var(--text-tertiary)",
                        }}
                      >
                        {count > 0 ? count : "–"}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DashboardCard>
  );
}
