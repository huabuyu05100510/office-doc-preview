// segmentExtract.test.ts
// 模型：claude-sonnet-4-6
import { describe, it, expect } from 'vitest'
import { extractAndTagSegments, clearSegIds } from '../src/compare/segmentExtract'

describe('extractAndTagSegments', () => {
  it('DOCX：<p> 节点 → 段（跳过空段）', () => {
    const root = document.createElement('div')
    root.innerHTML = `<article class="docx-article">
      <p>第一段</p>
      <p>   </p>
      <p>第二段</p>
      <h1>标题</h1>
    </article>`
    const { segments, elements } = extractAndTagSegments(root, 'src')
    expect(segments).toHaveLength(3)
    expect(segments[0].id).toBe('src-0')
    expect(segments[0].text).toBe('第一段')
    expect(segments[2].text).toBe('标题')
    expect(elements[0].dataset.segId).toBe('src-0')
  })

  it('PDF：按 top 聚合 span（同 top = 同段）', () => {
    const root = document.createElement('div')
    const layer = document.createElement('div')
    layer.className = 'pdf-text-layer'
    ;[
      { top: 10, text: 'Hello ' },
      { top: 10, text: 'World' },
      { top: 30, text: 'Second' },
      { top: 50, text: 'Third' }
    ].forEach(({ top, text }) => {
      const s = document.createElement('span')
      s.style.top = top + 'px'
      s.style.position = 'absolute'
      s.textContent = text
      layer.appendChild(s)
    })
    root.appendChild(layer)
    const { segments } = extractAndTagSegments(root, 'tgt')
    expect(segments).toHaveLength(3)
    expect(segments[0].text).toBe('Hello World')
    expect(segments[1].text).toBe('Second')
    expect(segments[2].text).toBe('Third')
  })

  it('PDF：每段内所有 span 共享同一 segId', () => {
    const root = document.createElement('div')
    const layer = document.createElement('div')
    layer.className = 'pdf-text-layer'
    for (let i = 0; i < 3; i++) {
      const s = document.createElement('span')
      s.style.top = '10px'
      s.textContent = 'a'
      layer.appendChild(s)
    }
    root.appendChild(layer)
    extractAndTagSegments(root, 'tgt')
    const ids = new Set([...layer.querySelectorAll('span')].map(s => s.dataset.segId))
    expect(ids.size).toBe(1)
  })

  it('TXT/MD：<pre> → 按空行分段', () => {
    const root = document.createElement('div')
    const pre = document.createElement('pre')
    pre.textContent = '第一段\n行2\n\n第二段\n\n第三段'
    root.appendChild(pre)
    const { segments } = extractAndTagSegments(root, 'src')
    expect(segments).toHaveLength(3)
    expect(segments[0].text).toContain('第一段')
  })

  it('空 DOM 返回空', () => {
    const root = document.createElement('div')
    const r = extractAndTagSegments(root, 'x')
    expect(r.segments).toEqual([])
    expect(r.elements).toEqual([])
  })

  it('clearSegIds 移除所有 data-seg-id', () => {
    const root = document.createElement('div')
    root.innerHTML = `<article class="docx-article"><p>a</p><p>b</p></article>`
    extractAndTagSegments(root, 'src')
    expect(root.querySelectorAll('[data-seg-id]')).toHaveLength(2)
    clearSegIds(root)
    expect(root.querySelectorAll('[data-seg-id]')).toHaveLength(0)
  })
})
