// 翻译对齐（mock v1）
// 模型：claude-sonnet-4-6
//
// 设计：
//   - 前端拥有 DOM 段（PDF text-layer span / DOCX <p>），生成 segId 列表传给后端
//   - 后端只负责「配对」：v1 mock = 按段索引 1:1，score 固定 0.92
//   - v2 增量位：alignSegments 签名不变，内部换 Gale-Church DP + simhash
//
// 落盘：.data/alignments/<id>.json，可重取
// 可观测：[align] 日志 + alignStats() + /api/health/align
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { CONFIG } from './config.mjs'

const ALGO_VERSION = 'mock-v1'
const MOCK_SCORE = 0.92

function alignmentsDir() {
  // 测试可 override
  if (process.env.ALIGNMENTS_DIR_OVERRIDE) return process.env.ALIGNMENTS_DIR_OVERRIDE
  const dir = path.join(CONFIG.DATA_DIR, 'alignments')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function uid() {
  return 'align_' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex')
}

/**
 * mock v1 配对算法：按段索引 1:1，min(n,m) 配对，多余段进 unmatched
 * @param {Array<{id:string,text?:string}>} srcSegs
 * @param {Array<{id:string,text?:string}>} tgtSegs
 * @returns {{ pairs: Array<{src,tgt,score}>, unmatched: {src:string[],tgt:string[]}, stats }}
 */
export function alignSegments(srcSegs, tgtSegs) {
  const n = Math.min(srcSegs.length, tgtSegs.length)
  const pairs = []
  for (let i = 0; i < n; i++) {
    pairs.push({ src: srcSegs[i].id, tgt: tgtSegs[i].id, score: MOCK_SCORE })
  }
  const unmatched = {
    src: srcSegs.slice(n).map(s => s.id),
    tgt: tgtSegs.slice(n).map(s => s.id)
  }
  const stats = {
    algorithm: ALGO_VERSION,
    matched: pairs.length,
    srcTotal: srcSegs.length,
    tgtTotal: tgtSegs.length,
    scoreAvg: pairs.length ? MOCK_SCORE : 0
  }
  return { pairs, unmatched, stats }
}

/**
 * 创建并落盘一份对齐结果
 * @param {{srcTaskId:string,tgtTaskId:string,srcSegs:Array,tgtSegs:Array,granularity?:string}} input
 */
export function createAlignment({ srcTaskId, tgtTaskId, srcSegs, tgtSegs, granularity = 'para' }) {
  const { pairs, unmatched, stats } = alignSegments(srcSegs, tgtSegs)
  const id = uid()
  const now = Date.now()
  const record = {
    id,
    srcTaskId,
    tgtTaskId,
    granularity,
    pairs,
    unmatched,
    stats,
    createdAt: now
  }
  const file = path.join(alignmentsDir(), id + '.json')
  fs.writeFileSync(file, JSON.stringify(record, null, 2), 'utf-8')
  console.log(`[align] created ${id} | src=${srcTaskId}(${srcSegs.length}段) tgt=${tgtTaskId}(${tgtSegs.length}段) matched=${pairs.length}`)
  return record
}

/**
 * 按 id 重取对齐结果
 * @param {string} id
 * @returns {object|null}
 */
export function getAlignment(id) {
  const file = path.join(alignmentsDir(), id + '.json')
  if (!fs.existsSync(file)) {
    console.warn(`[align] getAlignment not found: ${id}`)
    return null
  }
  return JSON.parse(fs.readFileSync(file, 'utf-8'))
}

/**
 * 可观测：当前对齐缓存统计
 */
export function alignStats() {
  const dir = alignmentsDir()
  if (!fs.existsSync(dir)) {
    return { total: 0, algorithm: ALGO_VERSION }
  }
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
  let matched = 0
  for (const f of files) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'))
      matched += (r.stats?.matched || 0)
    } catch {}
  }
  return { total: files.length, matched, algorithm: ALGO_VERSION }
}
