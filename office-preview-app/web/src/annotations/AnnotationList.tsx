// AnnotationList：右侧抽屉列表
// 模型：claude-sonnet-4-6
import type { Annotation } from './api'

interface Props {
  annotations: Annotation[]
  onPick: (ann: Annotation) => void
  onClose: () => void
}

export function AnnotationList({ annotations, onPick, onClose }: Props) {
  return (
    <div className="ann-list">
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <strong style={{ flex: 1 }}>标注 ({annotations.length})</strong>
        <button className="btn-mini" onClick={onClose}>收起 ✕</button>
      </div>
      {annotations.length === 0 ? (
        <div className="hint">尚无标注。拖选一段文字可添加批注。</div>
      ) : (
        annotations.map(a => (
          <div
            key={a.id}
            className={`ann-list-item ${a.status}`}
            onClick={() => onPick(a)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="presence-avatar" style={{ background: a.color }}>{a.userName.slice(0, 2)}</span>
              <span style={{ flex: 1, fontWeight: 600 }}>{a.userName}</span>
              <span className="chip">{a.status === 'open' ? '待处理' : '已解决'}</span>
            </div>
            <div style={{ margin: '4px 0' }}>{a.body}</div>
            <div className="hint" style={{ fontSize: 10 }}>
              {a.anchor.type === 'segment' ? `段：${a.anchor.segId}` : `页 ${a.anchor.rect?.page} 矩形`}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
