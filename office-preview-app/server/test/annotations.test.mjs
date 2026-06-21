// annotations.mjs 测试
// 模型：claude-sonnet-4-6
// 覆盖：CRUD / segment+rect 双锚 / 落盘 / 按 taskId 隔离 / status 切换
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const TMP_ROOT = path.join(os.tmpdir(), 'anno-test-' + Date.now())
process.env.ANNOTATIONS_DIR_OVERRIDE = path.join(TMP_ROOT, 'annotations')

let ann

beforeAll(async () => {
  fs.mkdirSync(path.join(TMP_ROOT, 'annotations'), { recursive: true })
  ann = await import('../src/annotations.mjs')
})

afterAll(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true })
})

beforeEach(() => {
  const dir = path.join(TMP_ROOT, 'annotations')
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f))
  }
  ann._resetCacheForTests()
})

describe('createAnnotation', () => {
  it('segment 锚定 → 落盘并返回完整对象', () => {
    const a = ann.createAnnotation('t1', {
      anchor: { type: 'segment', segId: 's0' },
      body: '漏译',
      userId: 'u1', userName: 'Alice', color: '#f00'
    })
    expect(a.id).toMatch(/^ann_/)
    expect(a.taskId).toBe('t1')
    expect(a.anchor.segId).toBe('s0')
    expect(a.status).toBe('open')
    expect(a.createdAt).toBe(a.updatedAt)
  })

  it('rect 锚定 → 保存像素坐标', () => {
    const a = ann.createAnnotation('t1', {
      anchor: { type: 'rect', rect: { x: 10, y: 20, w: 100, h: 30, page: 1 } },
      body: '术语',
      userId: 'u1', userName: 'A', color: '#00f'
    })
    expect(a.anchor.rect.page).toBe(1)
    expect(a.anchor.rect.w).toBe(100)
  })
})

describe('listAnnotations', () => {
  it('按 taskId 隔离（不同 task 互不干扰）', () => {
    ann.createAnnotation('tA', { anchor: { type: 'segment', segId: 's0' }, body: 'a', userId: 'u', userName: 'u', color: '#000' })
    ann.createAnnotation('tB', { anchor: { type: 'segment', segId: 's0' }, body: 'b', userId: 'u', userName: 'u', color: '#000' })
    expect(ann.listAnnotations('tA')).toHaveLength(1)
    expect(ann.listAnnotations('tB')).toHaveLength(1)
    expect(ann.listAnnotations('tA')[0].body).toBe('a')
  })
})

describe('updateAnnotation', () => {
  it('改 body / status 同步 updatedAt', async () => {
    const a = ann.createAnnotation('t1', { anchor: { type: 'segment', segId: 's0' }, body: 'x', userId: 'u', userName: 'u', color: '#000' })
    await new Promise(r => setTimeout(r, 5))
    const u = ann.updateAnnotation('t1', a.id, { body: 'y', status: 'resolved' })
    expect(u.body).toBe('y')
    expect(u.status).toBe('resolved')
    expect(u.updatedAt).toBeGreaterThan(a.updatedAt)
  })

  it('不存在返回 null', () => {
    expect(ann.updateAnnotation('t1', 'ann_xxx', { body: 'z' })).toBeNull()
  })
})

describe('deleteAnnotation', () => {
  it('删除后 listAnnotations 不再返回', () => {
    const a = ann.createAnnotation('t1', { anchor: { type: 'segment', segId: 's0' }, body: 'x', userId: 'u', userName: 'u', color: '#000' })
    expect(ann.deleteAnnotation('t1', a.id)).toBe(true)
    expect(ann.listAnnotations('t1')).toHaveLength(0)
  })

  it('不存在返回 false', () => {
    expect(ann.deleteAnnotation('t1', 'ann_xxx')).toBe(false)
  })
})

describe('annotationStats (可观测)', () => {
  it('返回总数 / open 数 / resolved 数', () => {
    const a1 = ann.createAnnotation('t1', { anchor: { type: 'segment', segId: 's0' }, body: 'x', userId: 'u', userName: 'u', color: '#000' })
    ann.createAnnotation('t1', { anchor: { type: 'segment', segId: 's1' }, body: 'y', userId: 'u', userName: 'u', color: '#000' })
    ann.updateAnnotation('t1', a1.id, { status: 'resolved' })
    const s = ann.annotationStats('t1')
    expect(s.total).toBe(2)
    expect(s.open).toBe(1)
    expect(s.resolved).toBe(1)
  })
})
