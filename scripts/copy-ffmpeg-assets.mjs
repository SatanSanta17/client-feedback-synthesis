// Copies the @ffmpeg/core UMD assets into public/ffmpeg/ so the WASM core
// is served from our origin instead of a third-party CDN at runtime.
// Wired as `postinstall` in package.json. Idempotent.

import { existsSync, mkdirSync, statSync, copyFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, "..")
const SRC_DIR = join(ROOT, "node_modules", "@ffmpeg", "core", "dist", "umd")
const OUT_DIR = join(ROOT, "public", "ffmpeg")

const ASSETS = ["ffmpeg-core.js", "ffmpeg-core.wasm"]

function copyIfChanged(src, dst) {
  if (!existsSync(src)) {
    console.warn(`[copy-ffmpeg-assets] missing source: ${src} — skipping`)
    return false
  }
  if (existsSync(dst)) {
    const srcStat = statSync(src)
    const dstStat = statSync(dst)
    if (srcStat.size === dstStat.size && srcStat.mtimeMs <= dstStat.mtimeMs) {
      return false
    }
  }
  copyFileSync(src, dst)
  return true
}

if (!existsSync(SRC_DIR)) {
  console.warn(
    `[copy-ffmpeg-assets] @ffmpeg/core not installed at ${SRC_DIR} — skipping`,
  )
  process.exit(0)
}

mkdirSync(OUT_DIR, { recursive: true })

let copied = 0
for (const name of ASSETS) {
  const src = join(SRC_DIR, name)
  const dst = join(OUT_DIR, name)
  if (copyIfChanged(src, dst)) {
    console.log(`[copy-ffmpeg-assets] copied ${name}`)
    copied++
  }
}

if (copied === 0) {
  console.log("[copy-ffmpeg-assets] up to date")
}
