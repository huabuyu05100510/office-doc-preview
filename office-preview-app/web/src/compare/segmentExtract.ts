// 段提取：从已渲染的预览 DOM 中识别段落并挂 data-seg-id
// 模型：claude-sonnet-4-6
//
// 两种形态：
//   - DOCX：mammoth 输出 .docx-article 下的 <p> 直接作为段
//   - PDF 图片+文字层：.pdf-text-layer 下的 span 按 top（y 坐标）聚合
//   - PDF.js / WASM：textLayer span 同上（兜底）
import type { Segment } from './api'

const ROW_TOLERANCE_PX = 6  // top 差 ≤6px 视为同段（同一行/段落）

interface ExtractResult {
  segments: Segment[]
  /** 已注入 data-seg-id 的元素列表，便于清理 */
  elements: HTMLElement[]
}

/** 提取段并为元素注入 data-seg-id */
export function extractAndTagSegments(root: HTMLElement, prefix: string): ExtractResult {
  // DOCX 优先
  const paragraphs = root.querySelectorAll('.docx-article p, .docx-article li, .docx-article h1, .docx-article h2, .docx-article h3')
  if (paragraphs.length > 0) {
    return tagElements(paragraphs, prefix)
  }
  // PDF 图片+文字层 / PDF.js textLayer
  const spans = root.querySelectorAll('.pdf-text-layer span, .textLayer span')
  if (spans.length > 0) {
    return tagGroupedSpans(spans, prefix)
  }
  // TXT/MD 预览：按 <pre> 内行聚合（TextPreview 输出 <pre>）
  const pre = root.querySelector('pre')
  if (pre) {
    return tagPreLines(pre, prefix)
  }
  return { segments: [], elements: [] }
}

function tagElements(list: NodeListOf<Element>, prefix: string): ExtractResult {
  const segments: Segment[] = []
  const elements: HTMLElement[] = []
  let i = 0
  for (const el of Array.from(list)) {
    const text = (el as HTMLElement).textContent || ''
    if (!text.trim()) continue
    const segId = `${prefix}-${i}`
    ;(el as HTMLElement).dataset.segId = segId
    elements.push(el as HTMLElement)
    segments.push({ id: segId, text })
    i++
  }
  return { segments, elements }
}

function tagGroupedSpans(spans: NodeListOf<Element>, prefix: string): ExtractResult {
  const segments: Segment[] = []
  const elements: HTMLElement[] = []
  let groupIdx = 0
  let groupTop: number | null = null
  let groupEls: HTMLElement[] = []
  let groupText = ''

  const flush = () => {
    if (groupEls.length === 0) return
    const segId = `${prefix}-${groupIdx}`
    for (const el of groupEls) el.dataset.segId = segId
    elements.push(...groupEls)
    segments.push({ id: segId, text: groupText.trim() })
    groupIdx++
    groupTop = null
    groupEls = []
    groupText = ''
  }

  for (const span of Array.from(spans)) {
    const el = span as HTMLElement
    const top = parseFloat(el.style.top) || (el.getBoundingClientRect().top)
    const text = el.textContent || ''
    if (!text) continue
    if (groupTop === null || Math.abs(top - groupTop) <= ROW_TOLERANCE_PX) {
      groupTop = groupTop ?? top
      groupEls.push(el)
      groupText += text
    } else {
      flush()
      groupTop = top
      groupEls.push(el)
      groupText = text
    }
  }
  flush()
  return { segments, elements }
}

function tagPreLines(pre: HTMLElement, prefix: string): ExtractResult {
  const segments: Segment[] = []
  const elements: HTMLElement[] = []
  const lines = (pre.textContent || '').split(/\n\s*\n/)
  let i = 0
  for (const line of lines) {
    if (!line.trim()) continue
    const segId = `${prefix}-${i}`
    // 不拆 pre DOM（会破坏排版），仅记录 segId 列表供对齐用
    segments.push({ id: segId, text: line.trim() })
    i++
  }
  // 给 pre 整体挂第一个 segId（粗粒度，至少能定位）
  if (segments.length) {
    pre.dataset.segId = segments[0].id
    elements.push(pre)
  }
  return { segments, elements }
}

/** 清理注入的 data-seg-id（切换对比目标时用） */
export function clearSegIds(root: HTMLElement) {
  root.querySelectorAll('[data-seg-id]').forEach(el => {
    delete (el as HTMLElement).dataset.segId
  })
}
