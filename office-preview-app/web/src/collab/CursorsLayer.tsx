// CursorsLayer：远端用户当前段（hover）位置指示
// 模型：claude-sonnet-4-6
import { useEffect, useState } from 'react'
import { useCollab } from './useCollab'

interface Props { root: HTMLElement | null }

interface Positioned { userId: string; userName: string; color: string; segId: string; left: number; top: number }

export function CursorsLayer({ root }: Props) {
  const { highlight } = useCollab()
  const [positions, setPositions] = useState<Positioned[]>([])

  useEffect(() => {
    if (!root) { setPositions([]); return }
    const compute = () => {
      const rootRect = root.getBoundingClientRect()
      const items: Positioned[] = []
      for (const { userId, segId, color } of Object.values(highlight) as any[]) {
        const el = root.querySelector(`[data-seg-id="${cssEscape(segId)}"]`) as HTMLElement | null
        if (el) {
          const r = el.getBoundingClientRect()
          items.push({ userId, userName: '', color, segId, left: r.left - rootRect.left + r.width - 2, top: r.top - rootRect.top })
        }
      }
      setPositions(items)
    }
    compute()
  }, [highlight, root])

  return (
    <div className="annotation-layer">
      {positions.map(p => (
        <div
          key={p.userId}
          className="collab-cursor"
          style={{ left: p.left + 'px', top: p.top + 'px', height: 20, background: p.color }}
        >
          <span className="collab-cursor-label" style={{ background: p.color }}>{p.userName || p.userId.slice(-4)}</span>
        </div>
      ))}
    </div>
  )
}

function cssEscape(s: string): string {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s)
  return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&')
}
