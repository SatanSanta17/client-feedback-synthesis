# TRD-007: Prompt Editor — View Alternate Master Signal Prompt

> **Status:** Part 1 Increments 1.1–1.2 implemented
> **PRD:** `docs/007-prompt-editor-toggle/prd.md` (approved)
> **Mirrors:** PRD Part 1

---

## Part 1: Contextual Note and Inline Prompt Toggle

### Overview

The Master Signal tab in Settings currently auto-selects which prompt to show (cold-start or incremental) based on app state, with no visibility into the alternate prompt. This TRD adds a contextual info banner above the editor explaining which variant is loaded and when it's used, plus a toggle link to switch to the other variant — fully editable, with dirty-state guards. The change is entirely frontend — no API or database modifications.

---

### Database Model

No changes.

---

### API Endpoints

No changes.

---

### Service Layer

No changes.

---

### Frontend

#### `app/settings/_components/prompt-editor-page-content.tsx` (modified)

This is the only file that changes. The modifications are:

**1. New state: `isViewingAlternate`**

Track whether the admin has manually toggled away from the auto-selected prompt:

```typescript
const [isViewingAlternate, setIsViewingAlternate] = useState(false);
```

Reset to `false` when switching between top-level tabs (Signal Extraction ↔ Master Signal) so the toggle doesn't persist across tab switches.

**2. Derive the currently displayed prompt key**

Currently, `masterSignalKey` is computed from app state and used directly as the tab key. With the toggle, we need to distinguish between the auto-selected key (what the system will use) and the displayed key (what the editor is showing):

```typescript
// The prompt key the system will use on the next generation
const autoSelectedMasterKey: PromptKey =
  hasMasterSignal && !isMasterSignalTainted
    ? "master_signal_incremental"
    : "master_signal_cold_start";

// The prompt key currently displayed in the editor (may differ if toggled)
const displayedMasterKey: PromptKey =
  isViewingAlternate
    ? (autoSelectedMasterKey === "master_signal_incremental"
        ? "master_signal_cold_start"
        : "master_signal_incremental")
    : autoSelectedMasterKey;
```

The `promptTabs` array and `activeTab` state continue to use the auto-selected key as the tab value. But `fetchPrompt` and all editor operations (save, reset, revert, version history) use `displayedMasterKey` when the active tab is the master signal tab.

**3. Override active key for editor operations**

Introduce a derived value `effectiveKey` that represents the actual prompt key being edited:

```typescript
const effectiveKey: PromptKey =
  activeTab === autoSelectedMasterKey
    ? displayedMasterKey
    : activeTab;
```

Replace all usages of `activeTab` in `fetchPrompt` trigger, `handleSave`, `handleReset`, and `handleRevert` with `effectiveKey`. This ensures that when the admin toggles to the alternate prompt, save/reset/revert all target the correct prompt key.

The `fetchPrompt` effect should depend on `effectiveKey` instead of `activeTab`:

```typescript
useEffect(() => {
  fetchPrompt(effectiveKey);
}, [effectiveKey, fetchPrompt]);
```

**4. Toggle handler with dirty guard**

The toggle reuses the existing unsaved changes dialog. Instead of introducing a separate pending state, store the toggle intent in `pendingTab`:

```typescript
function handleTogglePromptVariant() {
  const targetKey = isViewingAlternate ? autoSelectedMasterKey : alternateKey;
  if (isDirty) {
    // Store the target as pending — the discard handler will apply the toggle
    setPendingTab(targetKey);
  } else {
    setIsViewingAlternate((prev) => !prev);
  }
}
```

Update `handleDiscardAndSwitch` to detect when the pending target is a master signal variant toggle (vs. a top-level tab switch):

```typescript
function handleDiscardAndSwitch() {
  if (!pendingTab) return;

  const isMasterVariantToggle =
    pendingTab === "master_signal_cold_start" ||
    pendingTab === "master_signal_incremental";

  if (isMasterVariantToggle && activeTab === autoSelectedMasterKey) {
    // Toggle within the Master Signal tab
    setIsViewingAlternate((prev) => !prev);
  } else {
    // Top-level tab switch
    setActiveTab(pendingTab);
    setIsViewingAlternate(false);
  }
  setPendingTab(null);
}
```

**5. Reset `isViewingAlternate` on top-level tab switch**

In `handleTabChange`, when switching away from or to the Master Signal tab, reset the toggle:

```typescript
function handleTabChange(value: string) {
  const newTab = value as PromptKey;
  if (newTab === activeTab) return;

  if (isDirty) {
    setPendingTab(newTab);
  } else {
    setActiveTab(newTab);
    setIsViewingAlternate(false);
  }
}
```

And in the existing `handleDiscardAndSwitch` for top-level tab switches, `setIsViewingAlternate(false)` is already included above.

**6. Contextual note and toggle link in the render**

Insert a note between the `TabsContent` wrapper and the `PromptEditor`, only when the active tab is the master signal tab:

```tsx
{activeTab === autoSelectedMasterKey && (
  <div className="mb-3 flex items-start justify-between gap-3 rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
    <p>
      {displayedMasterKey === "master_signal_incremental" ? (
        <>
          Editing the <strong>incremental</strong> prompt — used when
          updating an existing master signal with new sessions.
          {displayedMasterKey === autoSelectedMasterKey && (
            <span className="ml-1 inline-flex items-center rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              active
            </span>
          )}
        </>
      ) : (
        <>
          Editing the <strong>cold-start</strong> prompt — used when no
          master signal exists yet or after a session with signals is
          deleted.
          {displayedMasterKey === autoSelectedMasterKey && (
            <span className="ml-1 inline-flex items-center rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              active
            </span>
          )}
        </>
      )}
    </p>
    <button
      type="button"
      onClick={handleTogglePromptVariant}
      disabled={isLoading || isSaving}
      className="shrink-0 text-xs font-medium text-primary underline-offset-2 hover:underline disabled:opacity-50"
    >
      {displayedMasterKey === "master_signal_incremental"
        ? "View cold-start prompt"
        : "View incremental prompt"}
    </button>
  </div>
)}
```

**Design notes:**
- The note uses `bg-muted/50` with a subtle border — visually quiet, doesn't compete with the editor.
- The `(active)` badge only appears when the displayed prompt matches the auto-selected one.
- The toggle link is a plain text button with underline-on-hover — small, unobtrusive.
- When viewing the alternate prompt, the `(active)` badge disappears, making it clear this isn't the one the system will use next.
- The toggle is disabled while loading or saving to prevent race conditions.

---

### Files Changed Summary

| File | Action | What Changes |
|------|--------|-------------|
| `app/settings/_components/prompt-editor-page-content.tsx` | Modified | Add `isViewingAlternate` state, derive `autoSelectedMasterKey`/`displayedMasterKey`/`effectiveKey`, toggle handler with dirty guard, contextual note with active badge and toggle link, reset toggle on top-level tab switch |
| `ARCHITECTURE.md` | Modified | Update Current State to mention prompt variant toggle |
| `CHANGELOG.md` | Modified | Add PRD-007 entry |

---

### Implementation Increments

#### Increment 1.1: Prompt Variant Toggle + Contextual Note

**Scope:**
- Add `isViewingAlternate` state.
- Derive `autoSelectedMasterKey`, `displayedMasterKey`, and `effectiveKey`.
- Replace `activeTab` with `effectiveKey` in `fetchPrompt` trigger, `handleSave`, `handleReset`, `handleRevert`.
- Add `handleTogglePromptVariant` with dirty-guard integration.
- Update `handleTabChange` and `handleDiscardAndSwitch` to handle both toggle and tab-switch cases, reset toggle on top-level switch.
- Render the contextual note with explanation text, `(active)` badge, and toggle link inside the Master Signal `TabsContent`.

**Files modified:**
- `app/settings/_components/prompt-editor-page-content.tsx`

**Verification:** When on the Master Signal tab, the contextual note shows which prompt variant is loaded and why. The toggle link switches to the alternate prompt. Toggling with unsaved changes triggers the discard dialog. Save/reset/revert all target the correct prompt key after toggling. The `(active)` badge appears only on the auto-selected variant. Switching to Signal Extraction and back resets the toggle.

---

#### Increment 1.2: Documentation + Changelog

**Scope:**
- Update `ARCHITECTURE.md` Current State to mention the prompt variant toggle.
- Update `CHANGELOG.md` with PRD-007 entry.

**Files modified:**
- `ARCHITECTURE.md`
- `CHANGELOG.md`

**Verification:** Documentation accurately reflects the new behaviour.
