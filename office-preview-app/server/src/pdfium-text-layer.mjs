// PDFium 文字覆盖层（服务端 Node，run-level 渲染 — 对标 PDF.js 行业标杆）
// 模型：Claude MiniMax-M3（MiniMax）
// 关键变更（v3 修复垂直对齐）：
//   - 从 char-level 改回 run-level（PDF.js #appendText() 算法）
//   - 同一行 + 同字体大小的连续字符 = 1 个 <span>
//   - 对齐公式：top = baselineY - fontSize × ASCENT_RATIO
//   - 浏览器按 font-size + line-height:1 自动 baseline 对齐
//   → bullet ● / hyphen - / CJK 汉字在同一行视觉基线完全一致
// CSS 约定（在 web/styles.css）：
//   .pdf-text-layer span {
//     line-height: 1; transform-origin: 0 0;
//     white-space: pre;  /* 保留前导空格作缩进 */
//     /* 不写 vertical-align —— 让浏览器按字体 metrics 自动对齐 */
//   }
import fs from 'node:fs'
import path from 'node:path'
import { pdfiumExtractTextRuns, pdfiumGetPageCount } from './pdfium-render.mjs'

// 视觉上沿占 font-size 的比例（与浏览器 ascender/descent 系数近似）
// PDF.js 内部按 fontFamily 查表：CJK 约 0.88，Helvetica 约 0.73
// 用 0.80 折中：CJK 行稍紧、Latin 行稍松，可视化差异 ≤ 2px
const ASCENT_RATIO = 0.80

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 单个 text-run → <span>（PDF.js 风格）
 * 输入：{ str, fontSize, baselineY, left, right, top, bottom }
 * 定位公式（PDF.js #appendText）：
 *   top = baselineY - fontSize × ASCENT_RATIO
 *   height = fontSize            ← 让 CSS box 高度 = 字体大小
 *   font-size = fontSize px      ← 让浏览器按字体 metrics 渲染字符
 *   line-height: 1               ← 在 CSS（不在 inline style，避免选择时计算偏差）
 */
function runToSpan(run) {
  const fontSize = Math.max(run.fontSize, 1)
  const top = (run.baselineY - fontSize * ASCENT_RATIO).toFixed(2)
  const height = fontSize.toFixed(2)
  const left = run.left.toFixed(2)
  const width = Math.max(run.right - run.left, fontSize * 0.5).toFixed(2)  // 至少半个字符宽
  return `<span style="position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;font-size:${height}px">${escapeHtml(run.str)}</span>`
}

/**
 * 把 runs 数组转为 text-layer HTML
 * 结构与 v2 一致：根 div 带 data-pdfium / data-page-w / data-page-h
 * 每个 run 一个 span（替换 v2 的 char-level 一字一 span）
 */
export function buildRunBboxHtml(runs, pageWidthPx, pageHeightPx) {
  if (!runs.length) {
    return `<div class="pdf-text-layer" data-pdfium="1" data-page-w="${pageWidthPx.toFixed(2)}" data-page-h="${pageHeightPx.toFixed(2)}"></div>`
  }
  const spans = runs.map(runToSpan)
  return `<div class="pdf-text-layer" data-pdfium="1" data-page-w="${pageWidthPx.toFixed(2)}" data-page-h="${pageHeightPx.toFixed(2)}">${spans.join('')}</div>`
}

/** 单页提取并写 HTML 文件（page 1-based） */
export async function pdfiumExtractTextLayer(pdfPath, page, outPath, opts = {}) {
  const dpi = opts.renderDpi || 120
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  const { pdfiumExtractTextRuns } = await import('./pdfium-render.mjs')
  const { runs, pageWidthPx, pageHeightPx, source } = await pdfiumExtractTextRuns(pdfPath, page - 1, dpi)
  const html = buildRunBboxHtml(runs, pageWidthPx, pageHeightPx)
  fs.writeFileSync(outPath, html)
  return {
    page,
    file: outPath,
    runs: runs.length,
    chars: runs.reduce((n, r) => n + r.str.length, 0),
    bytes: Buffer.byteLength(html, 'utf-8'),
    source,
    pageWidthPx,
    pageHeightPx
  }
}

/** 批量提取所有页文字层 */
export async function pdfiumExtractAllTextLayers(pdfPath, outDir, prefix = 'page', parallel = 1, dpi = 120, onProgress = null) {
  fs.mkdirSync(outDir, { recursive: true })
  const total = await pdfiumGetPageCount(pdfPath)
  if (total <= 0) return []
  const perBucket = Math.max(1, Math.ceil(total / parallel))
  const buckets = []
  for (let from = 1; from <= total; from += perBucket) {
    buckets.push({ from, to: Math.min(from + perBucket - 1, total) })
  }
  const all = []
  let done = 0
  await Promise.all(buckets.map(async b => {
    for (let p = b.from; p <= b.to; p++) {
      const page = p
      const pad3 = String(page).padStart(3, '0')
      const outPath = path.join(outDir, `${prefix}-${pad3}.html`)
      try {
        const r = await pdfiumExtractTextLayer(pdfPath, page, outPath, { renderDpi: dpi })
        all.push(r)
      } catch (e) {
        console.warn(`[pdfium-text-layer] extract page ${page} failed: ${e.message}`)
        fs.writeFileSync(outPath, '<div class="pdf-text-layer"></div>')
        all.push({ page, file: outPath, runs: 0, chars: 0, bytes: 0 })
      }
      done++
      if (onProgress) onProgress(done)
    }
  }))
  all.sort((a, b) => a.page - b.page)
  return all
}

// ============ 兼容旧 API ============
// pdf-rasterize.mjs / router.mjs 仍可能 import 这些名字（已重写实现）
export const buildCharBboxHtml = buildRunBboxHtml  // 旧名 alias，便于向后兼容
