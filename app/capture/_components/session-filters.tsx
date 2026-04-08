"use client"

import { X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  ClientFilterCombobox,
  type ClientFilterValue,
} from "./client-filter-combobox"
import { DatePicker } from "./date-picker"
import {
  PromptVersionFilter,
  type PromptVersionFilterValue,
} from "./prompt-version-filter"

export interface SessionFiltersState {
  clientId?: string
  clientName?: string
  dateFrom: string
  dateTo: string
  promptVersionId?: PromptVersionFilterValue
}

export interface SessionFiltersProps {
  filters: SessionFiltersState
  onFiltersChange: (filters: SessionFiltersState) => void
}

export function SessionFilters({
  filters,
  onFiltersChange,
}: SessionFiltersProps) {
  const clientValue: ClientFilterValue | null =
    filters.clientId && filters.clientName
      ? { id: filters.clientId, name: filters.clientName }
      : null

  const handleClientChange = (client: ClientFilterValue | null) => {
    onFiltersChange({
      ...filters,
      clientId: client?.id ?? undefined,
      clientName: client?.name ?? undefined,
    })
  }

  const handleDateFromChange = (date: string) => {
    const updated = { ...filters, dateFrom: date }
    if (date && filters.dateTo && date > filters.dateTo) {
      updated.dateTo = date
    }
    onFiltersChange(updated)
  }

  const handleDateToChange = (date: string) => {
    const updated = { ...filters, dateTo: date }
    if (date && filters.dateFrom && date < filters.dateFrom) {
      updated.dateFrom = date
    }
    onFiltersChange(updated)
  }

  const handlePromptVersionChange = (value: PromptVersionFilterValue) => {
    onFiltersChange({ ...filters, promptVersionId: value })
  }

  return (
    <div className="flex flex-wrap items-end gap-4">
      {/* Client filter */}
      <div className="flex flex-col gap-1">
        <Label className="text-xs text-muted-foreground">Client</Label>
        <ClientFilterCombobox
          value={clientValue}
          onChange={handleClientChange}
        />
      </div>

      {/* Date from filter */}
      <div className="flex flex-col gap-1">
        <Label className="text-xs text-muted-foreground">From</Label>
        <div className="flex items-center gap-1">
          <DatePicker
            value={filters.dateFrom}
            onChange={handleDateFromChange}
            className="w-36"
          />
          {filters.dateFrom && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => onFiltersChange({ ...filters, dateFrom: "" })}
              aria-label="Clear from date"
            >
              <X className="size-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Date to filter */}
      <div className="flex flex-col gap-1">
        <Label className="text-xs text-muted-foreground">To</Label>
        <div className="flex items-center gap-1">
          <DatePicker
            value={filters.dateTo}
            onChange={handleDateToChange}
            className="w-36"
          />
          {filters.dateTo && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => onFiltersChange({ ...filters, dateTo: "" })}
              aria-label="Clear to date"
            >
              <X className="size-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Prompt version filter */}
      <div className="flex flex-col gap-1">
        <Label className="text-xs text-muted-foreground">Prompt version</Label>
        <PromptVersionFilter
          value={filters.promptVersionId}
          onChange={handlePromptVersionChange}
        />
      </div>
    </div>
  )
}
