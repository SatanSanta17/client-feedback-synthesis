// ---------------------------------------------------------------------------
// Bounded Concurrency — PRD-033 Part 2 / TRD § 2.3.
//
// Pure function: runs N async tasks with at most `concurrency` in flight at
// a time, returns results in input order. Errors do NOT abort the batch —
// each task's result is wrapped in a discriminated union so the caller can
// mark partial coverage per row (PRD P2.R5).
//
// Used by summarise-sessions-service to fan out per-session summaries to
// the cheap model. No Supabase / no AI imports — testable in isolation.
// ---------------------------------------------------------------------------

export type TaskResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: Error };

export async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
  onProgress?: (completed: number, total: number) => void
): Promise<TaskResult<T>[]> {
  const results: TaskResult<T>[] = new Array(tasks.length);
  let next = 0;
  let completed = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= tasks.length) return;
      try {
        const value = await tasks[i]();
        results[i] = { ok: true, value };
      } catch (err) {
        results[i] = {
          ok: false,
          error: err instanceof Error ? err : new Error(String(err)),
        };
      } finally {
        completed += 1;
        onProgress?.(completed, tasks.length);
      }
    }
  }

  if (tasks.length === 0) return results;

  const workerCount = Math.max(1, Math.min(concurrency, tasks.length));
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);
  return results;
}
