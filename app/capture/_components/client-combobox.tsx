"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Check, Plus, ChevronsUpDown } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Represents a client selection.
 * - `id: string` = existing client selected
 * - `id: null` = new client to be created on form save
 * - `null` = nothing selected
 */
export interface ClientSelection {
  id: string | null
  name: string
}

export interface ClientComboboxProps {
  value: ClientSelection | null
  onChange: (client: ClientSelection | null) => void
  className?: string
}

const DEBOUNCE_MS = 300

export function ClientCombobox({
  value,
  onChange,
  className,
}: ClientComboboxProps) {
  const [inputValue, setInputValue] = useState(value?.name ?? "")
  const [suggestions, setSuggestions] = useState<
    Array<{ id: string; name: string }>
  >([])
  const [isLoading, setIsLoading] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Sync input value when external value changes (e.g. on form reset)
  useEffect(() => {
    setInputValue(value?.name ?? "")
  }, [value?.name])

  const fetchClients = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSuggestions([])
      return
    }
    setIsLoading(true)
    try {
      const params = new URLSearchParams({ q: query.trim() })
      const response = await fetch(`/api/clients?${params.toString()}`)
      if (!response.ok) {
        console.error("[ClientCombobox] fetch failed:", response.status)
        return
      }
      const data = await response.json()
      setSuggestions(data.clients ?? [])
    } catch (err) {
      console.error(
        "[ClientCombobox] fetch error:",
        err instanceof Error ? err.message : err
      )
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Debounced search as user types
  useEffect(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current)
    }

    debounceTimer.current = setTimeout(() => {
      fetchClients(inputValue)
    }, DEBOUNCE_MS)

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current)
      }
    }
  }, [inputValue, fetchClients])

  // Close suggestions when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    setInputValue(newValue)
    setShowSuggestions(true)
    setHighlightedIndex(-1)

    // Immediately set as "new client" while typing
    if (newValue.trim()) {
      onChange({ id: null, name: newValue.trim() })
    } else {
      onChange(null)
    }
  }

  const handleSelectExisting = (client: { id: string; name: string }) => {
    setInputValue(client.name)
    onChange({ id: client.id, name: client.name })
    setShowSuggestions(false)
    setHighlightedIndex(-1)
  }

  const handleCreateNew = () => {
    const trimmed = inputValue.trim()
    if (!trimmed) return
    onChange({ id: null, name: trimmed })
    setShowSuggestions(false)
    setHighlightedIndex(-1)
  }

  // Check if the input exactly matches an existing suggestion (case-insensitive)
  const exactMatchExists = suggestions.some(
    (c) => c.name.toLowerCase() === inputValue.trim().toLowerCase()
  )

  const showCreateOption =
    inputValue.trim().length > 0 && !exactMatchExists && !isLoading

  // Total selectable items for keyboard navigation
  const totalItems = suggestions.length + (showCreateOption ? 1 : 0)

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || totalItems === 0) {
      // Open suggestions on arrow down even when closed
      if (e.key === "ArrowDown" && inputValue.trim()) {
        setShowSuggestions(true)
      }
      return
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        setHighlightedIndex((prev) =>
          prev < totalItems - 1 ? prev + 1 : 0
        )
        break
      case "ArrowUp":
        e.preventDefault()
        setHighlightedIndex((prev) =>
          prev > 0 ? prev - 1 : totalItems - 1
        )
        break
      case "Enter":
        e.preventDefault()
        if (highlightedIndex >= 0) {
          // "Create new" option is at index 0 when showCreateOption is true
          if (showCreateOption && highlightedIndex === 0) {
            handleCreateNew()
          } else {
            const suggestionIndex = showCreateOption
              ? highlightedIndex - 1
              : highlightedIndex
            if (suggestions[suggestionIndex]) {
              handleSelectExisting(suggestions[suggestionIndex])
            }
          }
        } else if (showCreateOption) {
          // Enter with no highlighted item → create new
          handleCreateNew()
        }
        break
      case "Escape":
        setShowSuggestions(false)
        setHighlightedIndex(-1)
        break
    }
  }

  const hasSuggestions = suggestions.length > 0 || showCreateOption
  const isOpen = showSuggestions && inputValue.trim().length > 0 && hasSuggestions

  return (
    <div className={cn("relative flex flex-col gap-1.5", className)} ref={containerRef}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onFocus={() => {
            if (inputValue.trim()) setShowSuggestions(true)
          }}
          onKeyDown={handleKeyDown}
          placeholder="Type client name..."
          className={cn(
            "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors",
            "file:border-0 file:bg-transparent file:text-sm file:font-medium",
            "placeholder:text-muted-foreground",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "pr-8"
          )}
          autoComplete="off"
        />
        <ChevronsUpDown className="absolute right-2.5 top-1/2 -translate-y-1/2 size-4 opacity-50 pointer-events-none" />
      </div>

      {/* Suggestions dropdown */}
      {isOpen && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 rounded-md border border-border bg-popover shadow-md">
          <div className="max-h-48 overflow-y-auto p-1">
            {/* Create new — always first when available */}
            {showCreateOption && (
              <button
                type="button"
                onClick={handleCreateNew}
                onMouseEnter={() => setHighlightedIndex(0)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-primary cursor-pointer",
                  highlightedIndex === 0 && "bg-accent"
                )}
              >
                <Plus className="size-4" />
                Create &ldquo;{inputValue.trim()}&rdquo;
              </button>
            )}

            {/* Existing client suggestions */}
            {suggestions.length > 0 && (
              <>
                {showCreateOption && (
                  <div className="my-1 h-px bg-border" />
                )}
                {suggestions.map((client, index) => {
                  const itemIndex = showCreateOption ? index + 1 : index
                  return (
                    <button
                      type="button"
                      key={client.id}
                      onClick={() => handleSelectExisting(client)}
                      onMouseEnter={() => setHighlightedIndex(itemIndex)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm cursor-pointer",
                        highlightedIndex === itemIndex && "bg-accent"
                      )}
                    >
                      <Check
                        className={cn(
                          "size-4",
                          value?.id === client.id ? "opacity-100" : "opacity-0"
                        )}
                      />
                      {client.name}
                    </button>
                  )
                })}
              </>
            )}

            {isLoading && (
              <div className="px-2 py-1.5 text-sm text-muted-foreground">
                Searching...
              </div>
            )}
          </div>
        </div>
      )}

      {value?.id === null && inputValue.trim() && (
        <p className="text-xs text-muted-foreground">
          New client &ldquo;{value.name}&rdquo; will be created when you save.
        </p>
      )}
    </div>
  )
}
