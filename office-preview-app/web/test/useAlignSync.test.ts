// useAlignSync.test.ts
// 模型：claude-sonnet-4-6
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAlignSync } from '../src/compare/useAlignSync'
import type { Alignment } from '../src/compare/api'

const MOCK_ALIGN: Alignment = {
  id: 'align_test', srcTaskId: 's1', tgtTaskId: 't1', granularity: 'para',
  pairs: [
    { src: 'src-0', tgt: 'tgt-0', score: 0.92 },
    { src: 'src-1', tgt: 'tgt-1', score: 0.92 },
    { src: 'src-2', tgt: 'tgt-2', score: 0.92 }
  ],
  unmatched: { src: [], tgt: [] },
  stats: { algorithm: 'mock-v1', matched: 3, srcTotal: 3, tgtTotal: 3, scoreAvg: 0.92 },
  createdAt: Date.now()
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, status: 200,
    json: async () => MOCK_ALIGN
  } as any)))
})

describe('useAlignSync', () => {
  it('fetchAlign 拉对齐表后写入 alignment', async () => {
    const { result } = renderHook(() => useAlignSync({ srcTaskId: 's1', tgtTaskId: 't1' }))
    expect(result.current.alignment).toBeNull()
    await act(async () => {
      await result.current.fetchAlign(
        [{ id: 'src-0', text: 'a' }, { id: 'src-1', text: 'b' }, { id: 'src-2', text: 'c' }],
        [{ id: 'tgt-0', text: 'A' }, { id: 'tgt-1', text: 'B' }, { id: 'tgt-2', text: 'C' }]
      )
    })
    expect(result.current.alignment).toEqual(MOCK_ALIGN)
    expect(result.current.error).toBeNull()
    expect(result.current.loading).toBe(false)
  })

  it('highlight(segId) 设置 activeSegId', async () => {
    const { result } = renderHook(() => useAlignSync({ srcTaskId: 's1', tgtTaskId: 't1' }))
    await act(async () => {
      await result.current.fetchAlign(
        [{ id: 'src-0', text: 'a' }, { id: 'src-1', text: 'b' }],
        [{ id: 'tgt-0', text: 'A' }, { id: 'tgt-1', text: 'B' }]
      )
    })
    act(() => result.current.highlight('src-1'))
    expect(result.current.activeSegId).toBe('src-1')
    act(() => result.current.highlight(null))
    expect(result.current.activeSegId).toBeNull()
  })

  it('fetch 失败写 error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 } as any)))
    const { result } = renderHook(() => useAlignSync({ srcTaskId: 's1', tgtTaskId: 't1' }))
    await act(async () => {
      await result.current.fetchAlign([{ id: 'src-0', text: 'a' }], [{ id: 'tgt-0', text: 'A' }])
    })
    expect(result.current.alignment).toBeNull()
    expect(result.current.error).toBeTruthy()
  })
})
