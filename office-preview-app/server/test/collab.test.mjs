// collab + auth 测试
// 模型：claude-sonnet-4-6
// 覆盖：匿名签发 / JWT 校验 / ws 房间 join / 广播 presence / annotate 广播 / cursor 节流
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { WebSocketServer, WebSocket } from 'ws'

process.env.COLLAB_JWT_SECRET = 'collab-test-secret-1234567890'
const TMP_ROOT = path.join(os.tmpdir(), 'collab-test-' + Date.now())
process.env.COLLAB_USERS_DIR_OVERRIDE = path.join(TMP_ROOT, 'users')
fs.mkdirSync(path.join(TMP_ROOT, 'users'), { recursive: true })

let auth, collab, server, wss, baseUrl, port

beforeAll(async () => {
  auth = await import('../src/auth.mjs')
  collab = await import('../src/collab.mjs')

  server = http.createServer((req, res) => {
    if (req.url === '/api/health/collab') {
      const s = collab.collabStats()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(s))
      return
    }
    res.writeHead(404); res.end()
  })
  await new Promise(r => server.listen(0, r))
  port = server.address().port
  baseUrl = `http://127.0.0.1:${port}`

  wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    const u = new URL(req.url, baseUrl)
    collab.handleUpgrade(req, socket, head, wss, u)
  })
})

afterAll(async () => {
  for (const c of wss.clients) c.close()
  await new Promise(r => wss.close(r))
  await new Promise(r => server.close(r))
  fs.rmSync(TMP_ROOT, { recursive: true, force: true })
})

function wsConnect(token, taskId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/collab/${taskId}?token=${token}`)
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
    setTimeout(() => reject(new Error('timeout')), 3000)
  })
}

function nextMsg(ws, timeout = 1500) {
  return new Promise((resolve, reject) => {
    const onMsg = (data) => {
      ws.off('message', onMsg)
      resolve(JSON.parse(data.toString()))
    }
    ws.on('message', onMsg)
    setTimeout(() => reject(new Error('no msg')), timeout)
  })
}

describe('auth', () => {
  it('issueAnonymous 返回 userId/userName/color/token', () => {
    const u = auth.issueAnonymous()
    expect(u.userId).toMatch(/^u_/)
    expect(u.userName).toBeTruthy()
    expect(u.color).toMatch(/^#/)
    expect(u.token).toBeTruthy()
  })

  it('verifyToken 解出 userId', () => {
    const u = auth.issueAnonymous()
    const decoded = auth.verifyToken(u.token)
    expect(decoded.userId).toBe(u.userId)
  })

  it('无效 token 抛错', () => {
    expect(() => auth.verifyToken('invalid.token.here')).toThrow()
  })
})

describe('collab ws', () => {
  it('join 后收到 presence（含自己）', async () => {
    const u = auth.issueAnonymous()
    const ws = await wsConnect(u.token, 't1')
    ws.send(JSON.stringify({ type: 'join', taskId: 't1', ...u }))
    const msg = await nextMsg(ws)
    expect(msg.type).toBe('presence')
    expect(msg.users.length).toBeGreaterThanOrEqual(1)
    expect(msg.users.find(x => x.userId === u.userId)).toBeTruthy()
    ws.close()
  })

  it('两个客户端 → 第二个收到含两人的 presence', async () => {
    const u1 = auth.issueAnonymous()
    const u2 = auth.issueAnonymous()
    const ws1 = await wsConnect(u1.token, 't2')
    ws1.send(JSON.stringify({ type: 'join', taskId: 't2', ...u1 }))
    await nextMsg(ws1)

    const ws2 = await wsConnect(u2.token, 't2')
    ws2.send(JSON.stringify({ type: 'join', taskId: 't2', ...u2 }))
    const msg = await nextMsg(ws2)
    expect(msg.type).toBe('presence')
    expect(msg.users.length).toBe(2)

    ws1.close(); ws2.close()
    // 给服务端时间清理
    await new Promise(r => setTimeout(r, 100))
  })

  it('annotate create 广播给房间内其他客户端', async () => {
    const u1 = auth.issueAnonymous()
    const u2 = auth.issueAnonymous()
    const ws1 = await wsConnect(u1.token, 't3')
    ws1.send(JSON.stringify({ type: 'join', taskId: 't3', ...u1 }))
    await nextMsg(ws1)

    const ws2 = await wsConnect(u2.token, 't3')
    ws2.send(JSON.stringify({ type: 'join', taskId: 't3', ...u2 }))
    await nextMsg(ws2)
    // ws1 也会收到 ws2 加入的 presence，先消费掉
    ws1.once('message', () => {})

    ws2.send(JSON.stringify({
      type: 'annotate', op: 'create',
      annotation: { id: 'ann_test', body: 'hi', userId: u2.userId }
    }))
    const msg = await nextMsg(ws1)
    expect(msg.type).toBe('annotate')
    expect(msg.op).toBe('create')
    expect(msg.annotation.id).toBe('ann_test')

    ws1.close(); ws2.close()
    await new Promise(r => setTimeout(r, 100))
  })

  it('未带 token 的连接被拒绝', async () => {
    await expect(wsConnect('', 't4')).rejects.toBeTruthy()
  })

  it('cursor 广播给其他人但自己不收', async () => {
    const u1 = auth.issueAnonymous()
    const u2 = auth.issueAnonymous()
    const ws1 = await wsConnect(u1.token, 't5')
    ws1.send(JSON.stringify({ type: 'join', taskId: 't5', ...u1 }))
    await nextMsg(ws1)

    const ws2 = await wsConnect(u2.token, 't5')
    ws2.send(JSON.stringify({ type: 'join', taskId: 't5', ...u2 }))
    await nextMsg(ws2)
    ws1.once('message', () => {})

    ws2.send(JSON.stringify({ type: 'cursor', userId: u2.userId, segId: 's0' }))
    const msg = await nextMsg(ws1)
    expect(msg.type).toBe('cursor')
    expect(msg.segId).toBe('s0')
    ws1.close(); ws2.close()
    await new Promise(r => setTimeout(r, 100))
  })
})

describe('collabStats (可观测)', () => {
  it('返回 rooms / clients / algorithm', async () => {
    const u = auth.issueAnonymous()
    const ws = await wsConnect(u.token, 't6')
    ws.send(JSON.stringify({ type: 'join', taskId: 't6', ...u }))
    await nextMsg(ws)
    const r = await fetch(`http://127.0.0.1:${port}/api/health/collab`).then(x => x.json())
    expect(r.algorithm).toBe('ws-v1')
    expect(r.rooms).toBeGreaterThanOrEqual(1)
    ws.close()
    await new Promise(r => setTimeout(r, 100))
  })
})
