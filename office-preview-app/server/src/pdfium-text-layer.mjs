// PDFium 文字覆盖层（服务端 Node，run-level 渲染 — 对标 PDF.js 行业标杆）
// 模型：claude-sonnet-4-6
// 关键变更（v4 像素级对齐）：
//   - 直接使用 PDFium ink bbox 的 top/bottom 坐标定位 span
//   - 不再使用 baselineY - ASCENT_RATIO * fontSize 近似公式
//   - 同一引擎渲染 PNG 和提取 bbox → span 坐标 100% 对齐 ink 像素
//   - 版本号 data-pdfium="3"，触发旧格式自动重生
// CSS 约定（在 web/styles.css）：
//   .pdf-text-layer span {
//     line-height: 1; transform-origin: 0 0;
//     white-space: pre; overflow: hidden;
//     transform: scaleX(N); /* 客户端 JS 补偿浏览器字体宽度差异 */
//   }
import fs from 'node:fs'
import path from 'node:path'
import { pdfiumExtractTextRuns, pdfiumGetPageCount } from './pdfium-render.mjs'

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 单个 text-run → <span>（ink bbox 直接定位，像素级对齐）
 * 输入：{ str, fontSize, left, right, top, bottom }
 *
 * 定位原则（v4 — 去除 ASCENT_RATIO 近似）：
 *   top    = run.top            ← PDFium ink bbox 顶边，与 PNG ink 像素 100% 对齐
 *   height = max(inkH, fontSize × 0.5)  ← ink 高度兜底，保证选区覆盖
 *   width  = max(inkW, fontSize × 0.5)  ← ink 宽度兜底
 *   font-size = fontSize        ← 用于客户端 scaleX 计算的参考值
 *
 * 客户端（PdfImagesPreview.tsx）会在注入后测量浏览器字体宽度并应用
 *   transform: scaleX(pdfWidth / browserWidth)
 * 使透明字符与 PNG ink 水平对齐，消除字体替换漂移。
 */
function runToSpan(run) {
  const fontSize = Math.max(run.fontSize, 1)
  const inkW = run.right - run.left
  const inkH = run.bottom - run.top
  // v3: 最小高度从 fontSize×0.5 提升到 fontSize×0.85（确保细横笔如"一"也可点选）
  // 最小宽度保留 fontSize×0.5（宽度偏差不影响命中，但高度决定可点击性）
  const top = run.top.toFixed(2)
  const height = Math.max(inkH, fontSize * 0.85).toFixed(2)
  const left = run.left.toFixed(2)
  const width = Math.max(inkW, fontSize * 0.5).toFixed(2)
  return `<span style="position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;font-size:${fontSize.toFixed(2)}px">${escapeHtml(run.str)}</span>`
}

/**
 * 把 runs 数组转为 text-layer HTML
 * 结构与 v2 一致：根 div 带 data-pdfium / data-page-w / data-page-h
 * 每个 run 一个 span（替换 v2 的 char-level 一字一 span）
 */
export function buildRunBboxHtml(runs, pageWidthPx, pageHeightPx) {
  if (!runs.length) {
    return `<div class="pdf-text-layer" data-pdfium="4" data-page-w="${pageWidthPx.toFixed(2)}" data-page-h="${pageHeightPx.toFixed(2)}"></div>`
  }
  const spans = runs.map(runToSpan)
  return `<div class="pdf-text-layer" data-pdfium="4" data-page-w="${pageWidthPx.toFixed(2)}" data-page-h="${pageHeightPx.toFixed(2)}">${spans.join('')}</div>`
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
