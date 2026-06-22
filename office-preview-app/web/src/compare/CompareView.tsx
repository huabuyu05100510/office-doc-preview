// CompareView：翻译前后双栏对比预览 + 标注 + 协作 + QA
// 模型：claude-sonnet-4-6
//
// 体验：
//   - 左源右译，每栏复用现有 PreviewRouter
//   - 标签段后 hover/click → 对端高亮 + 平滑滚动入视
//   - 滚动联动：rAF 节流，programmatic flag 防回环
//   - 顶栏：对齐命中数 / 置信度 / 算法版本（可观测）
//   - 工具栏开关：批注 / 协作 / 质检
//   - PDF 强制走「图片+文字」模式（沿用上一分支的 PDFium 像素级对齐 v4）
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Task } from '../types'
import { fileIcon, humanSize } from '../types'
import { PreviewRouter } from '../previewers'
import { useAlignSync } from './useAlignSync'
import { extractAndTagSegments, clearSegIds } from './segmentExtract'
import type { Segment } from './api'
import { useAnnotations } from '../annotations/useAnnotations'
import { AnnotationLayer } from '../annotations/AnnotationLayer'
import { AnnotationList } from '../annotations/AnnotationList'
import { useCollab } from '../collab/useCollab'
import { PresenceBar } from '../collab/PresenceBar'
import { CursorsLayer } from '../collab/CursorsLayer'
import { fetchQA, fetchQAFix } from './qaApi'
import type { QAIssue } from './qaApi'

interface Props {
  src: Task
  tgt: Task
  onClose: () => void
}

function Fallback() {
  return <div className="center-msg"><div className="spin" /><div className="hint" style={{ marginTop: 10 }}>加载预览器…</div></div>
}

export function CompareView({ src, tgt, onClose }: Props) {
  // useAlignSync 内部已用 useRef，回的对象每次都新；用 useMemo 锁定 deps
  const align = useAlignSync({ srcTaskId: src.id, tgtTaskId: tgt.id })
  const srcWrapRef = useRef<HTMLDivElement>(null)
  const tgtWrapRef = useRef<HTMLDivElement>(null)
  const [srcSegs, setSrcSegs] = useState<Segment[]>([])
  const [tgtSegs, setTgtSegs] = useState<Segment[]>([])
  const [srcReady, setSrcReady] = useState(false)
  const [tgtReady, setTgtReady] = useState(false)

  // 工具栏开关
  const [annoOn, setAnnoOn] = useState(false)
  const [collabOn, setCollabOn] = useState(false)
  const [qaOn, setQaOn] = useState(false)
  const [qaIssues, setQaIssues] = useState<QAIssue[]>([])
  const [qaLoading, setQaLoading] = useState(false)

  // 标注 + 协作（房间 = src.id，源 + 译共享一个房间，多人同步）
  const anno = useAnnotations(src.id)
  const collabInit = useCollab(s => s.init)
  const collabClose = useCollab(s => s.close)
  const collabIdentity = useCollab(s => s.identity)
  const collabSendHighlight = useCollab(s => s.sendHighlight)
  const collabSendAnnotate = useCollab(s => s.sendAnnotate)

  // 强制 PDF 走「图片+文字」模式（v4 像素级对齐，可选中、不可缩放变形）
  const srcMode = 'images' as const
  const tgtMode = 'images' as const

  useEffect(() => { align.setSrcRoot(srcWrapRef.current) }, [align])
  useEffect(() => { align.setTgtRoot(tgtWrapRef.current) }, [align])

  // 提取段
  useEffect(() => {
    const root = srcWrapRef.current
    if (!root || !srcReady) return
    const t = setTimeout(() => {
      clearSegIds(root)
      const { segments } = extractAndTagSegments(root, 'src')
      setSrcSegs(segments)
    }, 500)
    return () => clearTimeout(t)
  }, [srcReady, src.id])

  useEffect(() => {
    const root = tgtWrapRef.current
    if (!root || !tgtReady) return
    const t = setTimeout(() => {
      clearSegIds(root)
      const { segments } = extractAndTagSegments(root, 'tgt')
      setTgtSegs(segments)
    }, 500)
    return () => clearTimeout(t)
  }, [tgtReady, tgt.id])

  // 两栏段都提取完，拉对齐
  useEffect(() => {
    if (srcSegs.length && tgtSegs.length) {
      align.fetchAlign(srcSegs, tgtSegs)
    }
  }, [srcSegs, tgtSegs])

  // QA：对齐就绪后拉取
  useEffect(() => {
    if (!qaOn || !align.alignment) return
    setQaLoading(true)
    fetchQA(tgt.id, align.alignment.id, src.id)
      .then(r => setQaIssues(r.issues))
      .catch(e => console.warn('[qa] fetch failed', e))
      .finally(() => setQaLoading(false))
  }, [qaOn, align.alignment, src.id, tgt.id])

  // 高亮联动 DOM
  useEffect(() => {
    const apply = (root: HTMLElement | null, side: 'src' | 'tgt') => {
      if (!root) return
      root.querySelectorAll('[data-seg-id]').forEach(el => {
        const sid = (el as HTMLElement).dataset.segId || ''
        const isActive = align.activeSegId === sid
        const isPartner = side === 'src'
          ? align.alignment?.pairs.some(p => p.src === sid && p.tgt === align.activeSegId)
          : align.alignment?.pairs.some(p => p.tgt === sid && p.src === align.activeSegId)
        el.classList.toggle('seg-active', isActive)
        el.classList.toggle('seg-partner', !!isPartner)
      })
    }
    apply(srcWrapRef.current, 'src')
    apply(tgtWrapRef.current, 'tgt')
  }, [align.activeSegId, align.alignment])

  // 协作：注入回调（只跑一次；ref 模式不再触发 zustand state 变化）
  const annoApplyRef = useRef(anno.applyRemote)
  annoApplyRef.current = anno.applyRemote
  useEffect(() => {
    useCollab.getState().setHandlers({
      onRemoteAnnotation: (ann: any, op: string) => annoApplyRef.current(ann, op),
      onRemoteHighlight: (segId: string) => { /* 由 CursorsLayer 渲染 */ }
    })
  }, [])

  // 协作：开关切换 → 连接 / 断开
  useEffect(() => {
    if (collabOn) {
      useCollab.getState().init(src.id).catch(e => console.warn('[collab] init failed', e))
    } else {
      useCollab.getState().close()
    }
    return () => { useCollab.getState().close() }
  }, [collabOn, src.id])

  // hover 联动协作
  const onSegEvent = useCallback((side: 'src' | 'tgt') => (e: React.MouseEvent) => {
    const target = (e.target as HTMLElement).closest('[data-seg-id]') as HTMLElement | null
    if (!target) return
    const segId = target.dataset.segId || ''
    align.highlight(segId)
    if (collabOn) collabSendHighlight(segId)
  }, [align, collabOn, collabSendHighlight])

  // 双击段 → 弹批注输入框
  const onSegDblClick = useCallback((side: 'src' | 'tgt') => (e: React.MouseEvent) => {
    if (!annoOn) return
    const target = (e.target as HTMLElement).closest('[data-seg-id]') as HTMLElement | null
    if (!target) return
    const segId = target.dataset.segId || ''
    const body = window.prompt('批注内容：')
    if (!body) return
    anno.create({
      anchor: { type: 'segment', segId: `${side}:${segId}` },
      body,
      userId: collabIdentity?.userId || 'anon',
      userName: collabIdentity?.userName || '匿名',
      color: collabIdentity?.color || '#888'
    }).then(a => {
      if (collabOn) collabSendAnnotate('create', a)
    }).catch(e => console.warn('[annotations] create failed', e))
  }, [annoOn, anno, collabOn, collabIdentity, collabSendAnnotate])

  const onResolve = useCallback((id: string) => {
    anno.update(id, { status: 'resolved' }).then(a => { if (collabOn && a) collabSendAnnotate('update', a) })
  }, [anno, collabOn, collabSendAnnotate])

  const onDelete = useCallback((id: string) => {
    anno.remove(id).then(() => { if (collabOn) collabSendAnnotate('delete', { id, taskId: src.id }) })
  }, [anno, collabOn, collabSendAnnotate, src.id])

  const onAnnoPick = useCallback((a: any) => {
    const [side, segId] = (a.anchor.segId || '').split(':')
    const root = side === 'src' ? srcWrapRef.current : tgtWrapRef.current
    const el = root?.querySelector(`[data-seg-id="${segId}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    align.highlight(segId)
  }, [align])

  return (
    <div className="modal-mask compare-mask" onMouseDown={onClose}>
      <div className="modal compare-modal" onMouseDown={e => e.stopPropagation()}>
        <header className="modal-header">
          <div className="modal-title">
            <span className="modal-icon">⇄</span>
            <div className="modal-name">{src.name} ⟷ {tgt.name}</div>
          </div>
          <div className="modal-meta">
            {align.alignment ? (
              <>
                <span>对齐 {align.alignment.stats.matched} 段</span>
                <span>·</span>
                <span>置信度 {(align.alignment.stats.scoreAvg * 100).toFixed(0)}%</span>
                <span>·</span>
                <span>{align.alignment.stats.algorithm}</span>
              </>
            ) : align.loading ? <span>对齐中…</span> : align.error ? <span className="err">对齐失败</span> : <span>提取段中…</span>}
          </div>
          <div className="modal-actions">
            <button
              className={`btn-mini ${annoOn ? 'is-active' : ''}`}
              onClick={() => setAnnoOn(v => !v)}
              title="在段上双击添加批注"
            >批注 {anno.annotations.length || ''}</button>
            <button
              className={`btn-mini ${collabOn ? 'is-active' : ''}`}
              onClick={() => setCollabOn(v => !v)}
              title="开启多人协同"
            >协作</button>
            <button
              className={`btn-mini ${qaOn ? 'is-active' : ''}`}
              onClick={() => setQaOn(v => !v)}
              title="质检建议"
            >质检</button>
            {collabOn && <PresenceBar />}
            <button className="btn-mini" onClick={onClose}>关闭 ✕</button>
          </div>
        </header>
        <div className="compare-body" style={{ position: 'relative' }}>
          <div className="compare-pane" ref={srcWrapRef} onMouseOver={onSegEvent('src')} onDoubleClick={onSegDblClick('src')}>
            <PaneHeader task={src} side="源" mode={srcMode} />
            <Suspense fallback={<Fallback />}>
              <PreviewRouter task={src} mode={srcMode} />
            </Suspense>
            {annoOn && <AnnotationLayer
              annotations={anno.annotations.filter(a => a.anchor.segId?.startsWith('src:'))}
              root={srcWrapRef.current}
              onResolve={onResolve}
              onDelete={onDelete}
            />}
            {collabOn && <CursorsLayer root={srcWrapRef.current} />}
          </div>
          <div className="compare-pane" ref={tgtWrapRef} onMouseOver={onSegEvent('tgt')} onDoubleClick={onSegDblClick('tgt')}>
            <PaneHeader task={tgt} side="译" mode={tgtMode} />
            <Suspense fallback={<Fallback />}>
              <PreviewRouter task={tgt} mode={tgtMode} />
            </Suspense>
            {annoOn && <AnnotationLayer
              annotations={anno.annotations.filter(a => a.anchor.segId?.startsWith('tgt:'))}
              root={tgtWrapRef.current}
              onResolve={onResolve}
              onDelete={onDelete}
            />}
            {collabOn && <CursorsLayer root={tgtWrapRef.current} />}
          </div>

          {annoOn && (
            <AnnotationList
              annotations={anno.annotations}
              onPick={onAnnoPick}
              onClose={() => setAnnoOn(false)}
            />
          )}

          {qaOn && (
            <div className="qa-list">
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                <strong style={{ flex: 1 }}>质检 {qaIssues.length}</strong>
                <button className="btn-mini" onClick={() => setQaOn(false)}>收起 ✕</button>
              </div>
              {qaLoading ? <div className="hint">加载中…</div> : qaIssues.length === 0 ? (
                <div className="hint">无质检建议</div>
              ) : qaIssues.map(i => (
                <div key={i.id} className={`qa-item ${i.severity}`}>
                  <div className="qa-rule">{i.rule}</div>
                  <div className="qa-msg">{i.message}</div>
                  <div className="qa-suggestion">建议：{i.suggestion}</div>
                  <div className="qa-actions">
                    <button className="btn-mini" onClick={async () => {
                      const f = await fetchQAFix(tgt.id, i)
                      if (f.appliedText) navigator.clipboard?.writeText(f.appliedText)
                    }}>复制建议</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function PaneHeader({ task, side, mode }: { task: Task; side: string; mode: string }) {
  return (
    <div className="compare-pane-header">
      <span className={`chip chip-side chip-${side === '源' ? 'src' : 'tgt'}`}>{side}</span>
      <span className="card-icon icon-pdf">{fileIcon(task.ext)}</span>
      <span className="compare-pane-name" title={task.name}>{task.name}</span>
      <span className="chip">{humanSize(task.size)}</span>
      <span className="chip chip-mode" title="强制使用 PDFium 像素对齐的栅格化图片+文字层">渲染：图片+文字</span>
    </div>
  )
}
