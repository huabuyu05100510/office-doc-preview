// useAnnotations：本地标注状态 + 后端同步 + 协作广播 reconcile
// 模型：claude-sonnet-4-6
import { useCallback, useEffect, useRef, useState } from 'react'
import { Annotation, listAnnotations, createAnnotation, updateAnnotation, deleteAnnotation } from './api'
import { usePerf } from '../perf'

export function useAnnotations(taskId: string | null) {
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [loading, setLoading] = useState(false)
  // 协作消息 handler（由 useCollab 注入）
  const collabHandlerRef = useRef<((ann: Annotation, op: string) => void) | null>(null)

  const refresh = useCallback(async () => {
    if (!taskId) { setAnnotations([]); return }
    setLoading(true)
    try {
      const r = await listAnnotations(taskId)
      setAnnotations(r.annotations)
      usePerf.getState().set({
        annotationsTotal: r.stats.total,
        annotationsOpen: r.stats.open
      })
    } catch (e) {
      console.warn('[annotations] list failed', e)
    } finally {
      setLoading(false)
    }
  }, [taskId])

  useEffect(() => { refresh() }, [refresh])

  const create = useCallback(async (input: { anchor: any; body: string; userId: string; userName: string; color: string }) => {
    if (!taskId) return
    const ann = await createAnnotation(taskId, input)
    setAnnotations(prev => prev.find(a => a.id === ann.id) ? prev : [...prev, ann])
    return ann
  }, [taskId])

  const update = useCallback(async (id: string, patch: Partial<Annotation>) => {
    if (!taskId) return
    const updated = await updateAnnotation(taskId, id, patch)
    setAnnotations(prev => prev.map(a => a.id === id ? updated : a))
    return updated
  }, [taskId])

  const remove = useCallback(async (id: string) => {
    if (!taskId) return
    const ok = await deleteAnnotation(taskId, id)
    if (ok) setAnnotations(prev => prev.filter(a => a.id !== id))
    return ok
  }, [taskId])

  // 协作远端写入 → reconcile
  const applyRemote = useCallback((ann: Annotation, op: string) => {
    setAnnotations(prev => {
      if (op === 'delete') return prev.filter(a => a.id !== ann.id)
      if (op === 'create') return prev.find(a => a.id === ann.id) ? prev : [...prev, ann]
      if (op === 'update') return prev.map(a => a.id === ann.id ? { ...a, ...ann } : a)
      return prev
    })
  }, [])

  return { annotations, loading, refresh, create, update, remove, applyRemote }
}
