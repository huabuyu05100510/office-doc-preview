// align.mjs 测试
// 模型：claude-sonnet-4-6
// 覆盖：mock 1:1 配对 / unmatched / 落盘缓存 / 重取 / 版本号
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const TMP_ROOT = path.join(os.tmpdir(), 'align-test-' + Date.now())
process.env.ALIGNMENTS_DIR_OVERRIDE = path.join(TMP_ROOT, 'alignments')

let align, CONFIG

beforeAll(async () => {
  fs.mkdirSync(path.join(TMP_ROOT, 'alignments'), { recursive: true })
  align = await import('../src/align.mjs')
  ;({ CONFIG } = await import('../src/config.mjs'))
})

afterAll(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true })
})

beforeEach(() => {
  // 清空 alignments 目录，避免用例间污染
  const dir = path.join(TMP_ROOT, 'alignments')
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f))
  }
})

describe('alignSegments (mock v1)', () => {
  it('按段索引 1:1 配对，score 固定 0.92', () => {
    const src = [{ id: 's0', text: 'a' }, { id: 's1', text: 'b' }]
    const tgt = [{ id: 't0', text: 'A' }, { id: 't1', text: 'B' }]
    const r = align.alignSegments(src, tgt)
    expect(r.pairs).toHaveLength(2)
    expect(r.pairs[0]).toEqual({ src: 's0', tgt: 't0', score: 0.92 })
    expect(r.pairs[1]).toEqual({ src: 's1', tgt: 't1', score: 0.92 })
  })

  it('源段更多 → 多出来的标 unmatched', () => {
    const src = [{ id: 's0' }, { id: 's1' }, { id: 's2' }]
    const tgt = [{ id: 't0' }]
    const r = align.alignSegments(src, tgt)
    expect(r.pairs).toHaveLength(1)
    // min=1，s0 配 t0，s1 s2 unmatched
    expect(r.unmatched.src.sort()).toEqual(['s1', 's2'])
    expect(r.unmatched.tgt).toEqual([])
  })

  it('译段更多 → 多出来的标 unmatched', () => {
    const src = [{ id: 's0' }]
    const tgt = [{ id: 't0' }, { id: 't1' }, { id: 't2' }]
    const r = align.alignSegments(src, tgt)
    expect(r.pairs).toHaveLength(1)
    expect(r.unmatched.tgt.sort()).toEqual(['t1', 't2'])
  })

  it('空输入返回空 pairs', () => {
    const r = align.alignSegments([], [])
    expect(r.pairs).toEqual([])
    expect(r.unmatched.src).toEqual([])
    expect(r.unmatched.tgt).toEqual([])
  })

  it('stats 含命中数 / 平均置信度 / 算法版本', () => {
    const r = align.alignSegments(
      [{ id: 's0' }, { id: 's1' }],
      [{ id: 't0' }, { id: 't1' }]
    )
    expect(r.stats.algorithm).toBe('mock-v1')
    expect(r.stats.matched).toBe(2)
    expect(r.stats.scoreAvg).toBeCloseTo(0.92, 2)
  })
})

describe('createAlignment / getAlignment (落盘缓存)', () => {
  it('createAlignment 返回 id 且落盘到 .data/alignments/<id>.json', () => {
    const r = align.createAlignment({
      srcTaskId: 't_src1', tgtTaskId: 't_tgt1',
      srcSegs: [{ id: 's0', text: 'a' }],
      tgtSegs: [{ id: 't0', text: 'A' }]
    })
    expect(r.id).toMatch(/^align_/)
    expect(r.pairs).toHaveLength(1)
    const file = path.join(TMP_ROOT, 'alignments', r.id + '.json')
    expect(fs.existsSync(file)).toBe(true)
    const persisted = JSON.parse(fs.readFileSync(file, 'utf-8'))
    expect(persisted.srcTaskId).toBe('t_src1')
    expect(persisted.tgtTaskId).toBe('t_tgt1')
  })

  it('getAlignment 按 id 重取', () => {
    const created = align.createAlignment({
      srcTaskId: 't_src2', tgtTaskId: 't_tgt2',
      srcSegs: [{ id: 's0' }, { id: 's1' }],
      tgtSegs: [{ id: 't0' }]
    })
    const got = align.getAlignment(created.id)
    expect(got).toBeTruthy()
    expect(got.pairs).toHaveLength(1)
    expect(got.unmatched.src).toEqual(['s1'])
  })

  it('getAlignment 不存在返回 null', () => {
    expect(align.getAlignment('align_nonexistent')).toBeNull()
  })
})

describe('alignStats (可观测)', () => {
  it('返回当前缓存的对齐数 / 总命中段', () => {
    align.createAlignment({
      srcTaskId: 'a1', tgtTaskId: 'a2',
      srcSegs: [{ id: 's0' }, { id: 's1' }],
      tgtSegs: [{ id: 't0' }, { id: 't1' }]
    })
    const s = align.alignStats()
    expect(s.total).toBeGreaterThanOrEqual(1)
    expect(s.algorithm).toBe('mock-v1')
  })
})
