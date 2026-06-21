// WebSocket 协作 hub（真实实现）
// 模型：claude-sonnet-4-6
//
// 房间 = task:<taskId>，按 taskId 分流
// 协议（JSON 帧）：
//   client → server:  { type:'join', taskId, userId, userName, color }
//                     { type:'annotate', op:'create'|'update'|'delete', annotation }
//                     { type:'cursor', userId, segId }
//                     { type:'scroll', userId, segId }
//                     { type:'highlight', userId, segId }
//                     { type:'leave' }
//   server → client:  { type:'presence', users:[...] }
//                     { type:'annotate', op, annotation }
//                     { type:'cursor', userId, segId, color }
//                     { type:'scroll', userId, segId, color }
//                     { type:'highlight', userId, segId, color }
//
// 鉴权：URL ?token=<jwt>，verifyToken 解出 userId
// 可观测：[collab] 日志 + collabStats() + /api/health/collab
import { verifyToken } from './auth.mjs'

const ALGO_VERSION = 'ws-v1'

// taskId → Map(userId → { ws, userId, userName, color })
const rooms = new Map()

function roomOf(taskId) {
  if (!rooms.has(taskId)) rooms.set(taskId, new Map())
  return rooms.get(taskId)
}

function broadcast(taskId, msg, exceptWs = null) {
  const room = roomOf(taskId)
  const data = JSON.stringify(msg)
  for (const [, entry] of room) {
    if (entry.ws === exceptWs) continue
    if (entry.ws.readyState === 1 /* OPEN */) {
      entry.ws.send(data)
    }
  }
}

function sendPresence(taskId, ws) {
  const room = roomOf(taskId)
  const users = [...room.values()].map(e => ({
    userId: e.userId, userName: e.userName, color: e.color
  }))
  const data = JSON.stringify({ type: 'presence', users })
  if (ws) {
    if (ws.readyState === 1) ws.send(data)
  } else {
    broadcast(taskId, { type: 'presence', users })
  }
}

/**
 * 处理 HTTP server 的 upgrade 事件
 */
export function handleUpgrade(req, socket, head, wss, url) {
  const m = url.pathname.match(/^\/collab\/([\w-]+)$/)
  if (!m) {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
    socket.destroy()
    return
  }
  const taskId = m[1]
  const token = url.searchParams.get('token') || ''
  let identity
  try {
    identity = verifyToken(token)
  } catch (e) {
    console.warn(`[collab] auth failed: ${e.message}`)
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
    socket.destroy()
    return
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    const userId = identity.userId
    const entry = {
      ws,
      userId,
      userName: identity.userName,
      color: identity.color,
      taskId
    }
    roomOf(taskId).set(userId, entry)
    console.log(`[collab] join task=${taskId} user=${userId}(${identity.userName}) | room=${roomOf(taskId).size}`)

    // 通知自己当前 presence
    sendPresence(taskId, ws)
    // 通知房间其他人 presence 变化
    broadcast(taskId, { type: 'presence', users: [...roomOf(taskId).values()].map(e => ({ userId: e.userId, userName: e.userName, color: e.color })) }, ws)

    ws.on('message', (buf) => {
      let msg
      try { msg = JSON.parse(buf.toString()) } catch { return }
      handleMessage(taskId, entry, msg)
    })

    ws.on('close', () => {
      const room = roomOf(taskId)
      room.delete(userId)
      console.log(`[collab] leave task=${taskId} user=${userId} | room=${room.size}`)
      if (room.size === 0) {
        rooms.delete(taskId)
      } else {
        // 通知房间 presence 变化
        const users = [...room.values()].map(e => ({ userId: e.userId, userName: e.userName, color: e.color }))
        broadcast(taskId, { type: 'presence', users })
      }
    })
  })
}

function handleMessage(taskId, entry, msg) {
  const { ws, userId, color } = entry
  switch (msg.type) {
    case 'join':
      // 已在 upgrade 时入房，这里仅重发 presence
      sendPresence(taskId, ws)
      break
    case 'annotate':
      broadcast(taskId, { type: 'annotate', op: msg.op, annotation: msg.annotation, from: userId }, ws)
      break
    case 'cursor':
      broadcast(taskId, { type: 'cursor', userId, segId: msg.segId, color }, ws)
      break
    case 'scroll':
      broadcast(taskId, { type: 'scroll', userId, segId: msg.segId, color }, ws)
      break
    case 'highlight':
      broadcast(taskId, { type: 'highlight', userId, segId: msg.segId, color }, ws)
      break
    case 'leave':
      // 让 ws 主动关闭
      break
    default:
      console.warn(`[collab] unknown msg type: ${msg.type}`)
  }
}

/**
 * 可观测
 */
export function collabStats() {
  let clients = 0
  for (const room of rooms.values()) clients += room.size
  return {
    algorithm: ALGO_VERSION,
    rooms: rooms.size,
    clients
  }
}

/**
 * 测试/复位用
 */
export function _resetRoomsForTests() {
  rooms.clear()
}
