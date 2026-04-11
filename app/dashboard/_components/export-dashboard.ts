// ---------------------------------------------------------------------------
// exportDashboardAsImage — captures the dashboard container as a PNG with
// an auto-generated filter context header for self-documenting exports.
// html2canvas is dynamically imported to avoid ~200KB in the initial bundle.
// ---------------------------------------------------------------------------

const LOG_PREFIX = "[export-dashboard]";

/**
 * Build a human-readable summary of the active filters for the export header.
 */
function buildFilterSummary(filters: Record<string, string>): string {
  const parts: string[] = [];

  if (filters.clients) {
    parts.push(`Clients: ${filters.clients}`);
  }
  if (filters.dateFrom || filters.dateTo) {
    const from = filters.dateFrom || "…";
    const to = filters.dateTo || "…";
    parts.push(`Date: ${from} – ${to}`);
  }
  if (filters.severity) {
    parts.push(
      `Sentiment: ${filters.severity.charAt(0).toUpperCase() + filters.severity.slice(1)}`
    );
  }
  if (filters.urgency) {
    parts.push(
      `Urgency: ${filters.urgency.charAt(0).toUpperCase() + filters.urgency.slice(1)}`
    );
  }

  return parts.length > 0 ? parts.join("  |  ") : "All data";
}

/**
 * Build a filename from the current date and optional active filter context.
 */
function buildFilename(filters: Record<string, string>): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Add a short suffix for the most distinctive active filter
  let suffix = "";
  if (filters.clients) {
    // Use first client name, kebab-cased
    suffix = `-${filters.clients
      .split(",")[0]
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")}`;
  }

  return `dashboard-${date}${suffix}.png`;
}

/**
 * Capture the dashboard container as a PNG and trigger a browser download.
 *
 * @param containerEl  The DOM element wrapping the dashboard content.
 * @param activeFilters  Current URL filter params (key → value).
 */
export async function exportDashboardAsImage(
  containerEl: HTMLElement,
  activeFilters: Record<string, string>
): Promise<void> {
  console.log(LOG_PREFIX, "Export started");

  // 1. Create temporary header showing filter context
  const header = document.createElement("div");
  header.setAttribute("data-export-header", "true");
  header.style.cssText = [
    "padding: 12px 16px",
    "margin-bottom: 12px",
    "background: #f8fafc",
    "border: 1px solid #e2e8f0",
    "border-radius: 8px",
    "font-family: system-ui, sans-serif",
    "font-size: 13px",
    "color: #475569",
    "line-height: 1.4",
  ].join(";");
  header.textContent = `Synthesiser Dashboard  ·  ${buildFilterSummary(activeFilters)}  ·  Exported ${new Date().toLocaleString()}`;
  containerEl.prepend(header);

  try {
    // 2. Dynamically import html2canvas
    const { default: html2canvas } = await import("html2canvas");

    // 3. Capture
    const canvas = await html2canvas(containerEl, {
      useCORS: true,
      scale: 2, // retina quality
      backgroundColor: "#ffffff",
    });

    // 4. Convert to blob and trigger download
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png")
    );

    if (!blob) {
      throw new Error("Canvas toBlob returned null");
    }

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = buildFilename(activeFilters);
    document.body.appendChild(anchor);
    anchor.click();

    // Cleanup
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);

    console.log(LOG_PREFIX, "Export complete");
  } catch (err) {
    console.error(
      LOG_PREFIX,
      "Export failed:",
      err instanceof Error ? err.message : err
    );
    throw err;
  } finally {
    // 5. Always remove the temporary header
    header.remove();
  }
}
