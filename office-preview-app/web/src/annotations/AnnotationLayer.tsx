// AnnotationLayer：覆盖在预览之上，渲染段锚定标注的标记 + 气泡
// 模型：claude-sonnet-4-6
// 段锚定：在 root 内找 [data-seg-id] 元素，叠加 .ann-marker 高亮该段
// rect 锚定：直接在 (x,y,w,h) 位置画框（用于 PDF 图像模式）
import { useEffect, useState } from 'react'
import type { Annotation } from './api'

interface Props {
  annotations: Annotation[]
  root: HTMLElement | null
  onResolve: (id: string) => void
  onDelete: (id: string) => void
}

interface Positioned {
  ann: Annotation
  rect: { left: number; top: number; width: number; height: number }
}

export function AnnotationLayer({ annotations, root, onResolve, onDelete }: Props) {
  const [positions, setPositions] = useState<Positioned[]>([])

  useEffect(() => {
    if (!root) { setPositions([]); return }
    const compute = () => {
      const rootRect = root.getBoundingClientRect()
      const items: Positioned[] = []
      for (const ann of annotations) {
        if (ann.anchor.type === 'rect' && ann.anchor.rect) {
          const { x, y, w, h } = ann.anchor.rect
          items.push({ ann, rect: { left: x, top: y, width: w, height: h } })
        } else if (ann.anchor.segId) {
          const el = root.querySelector(`[data-seg-id="${cssEscape(ann.anchor.segId)}"]`) as HTMLElement | null
          if (el) {
            const r = el.getBoundingClientRect()
            items.push({
              ann,
              rect: {
                left: r.left - rootRect.left,
                top: r.top - rootRect.top,
                width: r.width,
                height: r.height
              }
            })
          }
        }
      }
      setPositions(items)
    }
    compute()
    // DOM 变化（如 PDF 图片懒加载导致布局变化）时重算
    const mo = new MutationObserver(() => compute())
    mo.observe(root, { childList: true, subtree: true, attributes: true })
    window.addEventListener('resize', compute)
    return () => { mo.disconnect(); window.removeEventListener('resize', compute) }
  }, [annotations, root])

  return (
    <div className="annotation-layer">
      {positions.map(({ ann, rect }) => (
        <div
          key={ann.id}
          className={`ann-marker ${ann.status}`}
          style={{
            left: rect.left + 'px',
            top: rect.top + 'px',
            width: rect.width + 'px',
            height: rect.height + 'px'
          }}
          title={ann.body}
        >
          <div className="ann-bubble" style={{ left: rect.width / 2 + 'px' }}>
            <div className="ann-author" style={{ color: ann.color }}>{ann.userName}</div>
            <div>{ann.body}</div>
            {ann.status === 'open' && (
              <button className="btn-mini" onClick={() => onResolve(ann.id)}>解决</button>
            )}{' '}
            <button className="btn-mini" onClick={() => onDelete(ann.id)}>删除</button>
          </div>
        </div>
      ))}
    </div>
  )
}

function cssEscape(s: string): string {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s)
  return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&')
}
