// 标注 API client
// 模型：claude-sonnet-4-6
export interface AnnotationAnchor {
  type: 'segment' | 'rect'
  segId?: string
  rect?: { x: number; y: number; w: number; h: number; page: number }
}
export interface Annotation {
  id: string
  taskId: string
  userId: string
  userName: string
  color: string
  anchor: AnnotationAnchor
  body: string
  status: 'open' | 'resolved'
  createdAt: number
  updatedAt: number
}

export async function listAnnotations(taskId: string): Promise<{ annotations: Annotation[]; stats: { total: number; open: number; resolved: number } }> {
  const r = await fetch(`/api/annotations/${taskId}`)
  if (!r.ok) throw new Error(`list annotations failed: ${r.status}`)
  return r.json()
}

export async function createAnnotation(taskId: string, input: { anchor: AnnotationAnchor; body: string; userId: string; userName: string; color: string }): Promise<Annotation> {
  const r = await fetch(`/api/annotations/${taskId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  })
  if (!r.ok) throw new Error(`create annotation failed: ${r.status}`)
  return r.json()
}

export async function updateAnnotation(taskId: string, id: string, patch: Partial<Annotation>): Promise<Annotation> {
  const r = await fetch(`/api/annotations/${taskId}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch)
  })
  if (!r.ok) throw new Error(`update annotation failed: ${r.status}`)
  return r.json()
}

export async function deleteAnnotation(taskId: string, id: string): Promise<boolean> {
  const r = await fetch(`/api/annotations/${taskId}/${id}`, { method: 'DELETE' })
  if (!r.ok) return false
  const j = await r.json()
  return !!j.ok
}
