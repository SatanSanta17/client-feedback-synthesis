"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { ChevronsUpDown, Check, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandLoading,
} from "@/components/ui/command"

export interface ClientFilterValue {
  id: string
  name: string
}

export interface ClientFilterComboboxProps {
  value: ClientFilterValue | null
  onChange: (client: ClientFilterValue | null) => void
  className?: string
}

const DEBOUNCE_MS = 300

/**
 * Client combobox for filtering — same search pattern as ClientCombobox
 * but without the "create new" option. Includes "All clients" clear option.
 * Fetches only clients that have at least one session.
 */
export function ClientFilterCombobox({
  value,
  onChange,
  className,
}: ClientFilterComboboxProps) {
  const [open, setOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([])
  const [isLoading, setIsLoading] = useState(false)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchClients = useCallback(async (query: string) => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams({ hasSession: "true" })
      if (query.trim()) {
        params.set("q", query.trim())
      }
      const response = await fetch(`/api/clients?${params.toString()}`)
      if (!response.ok) {
        console.error("[ClientFilterCombobox] fetch failed:", response.status)
        return
      }
      const data = await response.json()
      setClients(data.clients ?? [])
    } catch (err) {
      console.error(
        "[ClientFilterCombobox] fetch error:",
        err instanceof Error ? err.message : err
      )
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Fetch when popover opens
  useEffect(() => {
    if (open) {
      fetchClients(searchQuery)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced search
  useEffect(() => {
    if (!open) return

    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current)
    }

    debounceTimer.current = setTimeout(() => {
      fetchClients(searchQuery)
    }, DEBOUNCE_MS)

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current)
      }
    }
  }, [searchQuery, open, fetchClients])

  const handleSelect = (client: { id: string; name: string }) => {
    onChange({ id: client.id, name: client.name })
    setSearchQuery("")
    setOpen(false)
  }

  const handleClear = () => {
    onChange(null)
    setSearchQuery("")
    setOpen(false)
  }

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-48 justify-between font-normal"
          >
            {value ? (
              <span className="truncate">{value.name}</span>
            ) : (
              <span className="text-muted-foreground">All clients</span>
            )}
            <ChevronsUpDown className="ml-2 size-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-48 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search clients..."
              value={searchQuery}
              onValueChange={setSearchQuery}
            />
            <CommandList>
              {isLoading && (
                <CommandLoading>
                  <span className="text-muted-foreground">Searching...</span>
                </CommandLoading>
              )}

              {!isLoading && clients.length === 0 && (
                <CommandEmpty>No clients found.</CommandEmpty>
              )}

              {clients.length > 0 && (
                <CommandGroup>
                  {clients.map((client) => (
                    <CommandItem
                      key={client.id}
                      value={client.id}
                      onSelect={() => handleSelect(client)}
                    >
                      <Check
                        className={cn(
                          "mr-2 size-3.5",
                          value?.id === client.id ? "opacity-100" : "opacity-0"
                        )}
                      />
                      {client.name}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {value && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={handleClear}
          aria-label="Clear client filter"
        >
          <X className="size-3.5" />
        </Button>
      )}
    </div>
  )
}
