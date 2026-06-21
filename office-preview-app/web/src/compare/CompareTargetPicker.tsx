// CompareTargetPicker：选择译文对照目标
// 模型：claude-sonnet-4-6
import { useMemo, useState } from 'react'
import type { Task } from '../types'
import { fileIcon, humanSize, formatTime } from '../types'

interface Props {
  src: Task
  candidates: Task[]
  onPick: (t: Task) => void
  onCancel: () => void
}

export function CompareTargetPicker({ src, candidates, onPick, onCancel }: Props) {
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return candidates
      .filter(t => t.id !== src.id)
      .filter(t => ['docx', 'pdf'].includes((t.previewExt || t.ext).toLowerCase()))
      .filter(t => !q || t.name.toLowerCase().includes(q))
  }, [candidates, query, src.id])

  return (
    <div className="modal-mask" onMouseDown={onCancel}>
      <div className="modal compare-picker" onMouseDown={e => e.stopPropagation()}>
        <header className="modal-header">
          <div className="modal-title">
            <span className="modal-icon">⇄</span>
            <div className="modal-name">选择译文对照目标</div>
          </div>
          <div className="modal-meta">
            <span className="chip">源：{src.name}</span>
          </div>
          <div className="modal-actions">
            <button className="btn-mini" onClick={onCancel}>取消 ✕</button>
          </div>
        </header>
        <div className="picker-body">
          <input
            className="search"
            placeholder="搜索文件名…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          {filtered.length === 0 ? (
            <div className="center-msg">无可对比文件（仅支持 .docx / .pdf）</div>
          ) : (
            <ul className="picker-list">
              {filtered.map(t => (
                <li key={t.id}>
                  <button className="picker-item" onClick={() => onPick(t)}>
                    <span className={`card-icon icon-${t.ext.slice(0, 4)}`}>{fileIcon(t.ext)}</span>
                    <span className="picker-name" title={t.name}>{t.name}</span>
                    <span className="chip">{humanSize(t.size)}</span>
                    <span className="chip">{formatTime(t.createdAt)}</span>
                    <span className="picker-cta">选择 →</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
