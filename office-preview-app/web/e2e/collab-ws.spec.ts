// collab-ws.spec.ts：WebSocket 协作真实链路（两 context 同时连）
// 模型：claude-sonnet-4-6
import { test, expect } from '@playwright/test'
import { WebSocket as WS } from 'ws'

const WS_URL = (taskId: string, token: string) =>
  `ws://localhost:5180/collab/${taskId}?token=${token}`

async function getIdentity(request: any) {
  const r = await request.post('http://localhost:5180/api/auth/anonymous')
  return r.json()
}

function openWs(url: string): Promise<WS> {
  return new Promise((resolve, reject) => {
    const ws = new WS(url)
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
    setTimeout(() => reject(new Error('timeout')), 5000)
  })
}

function nextMsg(ws: WS, timeout = 2000): Promise<any> {
  return new Promise((resolve, reject) => {
    const onMsg = (data: any) => {
      ws.off('message', onMsg)
      resolve(JSON.parse(data.toString()))
    }
    ws.on('message', onMsg)
    setTimeout(() => reject(new Error('no msg')), timeout)
  })
}

test.describe('WebSocket 协作', () => {
  test('两客户端进入同房间 → 第二个收到含两人的 presence', async ({ request }) => {
    const u1 = await getIdentity(request)
    const u2 = await getIdentity(request)
    const taskId = 'ws_room_' + Date.now()
    const ws1 = await openWs(WS_URL(taskId, u1.token))
    ws1.send(JSON.stringify({ type: 'join', taskId, ...u1 }))
    await nextMsg(ws1)  // 自己的 presence

    const ws2 = await openWs(WS_URL(taskId, u2.token))
    ws2.send(JSON.stringify({ type: 'join', taskId, ...u2 }))
    const msg = await nextMsg(ws2)
    expect(msg.type).toBe('presence')
    expect(msg.users.length).toBe(2)

    ws1.close(); ws2.close()
    await new Promise(r => setTimeout(r, 100))
  })

  test('一端发标注 create → 另一端收到 annotate 广播', async ({ request }) => {
    const u1 = await getIdentity(request)
    const u2 = await getIdentity(request)
    const taskId = 'ws_anno_' + Date.now()
    const ws1 = await openWs(WS_URL(taskId, u1.token))
    ws1.send(JSON.stringify({ type: 'join', taskId, ...u1 }))
    await nextMsg(ws1)
    const ws2 = await openWs(WS_URL(taskId, u2.token))
    ws2.send(JSON.stringify({ type: 'join', taskId, ...u2 }))
    await nextMsg(ws2)
    // ws1 会收到 ws2 加入的 presence，消费掉
    await nextMsg(ws1)

    ws2.send(JSON.stringify({
      type: 'annotate', op: 'create',
      annotation: { id: 'ann_ws_test', body: '协作批注', userId: u2.userId }
    }))
    const msg = await nextMsg(ws1)
    expect(msg.type).toBe('annotate')
    expect(msg.op).toBe('create')
    expect(msg.annotation.id).toBe('ann_ws_test')

    ws1.close(); ws2.close()
    await new Promise(r => setTimeout(r, 100))
  })

  test('未带 token 的连接被拒绝', async () => {
    await expect(openWs('ws://localhost:5180/collab/t_x?token=')).rejects.toBeTruthy()
  })
})
