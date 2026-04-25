"use client"

import { useState, useEffect } from "react"

import { cn } from "@/lib/utils"

interface PromptVersionOption {
  id: string
  versionNumber: number
}

/** Filter value: undefined = all, "null" = default prompt version, string UUID = specific version */
export type PromptVersionFilterValue = string | undefined

interface PromptVersionFilterProps {
  value: PromptVersionFilterValue
  onChange: (value: PromptVersionFilterValue) => void
  className?: string
}

export function PromptVersionFilter({
  value,
  onChange,
  className,
}: PromptVersionFilterProps) {
  const [options, setOptions] = useState<PromptVersionOption[]>([])
  const [hasNull, setHasNull] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    fetch("/api/sessions/prompt-versions")
      .then((res) => (res.ok ? res.json() : { versions: [], hasNull: false }))
      .then((data) => {
        if (!cancelled) {
          setOptions(data.versions ?? [])
          setHasNull(data.hasNull ?? false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOptions([])
          setHasNull(false)
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => { cancelled = true }
  }, [])

  // Don't render if no options at all (no prompt versions and no null entries)
  if (!isLoading && options.length === 0 && !hasNull) {
    return null
  }

  return (
    <select
      value={value ?? ""}
      onChange={(e) => {
        const val = e.target.value
        onChange(val === "" ? undefined : val)
      }}
      disabled={isLoading}
      className={cn(
        "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        className
      )}
    >
      <option value="">All versions</option>
      {options.map((opt) => (
        <option key={opt.id} value={opt.id}>
          Prompt v{opt.versionNumber}
        </option>
      ))}
      {hasNull && (
        <option value="null">Default prompt</option>
      )}
    </select>
  )
}
