/**
 * Master Signal PDF Generator (client-side)
 *
 * Uses pdf-lib to generate a styled PDF from the master signal markdown
 * directly in the browser. No server round-trip needed.
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib"

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const PAGE_WIDTH = 595 // A4
const PAGE_HEIGHT = 842
const MARGIN_TOP = 60
const MARGIN_BOTTOM = 60
const MARGIN_LEFT = 50
const MARGIN_RIGHT = 50
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT

const FONT_SIZE_TITLE = 20
const FONT_SIZE_H2 = 14
const FONT_SIZE_H3 = 12
const FONT_SIZE_BODY = 10
const FONT_SIZE_META = 8

const LINE_HEIGHT_TITLE = 28
const LINE_HEIGHT_H2 = 20
const LINE_HEIGHT_H3 = 17
const LINE_HEIGHT_BODY = 14

const SPACE_AFTER_TITLE = 8
const SPACE_AFTER_H2 = 6
const SPACE_AFTER_H3 = 4
const SPACE_AFTER_PARA = 8
const SPACE_AFTER_BULLET = 4
const SPACE_BEFORE_H2 = 16
const SPACE_BEFORE_H3 = 10

const BRAND_COLOR = rgb(79 / 255, 70 / 255, 229 / 255) // Indigo-600
const TEXT_COLOR = rgb(17 / 255, 24 / 255, 39 / 255) // Gray-900
const META_COLOR = rgb(107 / 255, 114 / 255, 128 / 255) // Gray-500
const RULE_COLOR = rgb(229 / 255, 231 / 255, 235 / 255) // Gray-200

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ParsedLine {
  type: "h1" | "h2" | "h3" | "bullet" | "numbered" | "rule" | "paragraph" | "blank"
  text: string
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate and download a PDF of the master signal content.
 * Runs entirely in the browser using pdf-lib.
 */
export async function generateMasterSignalPdf(
  markdownContent: string,
  generatedAt: string,
  sessionsIncluded?: number
): Promise<void> {
  const pdfDoc = await PDFDocument.create()

  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  const lines = parseMarkdown(markdownContent)

  // State
  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  let y = PAGE_HEIGHT - MARGIN_TOP

  // --- Helper: add new page if needed ---
  function ensureSpace(needed: number) {
    if (y - needed < MARGIN_BOTTOM) {
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
      y = PAGE_HEIGHT - MARGIN_TOP
    }
  }

  // --- Helper: word-wrap text ---
  function wrapText(
    text: string,
    font: typeof helvetica,
    fontSize: number,
    maxWidth: number
  ): string[] {
    const words = text.split(/\s+/)
    const wrappedLines: string[] = []
    let currentLine = ""

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word
      const testWidth = font.widthOfTextAtSize(testLine, fontSize)

      if (testWidth > maxWidth && currentLine) {
        wrappedLines.push(currentLine)
        currentLine = word
      } else {
        currentLine = testLine
      }
    }
    if (currentLine) {
      wrappedLines.push(currentLine)
    }

    return wrappedLines.length > 0 ? wrappedLines : [""]
  }

  // --- Header on first page ---
  page.drawText("Master Signal", {
    x: MARGIN_LEFT,
    y,
    size: FONT_SIZE_TITLE,
    font: helveticaBold,
    color: BRAND_COLOR,
  })
  y -= LINE_HEIGHT_TITLE + 2

  // Brand line under title
  page.drawRectangle({
    x: MARGIN_LEFT,
    y,
    width: CONTENT_WIDTH,
    height: 2,
    color: BRAND_COLOR,
  })
  y -= 12

  // Meta line
  const formattedDate = new Date(generatedAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
  const metaText = sessionsIncluded
    ? `Synthesiser  |  Generated ${formattedDate}  |  Based on ${sessionsIncluded} session${sessionsIncluded === 1 ? "" : "s"}`
    : `Synthesiser  |  Generated ${formattedDate}`
  page.drawText(metaText, {
    x: MARGIN_LEFT,
    y,
    size: FONT_SIZE_META,
    font: helvetica,
    color: META_COLOR,
  })
  y -= 24

  // --- Render content ---
  for (const line of lines) {
    switch (line.type) {
      case "blank":
        y -= 6
        break

      case "rule":
        ensureSpace(12)
        y -= 4
        page.drawRectangle({
          x: MARGIN_LEFT,
          y,
          width: CONTENT_WIDTH,
          height: 0.5,
          color: RULE_COLOR,
        })
        y -= 8
        break

      case "h1": {
        const wrapped = wrapText(stripBold(line.text), helveticaBold, FONT_SIZE_TITLE, CONTENT_WIDTH)
        ensureSpace(SPACE_BEFORE_H2 + wrapped.length * LINE_HEIGHT_TITLE)
        y -= SPACE_BEFORE_H2
        for (const wl of wrapped) {
          ensureSpace(LINE_HEIGHT_TITLE)
          page.drawText(wl, {
            x: MARGIN_LEFT,
            y,
            size: FONT_SIZE_TITLE,
            font: helveticaBold,
            color: TEXT_COLOR,
          })
          y -= LINE_HEIGHT_TITLE
        }
        y -= SPACE_AFTER_TITLE
        break
      }

      case "h2": {
        const wrapped = wrapText(stripBold(line.text), helveticaBold, FONT_SIZE_H2, CONTENT_WIDTH)
        ensureSpace(SPACE_BEFORE_H2 + wrapped.length * LINE_HEIGHT_H2)
        y -= SPACE_BEFORE_H2
        for (const wl of wrapped) {
          ensureSpace(LINE_HEIGHT_H2)
          page.drawText(wl, {
            x: MARGIN_LEFT,
            y,
            size: FONT_SIZE_H2,
            font: helveticaBold,
            color: TEXT_COLOR,
          })
          y -= LINE_HEIGHT_H2
        }
        page.drawRectangle({
          x: MARGIN_LEFT,
          y: y + 2,
          width: CONTENT_WIDTH,
          height: 0.5,
          color: RULE_COLOR,
        })
        y -= SPACE_AFTER_H2
        break
      }

      case "h3": {
        const wrapped = wrapText(stripBold(line.text), helveticaBold, FONT_SIZE_H3, CONTENT_WIDTH)
        ensureSpace(SPACE_BEFORE_H3 + wrapped.length * LINE_HEIGHT_H3)
        y -= SPACE_BEFORE_H3
        for (const wl of wrapped) {
          ensureSpace(LINE_HEIGHT_H3)
          page.drawText(wl, {
            x: MARGIN_LEFT,
            y,
            size: FONT_SIZE_H3,
            font: helveticaBold,
            color: TEXT_COLOR,
          })
          y -= LINE_HEIGHT_H3
        }
        y -= SPACE_AFTER_H3
        break
      }

      case "bullet":
      case "numbered": {
        const indent = 16
        const bulletChar = line.type === "bullet" ? "\u2022" : `${extractNumber(line.text)}.`
        const textContent = line.type === "bullet"
          ? line.text
          : line.text.replace(/^\d+\.\s*/, "")

        const wrapped = wrapText(
          stripBold(textContent),
          helvetica,
          FONT_SIZE_BODY,
          CONTENT_WIDTH - indent - 8
        )
        ensureSpace(wrapped.length * LINE_HEIGHT_BODY)

        page.drawText(bulletChar, {
          x: MARGIN_LEFT + indent - 10,
          y,
          size: FONT_SIZE_BODY,
          font: helvetica,
          color: TEXT_COLOR,
        })

        for (let i = 0; i < wrapped.length; i++) {
          ensureSpace(LINE_HEIGHT_BODY)
          page.drawText(wrapped[i], {
            x: MARGIN_LEFT + indent + 2,
            y,
            size: FONT_SIZE_BODY,
            font: helvetica,
            color: TEXT_COLOR,
          })
          y -= LINE_HEIGHT_BODY
        }
        y -= SPACE_AFTER_BULLET
        break
      }

      case "paragraph": {
        const wrapped = wrapText(stripBold(line.text), helvetica, FONT_SIZE_BODY, CONTENT_WIDTH)
        ensureSpace(wrapped.length * LINE_HEIGHT_BODY)
        for (const wl of wrapped) {
          ensureSpace(LINE_HEIGHT_BODY)
          page.drawText(wl, {
            x: MARGIN_LEFT,
            y,
            size: FONT_SIZE_BODY,
            font: helvetica,
            color: TEXT_COLOR,
          })
          y -= LINE_HEIGHT_BODY
        }
        y -= SPACE_AFTER_PARA
        break
      }
    }
  }

  // --- Save and trigger download ---
  const pdfBytes = await pdfDoc.save()
  const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `master-signal-${new Date(generatedAt).toISOString().split("T")[0]}.pdf`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// Markdown parser
// ---------------------------------------------------------------------------

function parseMarkdown(content: string): ParsedLine[] {
  const rawLines = content.split("\n")
  const parsed: ParsedLine[] = []

  for (const raw of rawLines) {
    const trimmed = raw.trim()

    if (trimmed === "") {
      parsed.push({ type: "blank", text: "" })
    } else if (trimmed === "---" || trimmed === "***" || trimmed === "___") {
      parsed.push({ type: "rule", text: "" })
    } else if (trimmed.startsWith("### ")) {
      parsed.push({ type: "h3", text: trimmed.slice(4) })
    } else if (trimmed.startsWith("## ")) {
      parsed.push({ type: "h2", text: trimmed.slice(3) })
    } else if (trimmed.startsWith("# ")) {
      parsed.push({ type: "h1", text: trimmed.slice(2) })
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      parsed.push({ type: "bullet", text: trimmed.slice(2) })
    } else if (/^\d+\.\s/.test(trimmed)) {
      parsed.push({ type: "numbered", text: trimmed })
    } else {
      parsed.push({ type: "paragraph", text: trimmed })
    }
  }

  return parsed
}

function stripBold(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "$1")
}

function extractNumber(text: string): string {
  const match = text.match(/^(\d+)\./)
  return match ? match[1] : "\u2022"
}
