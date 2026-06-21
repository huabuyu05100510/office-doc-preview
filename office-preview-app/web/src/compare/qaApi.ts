// QA API client
// 模型：claude-sonnet-4-6
export interface QAIssue {
  id: string
  rule: string
  severity: 'error' | 'warning' | 'info'
  srcSegId: string
  tgtSegId: string
  message: string
  suggestion: string
}
export interface QAResult {
  issues: QAIssue[]
  stats: { algorithm: string; total: number; byRule: Record<string, number> }
}

export async function fetchQA(taskId: string, alignmentId: string, against?: string): Promise<QAResult> {
  const q = new URLSearchParams({ alignmentId })
  if (against) q.set('against', against)
  const r = await fetch(`/api/qa/${taskId}?${q}`)
  if (!r.ok) throw new Error(`qa failed: ${r.status}`)
  return r.json()
}

export async function fetchQAFix(taskId: string, issue: QAIssue): Promise<{ ok: boolean; appliedText: string }> {
  const r = await fetch(`/api/qa/${taskId}/fix`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ issue })
  })
  if (!r.ok) throw new Error(`qa fix failed: ${r.status}`)
  return r.json()
}
