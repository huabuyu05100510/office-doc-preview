// 标注 CRUD（真实落盘，非 mock）
// 模型：claude-sonnet-4-6
//
// 数据模型：
//   Annotation {
//     id, taskId, userId, userName, color,
//     anchor: { type: 'segment'|'rect', segId?, rect?: {x,y,w,h,page} },
//     body, status: 'open'|'resolved',
//     createdAt, updatedAt
//   }
//
// 存储：.data/annotations/<taskId>.json（单文件，全量重写）
// 可观测：[annotate] 日志 + annotationStats()
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { CONFIG } from './config.mjs'

// taskId → annotations[]
const cache = new Map()
// taskId → writeTimer
const writeTimers = new Map()

function dirFor() {
  if (process.env.ANNOTATIONS_DIR_OVERRIDE) return process.env.ANNOTATIONS_DIR_OVERRIDE
  const dir = path.join(CONFIG.DATA_DIR, 'annotations')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function fileFor(taskId) {
  // 防路径穿越
  const safe = String(taskId).replace(/[^a-zA-Z0-9_-]/g, '')
  return path.join(dirFor(), `${safe}.json`)
}

function load(taskId) {
  if (cache.has(taskId)) return cache.get(taskId)
  const file = fileFor(taskId)
  let list = []
  if (fs.existsSync(file)) {
    try { list = JSON.parse(fs.readFileSync(file, 'utf-8')) } catch { list = [] }
  }
  cache.set(taskId, list)
  return list
}

function persist(taskId) {
  // 防抖落盘
  if (writeTimers.has(taskId)) clearTimeout(writeTimers.get(taskId))
  const t = setTimeout(() => {
    const list = cache.get(taskId) || []
    fs.writeFileSync(fileFor(taskId), JSON.stringify(list, null, 2), 'utf-8')
    writeTimers.delete(taskId)
  }, 150)
  writeTimers.set(taskId, t)
}

function annId() {
  return 'ann_' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex')
}

/**
 * 创建标注
 * @param {string} taskId
 * @param {{anchor:object, body:string, userId:string, userName:string, color:string}} input
 */
export function createAnnotation(taskId, input) {
  const list = load(taskId)
  const now = Date.now()
  const ann = {
    id: annId(),
    taskId,
    userId: input.userId,
    userName: input.userName,
    color: input.color,
    anchor: input.anchor,
    body: input.body,
    status: 'open',
    createdAt: now,
    updatedAt: now
  }
  list.push(ann)
  persist(taskId)
  console.log(`[annotate] create ${ann.id} | task=${taskId} user=${ann.userName} anchor=${ann.anchor.type}`)
  return ann
}

export function listAnnotations(taskId) {
  return load(taskId)
}

export function getAnnotation(taskId, id) {
  const list = load(taskId)
  return list.find(a => a.id === id) || null
}

export function updateAnnotation(taskId, id, patch) {
  const list = load(taskId)
  const idx = list.findIndex(a => a.id === id)
  if (idx < 0) return null
  const updated = { ...list[idx], ...patch, updatedAt: Date.now() }
  list[idx] = updated
  persist(taskId)
  console.log(`[annotate] update ${id} | task=${taskId} patch=${JSON.stringify(Object.keys(patch))}`)
  return updated
}

export function deleteAnnotation(taskId, id) {
  const list = load(taskId)
  const before = list.length
  const next = list.filter(a => a.id !== id)
  if (next.length === before) return false
  cache.set(taskId, next)
  persist(taskId)
  console.log(`[annotate] delete ${id} | task=${taskId}`)
  return true
}

/**
 * 可观测：单 task 标注统计
 */
export function annotationStats(taskId) {
  const list = load(taskId)
  let open = 0, resolved = 0
  for (const a of list) {
    if (a.status === 'resolved') resolved++
    else open++
  }
  return { total: list.length, open, resolved }
}

/**
 * 测试专用：清空进程内 cache（磁盘文件不动）
 */
export function _resetCacheForTests() {
  cache.clear()
  for (const t of writeTimers.values()) clearTimeout(t)
  writeTimers.clear()
}
