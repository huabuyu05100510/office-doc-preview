// PresenceBar：在线用户头像列表
// 模型：claude-sonnet-4-6
import { useCollab } from './useCollab'

export function PresenceBar() {
  const { users, identity, online } = useCollab()
  if (!online) return null
  const others = users.filter(u => u.userId !== identity?.userId)
  return (
    <div className="presence-bar">
      {others.map(u => (
        <span
          key={u.userId}
          className="presence-avatar"
          style={{ background: u.color }}
          title={`${u.userName}（在线）`}
        >
          {u.userName.slice(0, 1)}
        </span>
      ))}
      {identity && (
        <span
          className="presence-avatar"
          style={{ background: identity.color, borderStyle: 'dashed' }}
          title={`${identity.userName}（我）`}
        >
          我
        </span>
      )}
    </div>
  )
}
