"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Camera, Check, ChevronsUpDown, Loader2, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useFilterStorage } from "@/lib/hooks/use-filter-storage";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FilterBarProps {
  className?: string;
  onExport?: () => void;
  isExporting?: boolean;
}

interface ClientOption {
  id: string;
  name: string;
}

const SEVERITY_OPTIONS = ["positive", "negative", "neutral", "mixed"] as const;
const URGENCY_OPTIONS = ["low", "medium", "high", "critical"] as const;
const FILTER_PARAM_KEYS = [
  "clients",
  "dateFrom",
  "dateTo",
  "severity",
  "urgency",
] as const;

type DashboardFilters = Partial<Record<(typeof FILTER_PARAM_KEYS)[number], string>>;

// ---------------------------------------------------------------------------
// FilterBar
// ---------------------------------------------------------------------------

export function FilterBar({ className, onExport, isExporting }: FilterBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const filterStorage = useFilterStorage<DashboardFilters>("dashboard");
  const hydratedKeyRef = useRef<string | null>(null);

  // Client multi-select state
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [clientPopoverOpen, setClientPopoverOpen] = useState(false);

  // Read initial values from URL
  const selectedClientIds = searchParams.get("clients")?.split(",").filter(Boolean) ?? [];
  const dateFrom = searchParams.get("dateFrom") ?? "";
  const dateTo = searchParams.get("dateTo") ?? "";
  const severity = searchParams.get("severity") ?? "";
  const urgency = searchParams.get("urgency") ?? "";

  const hasActiveFilters =
    selectedClientIds.length > 0 ||
    dateFrom.length > 0 ||
    dateTo.length > 0 ||
    severity.length > 0 ||
    urgency.length > 0;

  // -------------------------------------------------------------------------
  // Filter persistence (P5) — writes are user-action-driven (inside
  // updateParam / clearAllFilters) so they never race with workspace
  // switching. This effect only hydrates from storage when the key changes.
  //
  // First key seen (mount): respect URL if it already has filters
  // (honours shared deep-links); otherwise restore from storage.
  // Subsequent key changes (workspace switch): force URL to match storage
  // — don't trust the URL mid-transition, storage is authoritative.
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!filterStorage.key) return;
    if (hydratedKeyRef.current === filterStorage.key) return;

    const isFirstKey = hydratedKeyRef.current === null;
    hydratedKeyRef.current = filterStorage.key;

    if (isFirstKey) {
      const urlHasFilters = FILTER_PARAM_KEYS.some((k) => searchParams.has(k));
      if (urlHasFilters) return;
    }

    const stored = filterStorage.read();
    const params = new URLSearchParams();
    if (stored) {
      FILTER_PARAM_KEYS.forEach((k) => {
        const v = stored[k];
        if (v) params.set(k, v);
      });
    }
    const query = params.toString();
    router.replace(query ? `/dashboard?${query}` : "/dashboard", {
      scroll: false,
    });
  }, [filterStorage, router, searchParams]);

  // Fetch client list on mount
  useEffect(() => {
    setClientsLoading(true);
    fetch("/api/dashboard?action=client_list")
      .then((res) => res.json())
      .then((result) => {
        const list = (result.data?.clients ?? []) as ClientOption[];
        setClients(list);
      })
      .catch((err) => {
        console.error("[FilterBar] Failed to fetch clients:", err);
      })
      .finally(() => setClientsLoading(false));
  }, []);

  // ---------------------------------------------------------------------------
  // URL update helper — merges params without full reload
  // ---------------------------------------------------------------------------

  const updateParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      router.replace(`/dashboard?${params.toString()}`, { scroll: false });

      const snapshot: DashboardFilters = {};
      FILTER_PARAM_KEYS.forEach((k) => {
        const v = params.get(k);
        if (v) snapshot[k] = v;
      });
      filterStorage.write(snapshot);
    },
    [router, searchParams, filterStorage]
  );

  const clearAllFilters = useCallback(() => {
    router.replace("/dashboard", { scroll: false });
    filterStorage.write({});
  }, [router, filterStorage]);

  // ---------------------------------------------------------------------------
  // Client multi-select toggle
  // ---------------------------------------------------------------------------

  const toggleClient = useCallback(
    (clientId: string) => {
      const current = new Set(selectedClientIds);
      if (current.has(clientId)) {
        current.delete(clientId);
      } else {
        current.add(clientId);
      }
      const value = Array.from(current).join(",");
      updateParam("clients", value);
    },
    [selectedClientIds, updateParam]
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const selectedClientNames = selectedClientIds
    .map((id) => clients.find((c) => c.id === id)?.name)
    .filter(Boolean);

  const clientLabel =
    selectedClientNames.length === 0
      ? "All clients"
      : selectedClientNames.length <= 2
        ? selectedClientNames.join(", ")
        : `${selectedClientNames.length} clients`;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border-default)] bg-[var(--surface-page)] px-4 py-3",
        className
      )}
    >
      {/* ---- Client multi-select (Popover + Command) ---- */}
      <Popover open={clientPopoverOpen} onOpenChange={setClientPopoverOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            role="combobox"
            aria-expanded={clientPopoverOpen}
            className="min-w-[140px] justify-between"
          >
            <span className="truncate">{clientLabel}</span>
            <ChevronsUpDown className="ml-1 size-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-0" align="start">
          <Command>
            <CommandInput placeholder="Search clients…" />
            <CommandList>
              <CommandEmpty>
                {clientsLoading ? "Loading…" : "No clients found."}
              </CommandEmpty>
              <CommandGroup>
                {clients.map((client) => {
                  const isSelected = selectedClientIds.includes(client.id);
                  return (
                    <CommandItem
                      key={client.id}
                      value={client.name}
                      onSelect={() => toggleClient(client.id)}
                    >
                      <Check
                        className={cn(
                          "mr-2 size-4",
                          isSelected ? "opacity-100" : "opacity-0"
                        )}
                      />
                      {client.name}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* ---- Date From ---- */}
      <input
        type="date"
        aria-label="From date"
        value={dateFrom}
        onChange={(e) => updateParam("dateFrom", e.target.value)}
        className="h-7 rounded-md border border-[var(--border-default)] bg-transparent px-2 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--brand-primary)]"
      />

      {/* ---- Date To ---- */}
      <input
        type="date"
        aria-label="To date"
        value={dateTo}
        onChange={(e) => updateParam("dateTo", e.target.value)}
        className="h-7 rounded-md border border-[var(--border-default)] bg-transparent px-2 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--brand-primary)]"
      />

      {/* ---- Severity (sentiment) ---- */}
      <Select
        value={severity || undefined}
        onValueChange={(v) => updateParam("severity", v === "all" ? "" : v)}
      >
        <SelectTrigger size="sm" className="min-w-[100px]">
          <SelectValue placeholder="Sentiment" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All sentiments</SelectItem>
          {SEVERITY_OPTIONS.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt.charAt(0).toUpperCase() + opt.slice(1)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* ---- Urgency ---- */}
      <Select
        value={urgency || undefined}
        onValueChange={(v) => updateParam("urgency", v === "all" ? "" : v)}
      >
        <SelectTrigger size="sm" className="min-w-[100px]">
          <SelectValue placeholder="Urgency" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All urgencies</SelectItem>
          {URGENCY_OPTIONS.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt.charAt(0).toUpperCase() + opt.slice(1)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* ---- Clear filters ---- */}
      {hasActiveFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={clearAllFilters}
          className="text-[var(--text-secondary)]"
        >
          <X className="mr-1 size-3.5" />
          Clear filters
        </Button>
      )}

      {/* ---- Export as image ---- */}
      {onExport && (
        <Button
          variant="outline"
          size="sm"
          onClick={onExport}
          disabled={isExporting}
          className="ml-auto text-[var(--text-secondary)]"
        >
          {isExporting ? (
            <Loader2 className="mr-1 size-3.5 animate-spin" />
          ) : (
            <Camera className="mr-1 size-3.5" />
          )}
          {isExporting ? "Exporting…" : "Export as Image"}
        </Button>
      )}
    </div>
  );
}
