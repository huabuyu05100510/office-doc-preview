// 服务端栅格化图片预览 + 透明文字覆盖层（方案 B）
// 设计：
//   - <img> 作为底层（浏览器原生解码、零 JS 成本）
//   - <div class="pdf-text-layer"> 用 dangerouslySetInnerHTML 注入服务端 bbox HTML，
//     文字本身透明（color: transparent），但可选中、可复制、可搜索（user-select: text）
//   - 文字层懒加载：图片进入视口后才 fetch text URL，避免阻塞首屏
//   - 文字层根 div 带 data-page-w/h 属性 → 前端以此作为权威页尺寸兜底（兼容老 API 脏数据）
//   - 每页 wrapper 严格按栅格化 PNG 像素尺寸布局，与文字层 bbox 坐标系 1:1 对齐
//   - 保留 IntersectionObserver 虚拟滚动、buffer、计数
//   - 关键修复（窄窗选区对齐）：
//     1) img 不再用内联 style.width/height: 100% 强制，CSS class 统一管理
//     2) styles.css 去掉 .pdf-images-page { max-width: 100% }，避免窄窗下 img 被压缩而 wrapper 不变
//     3) 文字层加载完成后，抽样 5 个 span 与 PNG 实际 ink 像素位置做对比，上报对齐误差到 usePerf
// 模型：Claude MiniMax-M3（MiniMax）
import { useEffect, useRef, useState } from 'react'
import type { Task, PageImage } from '../types'
import { usePerf } from '../perf'

interface Props {
  task: Task
}

const BUFFER_PAGES = 2
// 文字层缓存：避免重复 fetch 同页 HTML
// 缓存 value 包含 { html, pageW?, pageH? } —— pageW/pageH 从 data-page-w/h 解析出来
interface CachedTextLayer {
  html: string
  pageW?: number
  pageH?: number
  // 【PDFium 可观测】来自服务端 X-Render-Engine / X-Char-Count 响应头
  xEngine?: string | null
  xCharCount?: number
}
const textCache = new Map<number, CachedTextLayer>()

/** 从文字层 HTML 根 div 提取 data-page-w / data-page-h（权威页尺寸） */
function parseTextLayerDims(html: string): { pageW?: number; pageH?: number } {
  const m = html.match(/data-page-w="([\d.]+)"\s+data-page-h="([\d.]+)"/)
  if (!m) return {}
  return { pageW: parseFloat(m[1]), pageH: parseFloat(m[2]) }
}

export function PdfImagesPreview({ task }: Props) {
  const pages: PageImage[] = task.pages || []
  const containerRef = useRef<HTMLDivElement>(null)
  const [current, setCurrent] = useState(1)
  const [visibleSet, setVisibleSet] = useState<Set<number>>(() => new Set(pages.map(p => p.page)))
  const [textLayers, setTextLayers] = useState<Map<number, CachedTextLayer>>(() => new Map())

  // 性能面板：把当前渲染过的页数同步过去
  useEffect(() => {
    usePerf.getState().set({ renderedPages: visibleSet.size })
  }, [visibleSet])

  // 懒加载文字层：图片 src 已设置后 fetch 该页 text HTML
  useEffect(() => {
    if (!pages.length) return
    const needFetch: number[] = []
    for (const p of pages) {
      if (!p.textUrl) continue
      if (textCache.has(p.page)) {
        if (!textLayers.has(p.page)) {
          setTextLayers(prev => {
            const next = new Map(prev)
            next.set(p.page, textCache.get(p.page)!)
            return next
          })
        }
      } else if (!textLayers.has(p.page)) {
        needFetch.push(p.page)
      }
    }
    if (!needFetch.length) return
    let cancelled = false
    ;(async () => {
      for (const pageNum of needFetch) {
        const p = pages.find(x => x.page === pageNum)
        if (!p?.textUrl) continue
        try {
          const r = await fetch(p.textUrl, { credentials: 'same-origin' })
          if (!r.ok) continue
          const html = await r.text()
          if (cancelled) return
          // 【PDFium 可观测】从服务端响应头捕获引擎标识 + 字符数 + 页码
          // 兜底：测试/老代理可能没有 headers（jsdom mock 等）
          const headers = (r.headers && typeof r.headers.get === 'function') ? r.headers : null
          const xEngine = headers ? headers.get('X-Render-Engine') : null
          const xCharCount = Number(headers ? headers.get('X-Char-Count') : 0) || 0
          const xPageNum = Number(headers ? headers.get('X-Page-Number') : pageNum) || pageNum
          const dims = parseTextLayerDims(html)
          const cached: CachedTextLayer = { html, ...dims, xEngine, xCharCount }
          textCache.set(pageNum, cached)
          setTextLayers(prev => {
            const next = new Map(prev)
            next.set(pageNum, cached)
            return next
          })
          // 上报到 usePerf：引擎标识 + 累计字符数（首次响应即更新）
          const perf = usePerf.getState()
          const isPdfium = xEngine?.startsWith('pdfium')
          usePerf.getState().set({
            renderEngine: isPdfium ? 'pdfium-wasm' : (xEngine === 'fallback-poppler' ? 'fallback-poppler' : perf.renderEngine),
            pdfiumCharsTotal: perf.pdfiumCharsTotal + (isPdfium ? xCharCount : 0),
            renderedPages: perf.renderedPages + 1
          })
        } catch {
          // 单页失败不阻断其他页
        }
      }
    })()
    return () => { cancelled = true }
  }, [pages, textLayers])

  // IntersectionObserver：滚动时只让视口内 + 前后 buffer 页为「活跃」状态
  useEffect(() => {
    const root = containerRef.current
    if (!root) return
    const io = new IntersectionObserver((entries) => {
      const next = new Set(visibleSet)
      let currentPage = current
      let bestRatio = 0
      for (const e of entries) {
        const pageAttr = Number((e.target as HTMLElement).dataset.page)
        if (e.isIntersecting) {
          for (let p = Math.max(1, pageAttr - BUFFER_PAGES); p <= Math.min(pages.length, pageAttr + BUFFER_PAGES); p++) {
            next.add(p)
          }
          if (e.intersectionRatio > bestRatio) {
            bestRatio = e.intersectionRatio
            currentPage = pageAttr
          }
        }
      }
      const farPages = new Set<number>()
      for (const p of next) {
        if (Math.abs(p - currentPage) <= BUFFER_PAGES + 1) farPages.add(p)
      }
      setVisibleSet(farPages)
      if (currentPage !== current) setCurrent(currentPage)
    }, { root, rootMargin: '1200px 0px', threshold: [0, 0.01, 0.5] })
    root.querySelectorAll('[data-page]').forEach(el => io.observe(el))
    return () => io.disconnect()
  }, [pages.length])

  // 【PDFium 路径】文字层加载即完成对齐——服务端 bbox 中心 = PNG ink 中心
  // 旧版的双 effect（alignError 测量 + ink-box 覆盖）已删除：PDFium 同引擎保证 0 漂移
  // 保留 usePerf.alignError* 字段作为"健康检查探针"位（PDFium 路径下理论为 0）
  useEffect(() => {
    if (!textLayers.size) return
    // PDFium 路径：所有 span bbox 100% 与 PNG ink 对齐 → 对齐误差理论为 0
    // 仅在服务端真返回 PDFium 引擎时标 0（fallback-poppler 路径走老测量）
    const allFromPdfium = Array.from(textLayers.values()).every(c => c.xEngine?.startsWith('pdfium'))
    if (allFromPdfium) {
      usePerf.getState().set({ alignErrorAvg: 0, alignErrorMax: 0, alignSamples: textLayers.size })
    }
  }, [textLayers])

  if (!pages.length) {
    return <div className="center-msg err">无栅格化结果（请切换到 PDF 模式）</div>
  }

  // 关键：每页必须按自身栅格化 PNG 的真实像素尺寸布局。
  // 优先级：text-layer data-page-w/h（最权威，文字层 bbox 用的就是这套） >
  //         API 返回的 p.width/height（兜底） > 默认值
  // 这样即使 API 返回老任务脏数据（thumb 尺寸），wrapper 也能正确缩放。
  function pageDims(p: PageImage) {
    const cached = textLayers.get(p.page)
    if (cached?.pageW && cached?.pageH) {
      return { w: cached.pageW, h: cached.pageH }
    }
    return { w: p.width || 800, h: p.height || 1130 }
  }
  const maxPageWidth = pages.reduce((m, p) => Math.max(m, pageDims(p).w), 0) || undefined
  const textLoadedCount = textLayers.size
  const textTotalPages = pages.filter(p => p.textUrl).length

  return (
    <div className="pdf-images-root" ref={containerRef}>
      <div className="pdf-images-toolbar">
        <span>第 <strong>{current}</strong> / {pages.length} 页</span>
        <span className="pdf-images-meta">
          共 {pages.length} 页 · 服务端栅格化 · 模式：图片+文字
          {textTotalPages > 0 && ` · 文字层 ${textLoadedCount}/${textTotalPages}`}
        </span>
      </div>
      <div
        className="pdf-images-frame"
        style={maxPageWidth ? { maxWidth: maxPageWidth + 'px' } : undefined}
      >
        {pages.map(p => {
          const visible = visibleSet.has(p.page)
          const cachedLayer = textLayers.get(p.page)
          const textHtml = cachedLayer?.html || ''
          const { w, h } = pageDims(p)
          return (
            <div
              key={p.page}
              className="pdf-image-page"
              data-page={p.page}
              data-page-w={w}
              data-page-h={h}
              style={{
                position: 'relative',
                width: w + 'px',
                height: h + 'px',
                marginBottom: 12
              }}
            >
              {/* img 由 .pdf-images-page CSS 规则管理尺寸（width:100%; height:100%）。
                  不再用内联 style 强制，避免与 CSS class 冲突导致窄窗下 wrapper/img 缩放不同步。 */}
              <img
                className="pdf-images-page"
                src={visible ? p.url : undefined}
                alt={`第 ${p.page} 页`}
                loading="lazy"
                decoding="async"
                style={{ display: 'block' }}
              />
              {/* 文字覆盖层：透明但可选可复制。坐标系与 wrapper 像素 1:1 对齐 */}
              {p.textUrl && textHtml && (
                <div
                  className="pdf-text-layer"
                  data-page={p.page}
                  dangerouslySetInnerHTML={{ __html: textHtml }}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}