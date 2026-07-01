// TranslationPage — 智能翻译（大厂视觉重写）
// 模型：claude-sonnet-4-6
// 布局：使用 xf-workspace（左侧子菜单 + 内容区），统一 QualityCheckPage 风格
// 支持：实时翻译 / 文本翻译 / 文档翻译 / 图片翻译 / 音频翻译 / 视频翻译
import { useState, useCallback, useRef, useEffect } from 'react'
import { useStore } from '../store'
import type { Task, LangCode } from '../types'
import { LanguagesIcon, ArrowRightIcon, CopyIcon, SparkleIcon, RefreshIcon, FileTextIcon, ImageIcon, VideoIcon, MusicIcon, UploadIcon, BoltIcon } from '../design/icons'

type TransMode = 'realtime' | 'text' | 'doc' | 'image' | 'audio' | 'video'

const SUBMENU: { key: TransMode; label: string; icon: typeof FileTextIcon }[] = [
  { key: 'realtime', label: '实时翻译', icon: BoltIcon },
  { key: 'text', label: '文本翻译', icon: FileTextIcon },
  { key: 'doc', label: '文档翻译', icon: FileTextIcon },
  { key: 'image', label: '图片翻译', icon: ImageIcon },
  { key: 'audio', label: '音频翻译', icon: MusicIcon },
  { key: 'video', label: '视频翻译', icon: VideoIcon },
]

const LANG_OPTIONS: { code: LangCode; label: string }[] = [
  { code: 'zh-CN', label: '中文（简体）' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'es', label: 'Español' },
  { code: 'ru', label: 'Русский' },
]

interface TransSegment {
  id: number
  source: string
  target: string
}

export function TranslationPage() {
  const [mode, setMode] = useState<TransMode>('text')
  const { tasks, fetchTasks } = useStore()

  return (
    <div className="xf-workspace">
      <div className="xf-submenu">
        {SUBMENU.map(s => (
          <button
            key={s.key}
            className={`xf-submenu-item${mode === s.key ? ' active' : ''}`}
            onClick={() => setMode(s.key)}
          >
            <s.icon size={14} style={{ marginRight: 8, opacity: 0.7 }} />
            {s.label}
          </button>
        ))}
      </div>

      <div className="xf-content">
        {mode === 'realtime' && <RealtimeTranslateMode />}
        {mode === 'text' && <TextTranslateMode />}
        {mode === 'doc' && <DocTranslateMode tasks={tasks} />}
        {mode === 'image' && <ImageTranslateMode tasks={tasks} />}
        {mode === 'audio' && <AudioTranslateMode tasks={tasks} />}
        {mode === 'video' && <VideoTranslateMode tasks={tasks} />}
      </div>
    </div>
  )
}

/* ============ 实时翻译模式（词级对齐 + 标注反馈） ============ */
type AlignPair = [number, number, number] // [srcIdx, tgtIdx, score]
interface Annotation {
  id: string
  kind: 'align_fix' | 'seg_rating' | 'alt_trans'
  srcText?: string
  tgtText?: string
  payload: any
  createdAt: number
}

function RealtimeTranslateMode() {
  const [inputText, setInputText] = useState('')
  const [sourceLang, setSourceLang] = useState<LangCode>('zh-CN')
  const [targetLang, setTargetLang] = useState<LangCode>('en')
  const [target, setTarget] = useState('')
  const [engine, setEngine] = useState('')
  const [ms, setMs] = useState(0)
  const [translating, setTranslating] = useState(false)
  const [srcTokens, setSrcTokens] = useState<string[]>([])
  const [tgtTokens, setTgtTokens] = useState<string[]>([])
  const [pairs, setPairs] = useState<AlignPair[]>([])
  const [hoverSrc, setHoverSrc] = useState<number | null>(null)
  const [hoverTgt, setHoverTgt] = useState<number | null>(null)
  const [viewMode, setViewMode] = useState<'word' | 'paragraph'>('word')
  const [hoveredSrcPara, setHoveredSrcPara] = useState<number | null>(null)
  const [hoveredTgtPara, setHoveredTgtPara] = useState<number | null>(null)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [popupOpen, setPopupOpen] = useState(false)
  const [popupKind, setPopupKind] = useState<'align_fix' | 'seg_rating' | 'alt_trans'>('seg_rating')
  const [popupRating, setPopupRating] = useState(5)
  const [popupComment, setPopupComment] = useState('')
  const [popupAlt, setPopupAlt] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastInputRef = useRef('')
  const paraSrcRef = useRef<HTMLDivElement | null>(null)
  const paraTgtRef = useRef<HTMLDivElement | null>(null)
  const lastParaScrollTsRef = useRef(0)

  // 反向索引：srcIdx → 命中的 tgtIdx 集合；tgtIdx → 命中的 srcIdx 集合
  const srcToTgt = useRef<Map<number, number[]>>(new Map())
  const tgtToSrc = useRef<Map<number, number[]>>(new Map())

  useEffect(() => {
    srcToTgt.current = new Map()
    tgtToSrc.current = new Map()
    for (const [s, t] of pairs) {
      if (!srcToTgt.current.has(s)) srcToTgt.current.set(s, [])
      srcToTgt.current.get(s)!.push(t)
      if (!tgtToSrc.current.has(t)) tgtToSrc.current.set(t, [])
      tgtToSrc.current.get(t)!.push(s)
    }
  }, [pairs])

  const doTranslate = useCallback(async (text: string, sLang: LangCode, tLang: LangCode) => {
    if (!text.trim()) {
      setTarget(''); setSrcTokens([]); setTgtTokens([]); setPairs([])
      return
    }
    setTranslating(true)
    try {
      const tr = await fetch('/api/translate/realtime', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, sourceLang: sLanguage(sLang), targetLang: tLang }),
      })
      if (!tr.ok) throw new Error(`API ${tr.status}`)
      const tdata = await tr.json()
      setTarget(tdata.target || '')
      setEngine(tdata.engine || '')
      setMs(tdata.ms || 0)

      // 词级对齐
      const ar = await fetch('/api/translate/align', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ src: text, tgt: tdata.target || '' }),
      })
      if (ar.ok) {
        const adata = await ar.json()
        setSrcTokens(adata.srcTokens || [])
        setTgtTokens(adata.tgtTokens || [])
        setPairs(adata.pairs || [])
      }
    } catch (e) {
      console.warn('[realtime-translate] failed', e)
    } finally {
      setTranslating(false)
    }
  }, [])

  // debounce 输入变化
  useEffect(() => {
    if (inputText === lastInputRef.current) return
    lastInputRef.current = inputText
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      doTranslate(inputText, sourceLang, targetLang)
    }, 500)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [inputText, sourceLang, targetLang, doTranslate])

  // 加载标注列表
  const refreshAnnotations = useCallback(async () => {
    try {
      const r = await fetch('/api/translate/annotation?taskId=standalone')
      if (!r.ok) return
      const d = await r.json()
      setAnnotations(d.items || [])
    } catch {}
  }, [])

  useEffect(() => { refreshAnnotations() }, [refreshAnnotations])

  const swapLang = useCallback(() => {
    setSourceLang(prev => { const t = targetLang; setTargetLang(prev); return t })
    setTarget(''); setSrcTokens([]); setTgtTokens([]); setPairs([])
    lastInputRef.current = ''
  }, [targetLang])

  const openPopup = (kind: 'align_fix' | 'seg_rating' | 'alt_trans') => {
    setPopupKind(kind)
    setPopupRating(5); setPopupComment(''); setPopupAlt('')
    setPopupOpen(true)
  }

  const submitAnnotation = useCallback(async () => {
    const payload: any = {}
    if (popupKind === 'seg_rating') { payload.rating = popupRating; payload.comment = popupComment }
    else if (popupKind === 'alt_trans') { payload.alternative = popupAlt }
    else if (popupKind === 'align_fix') { payload.from = [hoverSrc ?? 0]; payload.to = [hoverTgt ?? 0] }

    try {
      await fetch('/api/translate/annotation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: popupKind,
          taskId: 'standalone',
          segmentId: 'seg-0',
          srcText: inputText,
          tgtText: target,
          langPair: [sourceLang, targetLang],
          payload,
        }),
      })
      setPopupOpen(false)
      refreshAnnotations()
    } catch (e) {
      console.warn('[annotation-submit] failed', e)
    }
  }, [popupKind, popupRating, popupComment, popupAlt, hoverSrc, hoverTgt, inputText, target, sourceLang, targetLang, refreshAnnotations])

  const deleteAnnotation = useCallback(async (id: string) => {
    try {
      await fetch(`/api/translate/annotation?taskId=standalone&id=${id}`, { method: 'DELETE' })
      refreshAnnotations()
    } catch {}
  }, [refreshAnnotations])

  // src token hover → 高亮匹配的 tgt token
  const highlightedTgt = new Set<number>()
  if (hoverSrc !== null) {
    const ts = srcToTgt.current.get(hoverSrc) || []
    ts.forEach(t => highlightedTgt.add(t))
  }
  const highlightedSrc = new Set<number>()
  if (hoverTgt !== null) {
    const ss = tgtToSrc.current.get(hoverTgt) || []
    ss.forEach(s => highlightedSrc.add(s))
  }

  // 段落切分（按 \n），用于"段落对照"模式
  const srcParas = inputText.split(/\n+/).map(p => p.trim()).filter(Boolean)
  const tgtParas = target.split(/\n+/).map(p => p.trim()).filter(Boolean)
  // token idx → para idx 映射
  const tokenToPara = (tokens: string[]): number[] => {
    const m: number[] = []
    let paraIdx = 0
    for (const tk of tokens) {
      m.push(paraIdx)
      if (tk.includes('\n')) paraIdx++
    }
    return m
  }
  const srcTokenToPara = tokenToPara(srcTokens)
  const tgtTokenToPara = tokenToPara(tgtTokens)
  // 段落级 hover 桥接：基于 token hover 推断段落
  const paraFromSrc = hoverSrc !== null ? srcTokenToPara[hoverSrc] : null
  const paraFromTgt = hoverTgt !== null ? tgtTokenToPara[hoverTgt] : null
  const effectiveSrcPara = hoveredSrcPara ?? paraFromSrc
  const effectiveTgtPara = hoveredTgtPara ?? paraFromTgt

  return (
    <>
      {/* 工具条 */}
      <div style={{
        padding: '12px 24px',
        borderBottom: '1px solid var(--xf-border-light)',
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        background: 'var(--xf-bg-subtle)',
      }}>
        <select
          className="xf-select"
          value={sourceLang}
          onChange={e => { setSourceLang(e.target.value as LangCode); setTarget(''); setPairs([]); lastInputRef.current = '' }}
          style={{ minWidth: 140 }}
        >
          {LANG_OPTIONS.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
        </select>

        <button className="xf-mini-btn" onClick={swapLang} title="交换">
          <ArrowRightIcon size={12} />
        </button>

        <select
          className="xf-select"
          value={targetLang}
          onChange={e => { setTargetLang(e.target.value as LangCode); setTarget(''); setPairs([]); lastInputRef.current = '' }}
          style={{ minWidth: 140 }}
        >
          {LANG_OPTIONS.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
        </select>

        <div style={{ flex: 1 }} />

        {translating && <span style={{ fontSize: 12, color: 'var(--xf-text-secondary)' }}><span className="xf-loading" /> 实时翻译中…</span>}
        {engine && !translating && (
          <span style={{ fontSize: 12, color: 'var(--xf-text-tertiary)' }}>
            ⚡ {engine} · {ms}ms · {pairs.length} 对齐
          </span>
        )}
        <div data-testid="rt-view-mode" style={{ display: 'flex', gap: 2, marginLeft: 12, border: '1px solid #d9d9d9', borderRadius: 4, overflow: 'hidden' }}>
          <button
            data-testid="rt-view-mode-word"
            onClick={() => setViewMode('word')}
            style={{
              padding: '2px 10px', fontSize: 12, border: 'none', cursor: 'pointer',
              background: viewMode === 'word' ? '#1677ff' : 'transparent',
              color: viewMode === 'word' ? '#fff' : 'var(--xf-text-secondary)',
            }}
          >词级</button>
          <button
            data-testid="rt-view-mode-paragraph"
            onClick={() => setViewMode('paragraph')}
            style={{
              padding: '2px 10px', fontSize: 12, border: 'none', cursor: 'pointer',
              background: viewMode === 'paragraph' ? '#1677ff' : 'transparent',
              color: viewMode === 'paragraph' ? '#fff' : 'var(--xf-text-secondary)',
            }}
          >段落</button>
        </div>
      </div>

      {/* 主体：输入 + 双栏对齐 */}
      <div className="xf-editor-layout">
        <div className="xf-editor-main">
          <div className="xf-editor-canvas xf-text" data-testid="rt-input-pane">
            <textarea
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              placeholder="开始输入，500ms 后自动翻译…支持词级对齐与标注反馈"
              style={{
                width: '100%', height: '100%', border: 'none', outline: 'none',
                resize: 'none', fontSize: 15, lineHeight: 2, fontFamily: 'inherit',
                background: 'transparent', padding: 0,
              }}
            />
          </div>
          <div className="xf-editor-toolbar">
            <span style={{ fontSize: 12, color: 'var(--xf-text-tertiary)' }}>{inputText.length} 字符</span>
            <div className="xf-tb-spacer" />
            <button className="xf-tb-btn" onClick={() => { setInputText(''); setTarget(''); setPairs([]); lastInputRef.current = '' }}>
              <RefreshIcon size={12} /> 清空
            </button>
          </div>
        </div>

        <div className="xf-error-list" data-testid="rt-align-pane">
          {/* 译文 token 区（可点击标注） */}
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--xf-border-light)', display: 'flex', gap: 8, alignItems: 'center' }}>
            <BoltIcon size={14} style={{ color: '#722ed1' }} />
            <span style={{ fontWeight: 600, fontSize: 13 }}>
              {viewMode === 'word' ? '实时译文 · 词级对齐' : '实时译文 · 段落对照'}
            </span>
            <div style={{ flex: 1 }} />
            <button className="xf-mini-btn primary" onClick={() => openPopup('seg_rating')} disabled={!target} title="对当前译文评分">
              ★ 评分
            </button>
            <button className="xf-mini-btn" onClick={() => openPopup('alt_trans')} disabled={!target} title="提供更优翻译">
              ✎ 改译
            </button>
          </div>

          {viewMode === 'paragraph' ? (
            <div data-testid="rt-para-pane" style={{ flex: 1, overflow: 'auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
              <div ref={paraSrcRef} data-testid="rt-para-src-col" style={{ borderRight: '1px solid var(--xf-border-light)' }}>
                <div style={{ fontSize: 10, color: 'var(--xf-text-tertiary)', padding: '8px 12px', borderBottom: '1px solid var(--xf-border-light)' }}>
                  原文段落（{srcParas.length}）
                </div>
                {srcParas.length === 0 ? (
                  <div style={{ padding: 24, color: 'var(--xf-text-tertiary)', fontSize: 12 }}>输入文本后显示</div>
                ) : srcParas.map((p, i) => (
                  <div
                    key={i}
                    data-testid={`rt-para-src-${i}`}
                    onMouseEnter={() => {
                    setHoveredSrcPara(i)
                    // 同步滚动：src hover → 目标列对应段滚入视（80ms debounce）
                    const now = Date.now()
                    if (now - lastParaScrollTsRef.current >= 80) {
                      lastParaScrollTsRef.current = now
                      requestAnimationFrame(() => {
                        const tgtEl = paraTgtRef.current?.querySelector(`[data-testid="rt-para-tgt-${i}"]`) as HTMLElement | null
                        tgtEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
                      })
                    }
                  }}
                    onMouseLeave={() => setHoveredSrcPara(null)}
                    style={{
                      padding: 10, fontSize: 13, lineHeight: 1.7,
                      borderBottom: '1px solid var(--xf-border-light)',
                      background: effectiveSrcPara === i ? '#fff7e6' : 'transparent',
                      borderLeft: effectiveSrcPara === i ? '3px solid #faad14' : '3px solid transparent',
                      transition: 'all 120ms', cursor: 'pointer',
                    }}
                  >{p}</div>
                ))}
              </div>
              <div ref={paraTgtRef} data-testid="rt-para-tgt-col" style={{ background: 'var(--xf-primary-bg)' }}>
                <div style={{ fontSize: 10, color: 'var(--xf-text-tertiary)', padding: '8px 12px', borderBottom: '1px solid var(--xf-border-light)' }}>
                  译文段落（{tgtParas.length}）
                </div>
                {tgtParas.length === 0 ? (
                  <div style={{ padding: 24, color: 'var(--xf-text-tertiary)', fontSize: 12 }}>翻译后显示</div>
                ) : tgtParas.map((p, i) => (
                  <div
                    key={i}
                    data-testid={`rt-para-tgt-${i}`}
                    onMouseEnter={() => {
                    setHoveredTgtPara(i)
                    // 反向同步：tgt hover → 源列对应段滚入视
                    const now = Date.now()
                    if (now - lastParaScrollTsRef.current >= 80) {
                      lastParaScrollTsRef.current = now
                      requestAnimationFrame(() => {
                        const srcEl = paraSrcRef.current?.querySelector(`[data-testid="rt-para-src-${i}"]`) as HTMLElement | null
                        srcEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
                      })
                    }
                  }}
                    onMouseLeave={() => setHoveredTgtPara(null)}
                    style={{
                      padding: 10, fontSize: 13, lineHeight: 1.7, color: 'var(--xf-primary)',
                      borderBottom: '1px solid var(--xf-border-light)',
                      background: effectiveTgtPara === i ? '#fff7e6' : 'transparent',
                      borderRight: effectiveTgtPara === i ? '3px solid #faad14' : '3px solid transparent',
                      transition: 'all 120ms', cursor: 'pointer',
                    }}
                  >{p}</div>
                ))}
              </div>
            </div>
          ) : null}

          {viewMode === 'word' && (
            <>
          {/* src tokens */}
          {srcTokens.length > 0 && (
            <div
              data-testid="rt-source-pane"
              style={{ padding: 12, borderBottom: '1px solid var(--xf-border-light)', fontSize: 13, lineHeight: 1.8 }}
            >
              <div style={{ fontSize: 10, color: 'var(--xf-text-tertiary)', marginBottom: 4 }}>原文 token（悬停联动）</div>
              {srcTokens.map((tk, i) => (
                <span
                  key={i}
                  onMouseEnter={() => setHoverSrc(i)}
                  onMouseLeave={() => setHoverSrc(null)}
                  style={{
                    display: 'inline-block', marginRight: 4, marginBottom: 4,
                    padding: '2px 6px', borderRadius: 4, cursor: 'pointer',
                    background: highlightedSrc.has(i) ? '#fff7e6' : 'var(--xf-bg-subtle)',
                    border: highlightedSrc.has(i) ? '1px solid #faad14' : '1px solid transparent',
                    color: 'var(--xf-text)', transition: 'all 120ms',
                  }}
                >{tk}</span>
              ))}
            </div>
          )}

          {/* tgt tokens */}
          <div
            data-testid="rt-target-pane"
            onClick={() => target && openPopup('seg_rating')}
            style={{ padding: 12, fontSize: 13, lineHeight: 1.8, cursor: target ? 'pointer' : 'default', flex: 1, overflow: 'auto' }}
          >
            {tgtTokens.length > 0 ? (
              tgtTokens.map((tk, i) => (
                <span
                  key={i}
                  onMouseEnter={() => setHoverTgt(i)}
                  onMouseLeave={() => setHoverTgt(null)}
                  style={{
                    display: 'inline-block', marginRight: 4, marginBottom: 4,
                    padding: '2px 6px', borderRadius: 4,
                    background: highlightedTgt.has(i) ? '#f6ffed' : 'var(--xf-primary-bg)',
                    border: highlightedTgt.has(i) ? '1px solid #52c41a' : '1px solid transparent',
                    color: 'var(--xf-primary)', transition: 'all 120ms',
                  }}
                >{tk}</span>
              ))
            ) : target ? (
              <span style={{ color: 'var(--xf-primary)' }}>{target}</span>
            ) : (
              <span style={{ color: 'var(--xf-text-tertiary)' }}>{translating ? '翻译中…' : '译文将在此显示'}</span>
            )}
          </div>

          </>)}
        </div>

        {/* 标注列表（跨视图共享） */}
        {annotations.length > 0 && (
          <div style={{ padding: 12, borderTop: '1px solid var(--xf-border-light)', maxHeight: 180, overflow: 'auto', background: '#fff' }}>
            <div style={{ fontSize: 10, color: 'var(--xf-text-tertiary)', marginBottom: 6 }}>已提交标注 {annotations.length} 条</div>
            {annotations.map(a => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 0', borderBottom: '1px solid var(--xf-border-light)' }}>
                <span style={{ padding: '1px 6px', borderRadius: 8, fontSize: 10, fontWeight: 600, background: kindColor(a.kind), color: '#fff' }}>
                  {kindLabel(a.kind)}
                </span>
                <span style={{ flex: 1, color: 'var(--xf-text-secondary)' }}>{annotationSummary(a)}</span>
                <button className="xf-mini-btn" onClick={() => deleteAnnotation(a.id)} title="删除">×</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 标注反馈弹窗 */}
      {popupOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000,
        }} onClick={() => setPopupOpen(false)}>
          <div
            data-testid="rt-annotation-popup"
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 12, padding: 24, minWidth: 420, maxWidth: 540,
              boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>📝 标注反馈</div>

            {/* 类型选择 */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
              {(['seg_rating', 'alt_trans', 'align_fix'] as const).map(k => (
                <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="ann-kind"
                    checked={popupKind === k}
                    onChange={() => setPopupKind(k)}
                  />
                  {kindLabel(k)}
                </label>
              ))}
            </div>

            {/* 字段区 */}
            {popupKind === 'seg_rating' && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 13, marginBottom: 8 }}>评分：</div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {[1, 2, 3, 4, 5].map(n => (
                    <button
                      key={n}
                      onClick={() => setPopupRating(n)}
                      style={{
                        width: 32, height: 32, border: 'none', background: 'transparent',
                        cursor: 'pointer', fontSize: 20, color: n <= popupRating ? '#faad14' : '#d9d9d9',
                      }}
                    >★</button>
                  ))}
                </div>
                <textarea
                  placeholder="反馈说明（可选）"
                  value={popupComment}
                  onChange={e => setPopupComment(e.target.value)}
                  style={{ width: '100%', marginTop: 12, minHeight: 80, padding: 8, borderRadius: 6, border: '1px solid #d9d9d9', fontSize: 13, resize: 'vertical' }}
                />
              </div>
            )}

            {popupKind === 'alt_trans' && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 13, marginBottom: 8 }}>建议译文：</div>
                <textarea
                  placeholder="输入您认为更好的翻译…"
                  value={popupAlt}
                  onChange={e => setPopupAlt(e.target.value)}
                  style={{ width: '100%', minHeight: 100, padding: 8, borderRadius: 6, border: '1px solid #d9d9d9', fontSize: 13, resize: 'vertical' }}
                />
              </div>
            )}

            {popupKind === 'align_fix' && (
              <div style={{ marginBottom: 16, fontSize: 13, color: 'var(--xf-text-secondary)' }}>
                <p>当前选中：原文 token #{hoverSrc ?? '-'} ↔ 译文 token #{hoverTgt ?? '-'}</p>
                <p style={{ marginTop: 8 }}>请在原文/译文中悬停 token 后再点击此处确认对齐修正。</p>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="xf-mini-btn" onClick={() => setPopupOpen(false)}>取消</button>
              <button
                onClick={submitAnnotation}
                disabled={popupKind === 'alt_trans' && !popupAlt.trim()}
                style={{
                  padding: '6px 16px', borderRadius: 6, border: 'none',
                  background: popupKind === 'alt_trans' && !popupAlt.trim() ? '#d9d9d9' : '#1677ff',
                  color: '#fff', cursor: 'pointer', fontSize: 13,
                }}
              >提交反馈</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function sLanguage(code: LangCode): string {
  return code
}

function kindLabel(kind: string): string {
  if (kind === 'align_fix') return '对齐修正'
  if (kind === 'seg_rating') return '段落评分'
  if (kind === 'alt_trans') return '改译建议'
  return kind
}

function kindColor(kind: string): string {
  if (kind === 'align_fix') return '#722ed1'
  if (kind === 'seg_rating') return '#faad14'
  if (kind === 'alt_trans') return '#52c41a'
  return '#86909c'
}

function annotationSummary(a: Annotation): string {
  if (a.kind === 'seg_rating') {
    const r = a.payload?.rating || 0
    return `★ ${r}/5${a.payload?.comment ? ' · ' + a.payload.comment : ''}`
  }
  if (a.kind === 'alt_trans') return `建议：${a.payload?.alternative || ''}`.slice(0, 60)
  if (a.kind === 'align_fix') return `#${a.payload?.from?.[0] ?? '-'} → #${a.payload?.to?.[0] ?? '-'}`
  return ''
}

/* ============ 文本翻译模式 ============ */
function TextTranslateMode() {
  const [inputText, setInputText] = useState('')
  const [sourceLang, setSourceLang] = useState<LangCode>('zh-CN')
  const [targetLang, setTargetLang] = useState<LangCode>('en')
  const [translating, setTranslating] = useState(false)
  const [result, setResult] = useState<TransSegment[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<{ ms: number; chars: number; engine: string } | null>(null)
  const [hoveredSegId, setHoveredSegId] = useState<number | null>(null)

  const doTranslate = useCallback(async () => {
    if (!inputText.trim()) return
    setTranslating(true)
    setError(null)
    setResult(null)
    const t0 = performance.now()
    try {
      const r = await fetch('/api/inspect/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ sourceLang, targetLang, taskId: 'standalone', text: inputText }),
      })
      if (!r.ok) throw new Error(`API ${r.status}`)
      const data = await r.json()
      setResult(data.segments.map((s: any, i: number) => ({
        id: i, source: s.source, target: s.target,
      })))
      setStats({
        ms: Math.round(performance.now() - t0),
        chars: data.meta.targetChars,
        engine: data.meta.engine,
      })
    } catch (e: any) {
      setError(e.message || '翻译失败')
    } finally {
      setTranslating(false)
    }
  }, [inputText, sourceLang, targetLang])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') doTranslate()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [doTranslate])

  const copyAll = useCallback(async (side: 'source' | 'target') => {
    if (!result) return
    const text = result.map(s => side === 'source' ? s.source : s.target).join('\n')
    await navigator.clipboard.writeText(text)
  }, [result])

  const swapLang = useCallback(() => {
    setSourceLang(prev => { const t = targetLang; setTargetLang(prev); return t })
  }, [targetLang])

  return (
    <>
      {/* 工具按钮条 */}
      <div style={{
        padding: '12px 24px',
        borderBottom: '1px solid var(--xf-border-light)',
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        background: 'var(--xf-bg-subtle)',
      }}>
        <select
          className="xf-select"
          value={sourceLang}
          onChange={e => setSourceLang(e.target.value as LangCode)}
          style={{ minWidth: 140 }}
        >
          {LANG_OPTIONS.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
        </select>

        <button
          className="xf-mini-btn"
          onClick={swapLang}
          title="交换源语言和目标语言"
        >
          <ArrowRightIcon size={12} />
        </button>

        <select
          className="xf-select"
          value={targetLang}
          onChange={e => setTargetLang(e.target.value as LangCode)}
          style={{ minWidth: 140 }}
        >
          {LANG_OPTIONS.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
        </select>

        <div style={{ flex: 1 }} />

        <button
          className="xf-btn-solid"
          onClick={doTranslate}
          disabled={translating || !inputText.trim()}
          style={{ minWidth: 100 }}
        >
          {translating ? <><span className="xf-loading" /> 翻译中…</> : <><SparkleIcon size={14} /> 翻译</>}
        </button>

        {stats && (
          <span style={{ fontSize: 13, color: 'var(--xf-text-secondary)' }}>
            {stats.engine} · {stats.ms}ms · {stats.chars} 字符
          </span>
        )}
      </div>

      {error && (
        <div style={{
          padding: '8px 24px', background: 'var(--xf-danger-bg)',
          borderBottom: '1px solid var(--xf-danger-border)',
          color: 'var(--xf-danger)', fontSize: 13,
        }}>
          翻译失败：{error}
        </div>
      )}

      {/* 主体: 输入 + 结果 */}
      <div className="xf-editor-layout">
        <div className="xf-editor-main">
          <div className="xf-editor-canvas xf-text">
            <textarea
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              placeholder="输入要翻译的文本…支持中/英/日/韩/法/德/西/俄 8 种语言，Ctrl+Enter 快捷翻译"
              style={{
                width: '100%', height: '100%', border: 'none', outline: 'none',
                resize: 'none', fontSize: 15, lineHeight: 2, fontFamily: 'inherit',
                background: 'transparent', padding: 0,
              }}
            />
          </div>

          <div className="xf-editor-toolbar">
            <span style={{ fontSize: 12, color: 'var(--xf-text-tertiary)' }}>
              {inputText.length} 字符
            </span>
            <div className="xf-tb-spacer" />
            <button className="xf-tb-btn" onClick={() => setInputText('')} disabled={!inputText}>
              <RefreshIcon size={12} /> 清空
            </button>
          </div>
        </div>

        <div className="xf-error-list">
          {result ? (
            <>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--xf-border-light)', display: 'flex', gap: 8 }}>
                <button className="xf-mini-btn" onClick={() => copyAll('source')}>
                  <CopyIcon size={12} /> 复制原文
                </button>
                <button className="xf-mini-btn primary" onClick={() => copyAll('target')}>
                  <CopyIcon size={12} /> 复制译文
                </button>
              </div>
              <div data-testid="text-compare-result" style={{ flex: 1, overflow: 'auto' }}>
                {result.map((seg, i) => {
                  const isHovered = hoveredSegId === seg.id
                  return (
                    <div
                      key={seg.id}
                      data-testid={`text-compare-row-${i}`}
                      onMouseEnter={() => setHoveredSegId(seg.id)}
                      onMouseLeave={() => setHoveredSegId(null)}
                      style={{
                        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0,
                        borderBottom: i < result.length - 1 ? '1px solid var(--xf-border-light)' : 'none',
                        background: isHovered ? '#fff7e6' : 'transparent',
                        transition: 'background 120ms',
                      }}
                    >
                      <div data-testid={`text-compare-src-${i}`} style={{
                        padding: 12, borderRight: '1px solid var(--xf-border-light)',
                        fontSize: 13, lineHeight: 1.7,
                        borderLeft: isHovered ? '3px solid #faad14' : '3px solid transparent',
                      }}>
                        {seg.source}
                      </div>
                      <div data-testid={`text-compare-tgt-${i}`} style={{
                        padding: 12, background: isHovered ? '#fff7e6' : 'var(--xf-primary-bg)',
                        fontSize: 13, lineHeight: 1.7, color: 'var(--xf-primary)',
                        borderRight: isHovered ? '3px solid #faad14' : '3px solid transparent',
                      }}>
                        {seg.target}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          ) : (
            <div className="xf-empty">
              {translating ? '翻译中…' : '翻译结果将在此显示'}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

/* ============ 文档翻译模式 ============ */
function DocTranslateMode({ tasks }: { tasks: Task[] }) {
  const [sourceLang, setSourceLang] = useState<LangCode>('zh-CN')
  const [targetLang, setTargetLang] = useState<LangCode>('en')
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [translating, setTranslating] = useState(false)
  const [result, setResult] = useState<{ pages: number; segments: number; engine: string; ms: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const docTasks = tasks.filter(t => ['docx', 'pptx', 'xlsx', 'doc', 'ppt', 'xls', 'pdf', 'txt', 'md'].includes(t.ext))

  const doTranslate = useCallback(async () => {
    if (!selectedTask) return
    setTranslating(true); setError(null)
    const t0 = performance.now()
    try {
      const r = await fetch('/api/inspect/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ sourceLang, targetLang, taskId: selectedTask.id }),
      })
      if (!r.ok) throw new Error(`API ${r.status}`)
      const data = await r.json()
      setResult({
        pages: data.meta?.pages || 1,
        segments: data.segments?.length || 0,
        engine: data.meta?.engine || 'unknown',
        ms: Math.round(performance.now() - t0),
      })
    } catch (e: any) {
      setError(e.message)
    } finally {
      setTranslating(false)
    }
  }, [selectedTask, sourceLang, targetLang])

  return (
    <>
      {/* 工具按钮条 */}
      <div style={{
        padding: '12px 24px',
        borderBottom: '1px solid var(--xf-border-light)',
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        background: 'var(--xf-bg-subtle)',
      }}>
        <select
          className="xf-select"
          value={sourceLang}
          onChange={e => setSourceLang(e.target.value as LangCode)}
          style={{ minWidth: 140 }}
        >
          {LANG_OPTIONS.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
        </select>

        <span style={{ color: 'var(--xf-text-tertiary)' }}>→</span>

        <select
          className="xf-select"
          value={targetLang}
          onChange={e => setTargetLang(e.target.value as LangCode)}
          style={{ minWidth: 140 }}
        >
          {LANG_OPTIONS.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
        </select>

        <div style={{ flex: 1 }} />

        <button
          className="xf-btn-solid"
          onClick={doTranslate}
          disabled={!selectedTask || translating}
          style={{ minWidth: 100 }}
        >
          {translating ? <><span className="xf-loading" /> 翻译中…</> : <><SparkleIcon size={14} /> 翻译文档</>}
        </button>

        {result && (
          <span style={{ fontSize: 13, color: 'var(--xf-text-secondary)' }}>
            {result.pages} 页 · {result.segments} 段 · {result.engine} · {result.ms}ms
          </span>
        )}
      </div>

      {error && (
        <div style={{
          padding: '8px 24px', background: 'var(--xf-danger-bg)',
          borderBottom: '1px solid var(--xf-danger-border)',
          color: 'var(--xf-danger)', fontSize: 13,
        }}>
          翻译失败：{error}
        </div>
      )}

      {/* 文件选择 */}
      <div style={{ padding: 24, flex: 1, overflow: 'auto' }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--xf-text)' }}>
          选择文档（支持 docx/pptx/xlsx/pdf/txt/md）
        </div>
        {docTasks.length === 0 ? (
          <div className="xf-empty">
            <div className="xf-empty-icon"><UploadIcon size={32} /></div>
            <div className="xf-empty-title">暂无可翻译文档</div>
            <div className="xf-empty-desc">请先在「文档预览」上传文件</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
            {docTasks.map(t => (
              <div
                key={t.id}
                className={`xf-file-card${selectedTask?.id === t.id ? ' selected' : ''}`}
                onClick={() => setSelectedTask(t)}
              >
                <div className="xf-file-card-icon"><FileTextIcon size={24} /></div>
                <div className="xf-file-card-name">{t.name}</div>
                <div className="xf-file-card-ext">{t.ext.toUpperCase()}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

/* ============ 图片翻译模式 ============ */
function ImageTranslateMode({ tasks }: { tasks: Task[] }) {
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [ocrText, setOcrText] = useState('')
  const [translating, setTranslating] = useState(false)
  const [result, setResult] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  const imageTasks = tasks.filter(t => ['png', 'jpg', 'jpeg', 'bmp', 'webp', 'gif'].includes(t.ext))

  const doOCRAndTranslate = useCallback(async () => {
    if (!selectedTask) return
    setTranslating(true); setError(null)
    try {
      // 1. OCR
      const ocrRes = await fetch('/api/ocr/recognize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ taskId: selectedTask.id }),
      })
      if (!ocrRes.ok) throw new Error(`OCR ${ocrRes.status}`)
      const ocrData = await ocrRes.json()
      const text = ocrData.text || ''
      setOcrText(text)

      // 2. 翻译
      const transRes = await fetch('/api/inspect/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ sourceLang: 'zh-CN', targetLang: 'en', taskId: 'standalone', text }),
      })
      if (!transRes.ok) throw new Error(`翻译 ${transRes.status}`)
      const transData = await transRes.json()
      setResult(transData.segments?.map((s: any) => s.target).join('\n') || '')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setTranslating(false)
    }
  }, [selectedTask])

  return (
    <>
      {/* 工具按钮条 */}
      <div style={{
        padding: '12px 24px',
        borderBottom: '1px solid var(--xf-border-light)',
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        background: 'var(--xf-bg-subtle)',
      }}>
        <button
          className="xf-btn-solid"
          onClick={doOCRAndTranslate}
          disabled={!selectedTask || translating}
          style={{ minWidth: 120 }}
        >
          {translating ? <><span className="xf-loading" /> 处理中…</> : <><ImageIcon size={14} /> OCR + 翻译</>}
        </button>

        <button
          className="xf-mini-btn"
          onClick={() => navigator.clipboard.writeText(result)}
          disabled={!result}
        >
          <CopyIcon size={12} /> 复制译文
        </button>
      </div>

      {error && (
        <div style={{
          padding: '8px 24px', background: 'var(--xf-danger-bg)',
          borderBottom: '1px solid var(--xf-danger-border)',
          color: 'var(--xf-danger)', fontSize: 13,
        }}>
          处理失败：{error}
        </div>
      )}

      {/* 图片选择 + 结果 */}
      <div className="xf-editor-layout">
        <div className="xf-editor-main">
          <div style={{ padding: 16, overflow: 'auto', height: '100%' }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--xf-text)' }}>
              选择图片（png/jpg/jpeg/bmp/webp/gif）
            </div>
            {imageTasks.length === 0 ? (
              <div className="xf-empty">暂无图片，请先上传</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
                {imageTasks.map(t => (
                  <div
                    key={t.id}
                    className={`xf-file-card${selectedTask?.id === t.id ? ' selected' : ''}`}
                    onClick={() => setSelectedTask(t)}
                    style={{ aspectRatio: '1', display: 'flex', flexDirection: 'column' }}
                  >
                    <img src={t.originalUrl} alt={t.name} style={{ width: '100%', height: 80, objectFit: 'cover', borderRadius: 4 }} />
                    <div className="xf-file-card-name" style={{ marginTop: 4 }}>{t.name.slice(0, 12)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="xf-error-list">
          <div style={{ padding: 12, borderBottom: '1px solid var(--xf-border-light)', fontWeight: 600, fontSize: 13 }}>
            OCR 识别文本
          </div>
          <div style={{ padding: 12, fontSize: 13, lineHeight: 1.7, color: 'var(--xf-text-secondary)', borderBottom: '1px solid var(--xf-border-light)', minHeight: 80 }}>
            {ocrText || '(OCR 识别后显示)'}
          </div>
          <div style={{ padding: 12, borderBottom: '1px solid var(--xf-border-light)', fontWeight: 600, fontSize: 13 }}>
            翻译结果
          </div>
          <div style={{ flex: 1, padding: 12, fontSize: 13, lineHeight: 1.7, color: 'var(--xf-primary)', overflow: 'auto' }}>
            {result || '(翻译后显示)'}
          </div>
        </div>
      </div>
    </>
  )
}

/* ============ 音频翻译模式 ============ */
function AudioTranslateMode({ tasks }: { tasks: Task[] }) {
  const audioTasks = tasks.filter(t => ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'].includes(t.ext))

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <div className="xf-empty">
        <div className="xf-empty-icon"><MusicIcon size={48} /></div>
        <div className="xf-empty-title">音频翻译</div>
        <div className="xf-empty-desc">
          需要先进行语音转写（ASR），再翻译文本。<br />
          当前已上传 {audioTasks.length} 个音频文件。
        </div>
      </div>
    </div>
  )
}

/* ============ 视频翻译模式 ============ */
function VideoTranslateMode({ tasks }: { tasks: Task[] }) {
  const videoTasks = tasks.filter(t => ['mp4', 'mov', 'mkv', 'webm', 'avi'].includes(t.ext))

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <div className="xf-empty">
        <div className="xf-empty-icon"><VideoIcon size={48} /></div>
        <div className="xf-empty-title">视频翻译</div>
        <div className="xf-empty-desc">
          需要先提取音轨进行语音转写，再翻译文本。<br />
          当前已上传 {videoTasks.length} 个视频文件。
        </div>
      </div>
    </div>
  )
}
