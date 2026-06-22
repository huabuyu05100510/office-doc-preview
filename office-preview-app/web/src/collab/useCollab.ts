// useCollab：WebSocket 协作 store
// 模型：claude-sonnet-4-6
//
// 功能：
//   - 首次进入协作：POST /api/auth/anonymous 拿身份 + JWT，localStorage 缓存
//   - 连 ws /collab/<taskId>?token=<jwt>，发 join
//   - 接收 presence / annotate / cursor / scroll / highlight 广播
//   - 暴露 send* 给上层调用
import { create } from 'zustand'
import { usePerf } from '../perf'

export interface CollabUser {
  userId: string
  userName: string
  color: string
}
export interface CollabCursor { userId: string; segId: string; color: string }

interface Identity extends CollabUser { token: string }

interface CollabState {
  identity: Identity | null
  users: CollabUser[]
  ws: WebSocket | null
  online: boolean
  // 远端光标：userId → segId
  cursors: Record<string, CollabCursor>
  // 远端高亮（hover）
  highlight: Record<string, CollabCursor>

  init: (taskId: string) => Promise<void>
  close: () => void
  sendAnnotate: (op: string, annotation: any) => void
  sendCursor: (segId: string) => void
  sendHighlight: (segId: string) => void
  sendScroll: (segId: string) => void
  // 远端事件回调（用 ref，不进 store state，避免触发重渲染）
  setHandlers: (h: Partial<RemoteHandlers>) => void
  getHandlers: () => RemoteHandlers
}

interface RemoteHandlers {
  onRemoteAnnotation: ((ann: any, op: string) => void) | null
  onRemoteHighlight: ((segId: string, color: string) => void) | null
  onRemoteScroll: ((segId: string, color: string) => void) | null
}

// 进程内 ref：避免 zustand state 变更引发 CompareView 重渲染
const handlersRef: RemoteHandlers = {
  onRemoteAnnotation: null,
  onRemoteHighlight: null,
  onRemoteScroll: null
}

const LS_KEY = 'collabIdentity'

function loadIdentity(): Identity | null {
  try {
    const s = localStorage.getItem(LS_KEY)
    if (!s) return null
    return JSON.parse(s)
  } catch { return null }
}

function saveIdentity(id: Identity | null) {
  try {
    if (id) localStorage.setItem(LS_KEY, JSON.stringify(id))
    else localStorage.removeItem(LS_KEY)
  } catch {}
}

async function ensureIdentity(): Promise<Identity> {
  const cached = loadIdentity()
  if (cached) return cached
  const r = await fetch('/api/auth/anonymous', { method: 'POST' })
  if (!r.ok) throw new Error('auth failed')
  const id = await r.json()
  const identity = { userId: id.userId, userName: id.userName, color: id.color, token: id.token }
  saveIdentity(identity)
  return identity
}

function wsUrl(taskId: string, token: string): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}/collab/${taskId}?token=${encodeURIComponent(token)}`
}

export const useCollab = create<CollabState>((set, get) => ({
  identity: null,
  users: [],
  ws: null,
  online: false,
  cursors: {},
  highlight: {},

  async init(taskId) {
    // 已连同一 task 跳过
    const prev = get().ws
    if (prev && prev.readyState === WebSocket.OPEN && (prev as any).__taskId === taskId) return
    if (prev) prev.close()

    let identity
    try {
      identity = await ensureIdentity()
      set({ identity })
    } catch (e) {
      console.warn('[collab] ensureIdentity failed', e)
      return
    }

    const ws = new WebSocket(wsUrl(taskId, identity.token))
    ;(ws as any).__taskId = taskId
    ws.onopen = () => {
      console.log(`[collab] connected task=${taskId} user=${identity.userId}`)
      set({ online: true })
      ws.send(JSON.stringify({ type: 'join', taskId, ...identity }))
    }
    ws.onclose = () => {
      console.log('[collab] disconnected')
      set({ online: false, users: [], cursors: {}, highlight: {} })
    }
    ws.onerror = (e) => console.warn('[collab] ws error', e)
    ws.onmessage = (e) => {
      let msg
      try { msg = JSON.parse(e.data) } catch { return }
      const state = get()
      switch (msg.type) {
        case 'presence':
          set({ users: msg.users || [] })
          usePerf.getState().set({ collabOnline: (msg.users || []).length })
          break
        case 'annotate':
          handlersRef.onRemoteAnnotation?.(msg.annotation, msg.op)
          break
        case 'cursor':
          set({ cursors: { ...state.cursors, [msg.userId]: { userId: msg.userId, segId: msg.segId, color: msg.color } } })
          break
        case 'highlight':
          // hover 是瞬时态，2s 后过期
          set({ highlight: { ...state.highlight, [msg.userId]: { userId: msg.userId, segId: msg.segId, color: msg.color } } })
          handlersRef.onRemoteHighlight?.(msg.segId, msg.color)
          setTimeout(() => {
            const cur = get().highlight
            if (cur[msg.userId]?.segId === msg.segId) {
              const next = { ...cur }; delete next[msg.userId]
              set({ highlight: next })
            }
          }, 2000)
          break
        case 'scroll':
          handlersRef.onRemoteScroll?.(msg.segId, msg.color)
          break
      }
    }
    set({ ws })
  },

  close() {
    const ws = get().ws
    if (ws) ws.close()
    set({ ws: null, online: false, users: [], cursors: {}, highlight: {} })
  },

  sendAnnotate(op, annotation) {
    get().ws?.send(JSON.stringify({ type: 'annotate', op, annotation }))
  },
  sendCursor(segId) {
    get().ws?.send(JSON.stringify({ type: 'cursor', userId: get().identity?.userId, segId }))
  },
  sendHighlight(segId) {
    get().ws?.send(JSON.stringify({ type: 'highlight', userId: get().identity?.userId, segId }))
  },
  sendScroll(segId) {
    get().ws?.send(JSON.stringify({ type: 'scroll', userId: get().identity?.userId, segId }))
  },

  setHandlers(h) {
    if (h.onRemoteAnnotation !== undefined) handlersRef.onRemoteAnnotation = h.onRemoteAnnotation
    if (h.onRemoteHighlight !== undefined) handlersRef.onRemoteHighlight = h.onRemoteHighlight
    if (h.onRemoteScroll !== undefined) handlersRef.onRemoteScroll = h.onRemoteScroll
  },

  getHandlers() {
    return handlersRef
  }
}))
