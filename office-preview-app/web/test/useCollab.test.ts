// useCollab.test.ts
// 模型：claude-sonnet-4-6
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock WebSocket
class MockWS {
  static instances: MockWS[] = []
  static LAST: MockWS | null = null
  url: string
  readyState = 0
  onopen: ((ev: any) => void) | null = null
  onclose: (() => void) | null = null
  onerror: ((e: any) => void) | null = null
  onmessage: ((e: any) => void) | null = null
  sent: any[] = []
  constructor(url: string) {
    this.url = url
    MockWS.instances.push(this)
    MockWS.LAST = this
    setTimeout(() => { this.readyState = 1; this.onopen?.({}) }, 0)
  }
  send(data: string) { this.sent.push(JSON.parse(data)) }
  close() { this.readyState = 3; this.onclose?.() }
  emit(msg: any) { this.onmessage?.({ data: JSON.stringify(msg) }) }
}

let originalWS: any
beforeEach(() => {
  originalWS = (global as any).WebSocket
  ;(global as any).WebSocket = MockWS
  MockWS.instances = []
  MockWS.LAST = null
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, json: async () => ({ userId: 'u1', userName: '蓝鲸', color: '#5b8', token: 'tok' })
  } as any)))
  localStorage.clear()
})
afterEach(() => {
  ;(global as any).WebSocket = originalWS
  vi.restoreAllMocks()
})

describe('useCollab', () => {
  it('init → fetch 身份 → 连 ws → 发 join', async () => {
    const { useCollab } = await import('../src/collab/useCollab')
    await useCollab.getState().init('task1')
    // 等异步 ws onopen
    await new Promise(r => setTimeout(r, 10))
    expect(MockWS.LAST).toBeTruthy()
    expect(MockWS.LAST!.url).toContain('/collab/task1')
    expect(MockWS.LAST!.url).toContain('token=')
    expect(MockWS.LAST!.sent.some(m => m.type === 'join')).toBe(true)
    expect(useCollab.getState().identity?.userId).toBe('u1')
    expect(useCollab.getState().online).toBe(true)
    useCollab.getState().close()
  })

  it('presence 消息更新 users', async () => {
    const { useCollab } = await import('../src/collab/useCollab')
    await useCollab.getState().init('task2')
    await new Promise(r => setTimeout(r, 10))
    MockWS.LAST!.emit({ type: 'presence', users: [{ userId: 'a', userName: 'A', color: '#f00' }] })
    expect(useCollab.getState().users).toHaveLength(1)
    useCollab.getState().close()
  })

  it('annotate 消息触发 onRemoteAnnotation 回调', async () => {
    const { useCollab } = await import('../src/collab/useCollab')
    const handler = vi.fn()
    await useCollab.getState().init('task3')
    useCollab.getState().setHandlers({ onRemoteAnnotation: handler })
    await new Promise(r => setTimeout(r, 10))
    MockWS.LAST!.emit({ type: 'annotate', op: 'create', annotation: { id: 'a1', body: 'hi' } })
    expect(handler).toHaveBeenCalledWith({ id: 'a1', body: 'hi' }, 'create')
    useCollab.getState().close()
  })

  it('sendCursor 发出 cursor 帧', async () => {
    const { useCollab } = await import('../src/collab/useCollab')
    await useCollab.getState().init('task4')
    await new Promise(r => setTimeout(r, 10))
    MockWS.LAST!.sent = []
    useCollab.getState().sendCursor('seg-3')
    expect(MockWS.LAST!.sent.some(m => m.type === 'cursor' && m.segId === 'seg-3')).toBe(true)
    useCollab.getState().close()
  })
})
