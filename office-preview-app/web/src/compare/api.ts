// 翻译对比 API client
// 模型：claude-sonnet-4-6
export interface AlignPair { src: string; tgt: string; score: number }
export interface AlignUnmatched { src: string[]; tgt: string[] }
export interface Alignment {
  id: string
  srcTaskId: string
  tgtTaskId: string
  granularity: string
  pairs: AlignPair[]
  unmatched: AlignUnmatched
  stats: { algorithm: string; matched: number; srcTotal: number; tgtTotal: number; scoreAvg: number }
  createdAt: number
}

export interface Segment { id: string; text: string }

export async function postAlign(
  srcTaskId: string, tgtTaskId: string,
  srcSegs: Segment[], tgtSegs: Segment[]
): Promise<Alignment> {
  const r = await fetch('/api/align', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ srcTaskId, tgtTaskId, srcSegs, tgtSegs, granularity: 'para' })
  })
  if (!r.ok) throw new Error(`align failed: ${r.status}`)
  return r.json()
}

export async function getAlignment(id: string): Promise<Alignment | null> {
  const r = await fetch(`/api/align/${id}`)
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`get align failed: ${r.status}`)
  return r.json()
}
