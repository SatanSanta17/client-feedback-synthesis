"use client"

import { cn } from "@/lib/utils"

export interface DatePickerProps {
  value: string
  onChange: (date: string) => void
  min?: string
  max?: string
  className?: string
}

function getToday(): string {
  return new Date().toISOString().split("T")[0]
}

export function DatePicker({ value, onChange, min, max, className }: DatePickerProps) {
  return (
    <input
      type="date"
      value={value}
      min={min}
      max={max ?? getToday()}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30",
        className
      )}
    />
  )
}
