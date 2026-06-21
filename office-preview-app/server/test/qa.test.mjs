// qa.mjs 测试
// 模型：claude-sonnet-4-6
// 覆盖：mock 7 类 issue / byRule 统计 / fix 返回建议文案不写盘
import { describe, it, expect, beforeAll } from 'vitest'

let qa

beforeAll(async () => {
  qa = await import('../src/qa.mjs')
})

describe('runQA (mock v1)', () => {
  it('返回 7 类规则的代表 issue', () => {
    const alignment = {
      pairs: [
        { src: 's0', tgt: 't0' },
        { src: 's1', tgt: 't1' },
        { src: 's2', tgt: 't2' },
        { src: 's3', tgt: 't3' },
        { src: 's4', tgt: 't4' },
        { src: 's5', tgt: 't5' },
        { src: 's6', tgt: 't6' }
      ]
    }
    const r = qa.runQA({ id: 't_tgt' }, { id: 't_src' }, alignment)
    const rules = new Set(r.issues.map(i => i.rule))
    expect(rules.has('untranslated')).toBe(true)
    expect(rules.has('number_mismatch')).toBe(true)
    expect(rules.has('term_inconsistent')).toBe(true)
    expect(rules.has('punctuation_cn_en')).toBe(true)
    expect(rules.has('whitespace')).toBe(true)
    expect(rules.has('tag_mismatch')).toBe(true)
    expect(rules.has('length_ratio')).toBe(true)
  })

  it('每条 issue 含 id / severity / srcSegId / tgtSegId / message / suggestion', () => {
    const alignment = { pairs: [{ src: 's0', tgt: 't0' }] }
    const r = qa.runQA({ id: 't' }, { id: 's' }, alignment)
    for (const i of r.issues) {
      expect(i.id).toBeTruthy()
      expect(['error', 'warning', 'info']).toContain(i.severity)
      expect(i.srcSegId || i.tgtSegId).toBeTruthy()
      expect(typeof i.message).toBe('string')
      expect(typeof i.suggestion).toBe('string')
    }
  })

  it('空 alignment 返回空 issues', () => {
    const r = qa.runQA({ id: 't' }, { id: 's' }, { pairs: [] })
    expect(r.issues).toEqual([])
  })

  it('stats 含 byRule 计数与算法版本', () => {
    const alignment = { pairs: Array.from({ length: 8 }, (_, i) => ({ src: 's' + i, tgt: 't' + i })) }
    const r = qa.runQA({ id: 't' }, { id: 's' }, alignment)
    expect(r.stats.algorithm).toBe('mock-v1')
    expect(r.stats.total).toBe(r.issues.length)
    expect(r.stats.byRule).toBeDefined()
    expect(Object.keys(r.stats.byRule).length).toBeGreaterThanOrEqual(7)
  })
})

describe('buildFixSuggestion', () => {
  it('返回建议文案，不写回原文件', () => {
    const alignment = { pairs: Array.from({ length: 8 }, (_, i) => ({ src: 's' + i, tgt: 't' + i })) }
    const { issues } = qa.runQA({ id: 't' }, { id: 's' }, alignment)
    const issue = issues[0]
    const fix = qa.buildFixSuggestion(issue)
    expect(fix.ok).toBe(true)
    expect(typeof fix.appliedText).toBe('string')
    expect(fix.appliedText.length).toBeGreaterThan(0)
  })
})
