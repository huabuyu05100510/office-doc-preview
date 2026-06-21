// compare-api.spec.ts：翻译对比 / 质检 / 标注 / 协作 REST 契约
// 模型：claude-sonnet-4-6
import { test, expect } from '@playwright/test'

const API = 'http://localhost:5180'

test.describe('翻译对比 REST API', () => {
  test('POST /api/align 返回 1:1 配对 + algorithm=mock-v1', async ({ request }) => {
    const r = await request.post(`${API}/api/align`, {
      data: {
        srcTaskId: 't_src', tgtTaskId: 't_tgt',
        srcSegs: [{ id: 's0', text: 'a' }, { id: 's1', text: 'b' }],
        tgtSegs: [{ id: 't0', text: 'A' }, { id: 't1', text: 'B' }]
      }
    })
    expect(r.ok()).toBeTruthy()
    const j = await r.json()
    expect(j.id).toMatch(/^align_/)
    expect(j.pairs).toHaveLength(2)
    expect(j.pairs[0]).toEqual({ src: 's0', tgt: 't0', score: 0.92 })
    expect(j.stats.algorithm).toBe('mock-v1')
  })

  test('GET /api/align/:id 重取', async ({ request }) => {
    const created = await (await request.post(`${API}/api/align`, {
      data: {
        srcTaskId: 'a', tgtTaskId: 'b',
        srcSegs: [{ id: 's0' }], tgtSegs: [{ id: 't0' }]
      }
    })).json()
    const r = await request.get(`${API}/api/align/${created.id}`)
    expect(r.ok()).toBeTruthy()
    const j = await r.json()
    expect(j.id).toBe(created.id)
  })

  test('GET /api/align/<不存在> → 404', async ({ request }) => {
    const r = await request.get(`${API}/api/align/align_nonexistent`, { failOnStatusCode: false })
    expect(r.status()).toBe(404)
  })

  test('GET /api/health/align 返回 algorithm', async ({ request }) => {
    const r = await request.get(`${API}/api/health/align`)
    expect(r.ok()).toBeTruthy()
    const j = await r.json()
    expect(j.algorithm).toBe('mock-v1')
  })
})

test.describe('质检 API', () => {
  test('GET /api/qa/:taskId?alignmentId=... 返回 7 类 issue', async ({ request }) => {
    // 先建一份有 8 段的 align
    const align = await (await request.post(`${API}/api/align`, {
      data: {
        srcTaskId: 's', tgtTaskId: 't_tgt',
        srcSegs: Array.from({ length: 8 }, (_, i) => ({ id: 's' + i, text: 'seg' + i })),
        tgtSegs: Array.from({ length: 8 }, (_, i) => ({ id: 't' + i, text: 'SEG' + i }))
      }
    })).json()
    const r = await request.get(`${API}/api/qa/t_tgt?alignmentId=${align.id}&against=s`)
    expect(r.ok()).toBeTruthy()
    const j = await r.json()
    const rules = new Set(j.issues.map((i: any) => i.rule))
    expect(rules.size).toBeGreaterThanOrEqual(7)
    expect(j.stats.algorithm).toBe('mock-v1')
  })

  test('POST /api/qa/:taskId/fix 返回建议文案', async ({ request }) => {
    const r = await request.post(`${API}/api/qa/t_tgt/fix`, {
      data: { issue: { id: 'qa_1', rule: 'whitespace', suggestion: 'trim 行尾空白' } }
    })
    expect(r.ok()).toBeTruthy()
    const j = await r.json()
    expect(j.ok).toBe(true)
    expect(j.appliedText).toContain('trim')
  })
})

test.describe('标注 CRUD API', () => {
  test('create → list → update → delete 闭环', async ({ request }) => {
    const taskId = 't_e2e_' + Date.now()
    // create
    const created = await (await request.post(`${API}/api/annotations/${taskId}`, {
      data: {
        anchor: { type: 'segment', segId: 's0' },
        body: '漏译',
        userId: 'u1', userName: 'A', color: '#f00'
      }
    })).json()
    expect(created.id).toMatch(/^ann_/)
    // list
    const list = await (await request.get(`${API}/api/annotations/${taskId}`)).json()
    expect(list.annotations).toHaveLength(1)
    expect(list.stats.total).toBe(1)
    // update
    const upd = await (await request.patch(`${API}/api/annotations/${taskId}/${created.id}`, {
      data: { status: 'resolved', body: '已确认' }
    })).json()
    expect(upd.status).toBe('resolved')
    expect(upd.body).toBe('已确认')
    // delete
    const del = await (await request.delete(`${API}/api/annotations/${taskId}/${created.id}`)).json()
    expect(del.ok).toBe(true)
    const after = await (await request.get(`${API}/api/annotations/${taskId}`)).json()
    expect(after.annotations).toHaveLength(0)
  })

  test('POST 缺字段 → 400', async ({ request }) => {
    const r = await request.post(`${API}/api/annotations/t_e2e`, {
      data: { body: 'x' },
      failOnStatusCode: false
    })
    expect(r.status()).toBe(400)
  })
})

test.describe('匿名身份 + 协作健康', () => {
  test('POST /api/auth/anonymous 返回 token', async ({ request }) => {
    const r = await request.post(`${API}/api/auth/anonymous`)
    expect(r.ok()).toBeTruthy()
    const j = await r.json()
    expect(j.userId).toMatch(/^u_/)
    expect(j.token).toBeTruthy()
    expect(j.color).toMatch(/^#/)
  })

  test('GET /api/health/collab 返回 algorithm=ws-v1', async ({ request }) => {
    const r = await request.get(`${API}/api/health/collab`)
    expect(r.ok()).toBeTruthy()
    const j = await r.json()
    expect(j.algorithm).toBe('ws-v1')
  })
})
