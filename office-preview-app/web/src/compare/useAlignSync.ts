// useAlignSync：拉对齐表 + 双向高亮 + 滚动联动
// 模型：claude-sonnet-4-6
//
// 设计：
//   - 段定位：DOM 上挂 data-seg-id 属性
//   - hover/click 一段 → 查 align.pairs → 在对端 DOM 找 [data-seg-id] → 高亮 + 滚动入视
//   - 滚动联动：主端 scroll → 找视口顶部首个可见段 → 对端 scrollIntoView
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alignment, postAlign } from './api'
import type { Segment } from './api'
import { usePerf } from '../perf'

interface Options {
  srcTaskId: string
  tgtTaskId: string
  // 在两栏 DOM 渲染完后调用，传入 srcRoot/tgtRoot 让 hook 能查 DOM
}

export function useAlignSync({ srcTaskId, tgtTaskId }: Options) {
  const [alignment, setAlignment] = useState<Alignment | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeSegId, setActiveSegId] = useState<string | null>(null)

  const srcRootRef = useRef<HTMLElement | null>(null)
  const tgtRootRef = useRef<HTMLElement | null>(null)
  // 防回环：自己触发的滚动不再回推
  const programmaticScrollRef = useRef(false)

  // src→tgt / tgt→src 索引
  const src2tgt = useRef<Map<string, string>>(new Map())
  const tgt2src = useRef<Map<string, string>>(new Map())

  // 拉对齐
  const fetchAlign = useCallback(async (srcSegs: Segment[], tgtSegs: Segment[]) => {
    setLoading(true); setError(null)
    const t0 = performance.now()
    try {
      const a = await postAlign(srcTaskId, tgtTaskId, srcSegs, tgtSegs)
      setAlignment(a)
      src2tgt.current = new Map(a.pairs.map(p => [p.src, p.tgt]))
      tgt2src.current = new Map(a.pairs.map(p => [p.tgt, p.src]))
      usePerf.getState().set({
        alignPairs: a.stats.matched,
        alignScoreAvg: a.stats.scoreAvg,
        alignGranularity: a.granularity,
        alignAlgorithm: a.stats.algorithm,
        alignLatencyMs: Math.round(performance.now() - t0)
      })
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }, [srcTaskId, tgtTaskId])

  const highlight = useCallback((segId: string | null) => {
    setActiveSegId(segId)
    if (segId) {
      // 同步高亮对端
      const tgt = src2tgt.current.get(segId)
      const src = tgt2src.current.get(segId)
      const partnerId = tgt || src
      if (partnerId) {
        const root = tgt ? srcRootRef.current : tgtRootRef.current
        // partner 应在哪个 root：segId 在 src → partner 在 tgt；segId 在 tgt → partner 在 src
        const searchRoot = tgt ? tgtRootRef.current : srcRootRef.current
        const el = searchRoot?.querySelector(`[data-seg-id="${cssEscape(partnerId)}"]`)
        if (el) {
          programmaticScrollRef.current = true
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
          setTimeout(() => { programmaticScrollRef.current = false }, 400)
        }
      }
    }
  }, [])

  // 找视口顶部首个可见段
  const topVisibleSeg = useCallback((root: HTMLElement): string | null => {
    if (!root) return null
    const rect = root.getBoundingClientRect()
    const segs = root.querySelectorAll('[data-seg-id]')
    for (const el of Array.from(segs)) {
      const r = (el as HTMLElement).getBoundingClientRect()
      // 视口顶部 + 100px 容差
      if (r.bottom > rect.top + 20 && r.top < rect.top + 120) {
        return (el as HTMLElement).dataset.segId || null
      }
    }
    return null
  }, [])

  // 双向滚动联动：src scroll → 滚 tgt
  useEffect(() => {
    const src = srcRootRef.current
    const tgt = tgtRootRef.current
    if (!src || !tgt) return

    let raf = 0
    const onSrcScroll = () => {
      if (programmaticScrollRef.current) return
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const segId = topVisibleSeg(src)
        if (!segId) return
        const partnerId = src2tgt.current.get(segId)
        if (!partnerId) return
        const el = tgt.querySelector(`[data-seg-id="${cssEscape(partnerId)}"]`)
        if (el) {
          programmaticScrollRef.current = true
          el.scrollIntoView({ behavior: 'auto', block: 'start' })
          requestAnimationFrame(() => { programmaticScrollRef.current = false })
        }
      })
    }
    const onTgtScroll = () => {
      if (programmaticScrollRef.current) return
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const segId = topVisibleSeg(tgt)
        if (!segId) return
        const partnerId = tgt2src.current.get(segId)
        if (!partnerId) return
        const el = src.querySelector(`[data-seg-id="${cssEscape(partnerId)}"]`)
        if (el) {
          programmaticScrollRef.current = true
          el.scrollIntoView({ behavior: 'auto', block: 'start' })
          requestAnimationFrame(() => { programmaticScrollRef.current = false })
        }
      })
    }
    src.addEventListener('scroll', onSrcScroll, { passive: true })
    tgt.addEventListener('scroll', onTgtScroll, { passive: true })
    return () => {
      src.removeEventListener('scroll', onSrcScroll)
      tgt.removeEventListener('scroll', onTgtScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [alignment, topVisibleSeg])

  return {
    alignment, loading, error, activeSegId,
    setSrcRoot: (el: HTMLElement | null) => { srcRootRef.current = el },
    setTgtRoot: (el: HTMLElement | null) => { tgtRootRef.current = el },
    fetchAlign, highlight
  }
}

function cssEscape(s: string): string {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s)
  return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&')
}
