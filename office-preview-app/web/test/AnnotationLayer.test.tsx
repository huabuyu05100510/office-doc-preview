// AnnotationLayer.test.tsx
// 模型：claude-sonnet-4-6
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { AnnotationLayer } from '../src/annotations/AnnotationLayer'
import type { Annotation } from '../src/annotations/api'

function makeAnn(over: Partial<Annotation> = {}): Annotation {
  return {
    id: 'a1', taskId: 't1', userId: 'u1', userName: 'A', color: '#f00',
    anchor: { type: 'segment', segId: 's0' },
    body: 'hi', status: 'open',
    createdAt: 0, updatedAt: 0,
    ...over
  } as Annotation
}

describe('AnnotationLayer', () => {
  it('segment 锚定：在 root 内找到 [data-seg-id] 后渲染 marker', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const seg = document.createElement('div')
    seg.dataset.segId = 's0'
    seg.style.position = 'absolute'
    seg.style.left = '10px'
    seg.style.top = '20px'
    seg.style.width = '100px'
    seg.style.height = '20px'
    root.appendChild(seg)
    document.body.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000 } as any)
    root.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000 } as any)
    seg.getBoundingClientRect = () => ({ left: 10, top: 20, width: 100, height: 20 } as any)
    const { container } = render(<AnnotationLayer annotations={[makeAnn()]} root={root} onResolve={() => {}} onDelete={() => {}} />)
    const marker = container.querySelector('.ann-marker')
    expect(marker).toBeTruthy()
    expect(marker?.className).toContain('open')
  })

  it('rect 锚定：直接用 x/y/w/h', () => {
    const ann = makeAnn({ anchor: { type: 'rect', rect: { x: 5, y: 15, w: 50, h: 30, page: 1 } } })
    const root = document.createElement('div')
    document.body.appendChild(root)
    root.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000 } as any)
    const { container } = render(<AnnotationLayer annotations={[ann]} root={root} onResolve={() => {}} onDelete={() => {}} />)
    const marker = container.querySelector('.ann-marker') as HTMLElement
    expect(marker.style.left).toBe('5px')
    expect(marker.style.width).toBe('50px')
  })

  it('无匹配段时不渲染 marker', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    root.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000 } as any)
    const { container } = render(<AnnotationLayer annotations={[makeAnn()]} root={root} onResolve={() => {}} onDelete={() => {}} />)
    expect(container.querySelector('.ann-marker')).toBeNull()
  })
})
