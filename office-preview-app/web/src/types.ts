// 与后端对齐的任务类型
export type ConvertStatus =
  | 'pending'
  | 'processing'
  | 'retrying'
  | 'rasterizing'   // 栅格化阶段
  | 'done'
  | 'failed'
export type Strategy = 'frontend' | 'convert_pdf' | 'unsupported'

export interface PageImage {
  page: number
  url: string                  // ?as=page&n=N → PNG
  textUrl?: string             // ?as=text&n=N → 文字覆盖层 HTML（可选）
  textWords?: number           // 该页文字数（性能面板）
  width: number
  height: number
  bytes?: number
}

export type ConvertStage =
  | 'convert'
  | 'linearize'
  | 'thumb'
  | 'pages'
  | 'textLayer'
  | null

export interface Task {
  id: string
  name: string
  size: number
  ext: string
  mime: string
  strategy: Strategy
  originalUrl: string
  previewUrl: string | null
  previewExt: string | null
  convertStatus: ConvertStatus
  convertError?: string | null
  convertDurationMs?: number
  convertRetries?: number
  convertEtaSec?: number
  convertElapsedSec?: number
  convertBytesPerSec?: number
  convertRasterizeMs?: number
  previewSize?: number
  // 双产物（PDF + 图片 + 文字层）
  thumbUrl?: string | null
  pages?: PageImage[]
  pagesTotal?: number
  pagesDone?: number
  textDone?: number
  convertStage?: ConvertStage
  status: string
  createdAt: number
  updatedAt: number
}

// 渲染分类
export type PreviewKind =
  | 'pdf'         // pdf.js
  | 'pdf-images'  // 服务端栅格化图片 + 文字覆盖层（推荐）
  | 'docx'        // mammoth
  | 'image'
  | 'audio'
  | 'video'
  | 'text'
  | 'unsupported'

export function previewKindOf(task: Task): PreviewKind {
  const ext = (task.previewExt || task.ext).toLowerCase()
  if (ext === 'pdf') {
    if (task.pages && task.pages.length > 0) return 'pdf-images'
    return 'pdf'
  }
  if (ext === 'docx') return 'docx'
  if (['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'bmp', 'svg'].includes(ext)) return 'image'
  if (['mp3', 'wav', 'm4a', 'aac', 'pcm', 'amr'].includes(ext)) return 'audio'
  if (['mp4', 'm4v', 'mov', 'mkv', 'flv', 'webm'].includes(ext)) return 'video'
  if (['txt', 'md'].includes(ext)) return 'text'
  return 'unsupported'
}

export function humanSize(n?: number) {
  if (!n && n !== 0) return '-'
  const u = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let v = n
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`
}

export function formatTime(t: number) {
  const d = new Date(t)
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fileIcon(ext: string): string {
  const e = ext.toLowerCase()
  if (e === 'pdf') return 'PDF'
  if (e === 'docx' || e === 'doc') return 'DOC'
  if (e === 'pptx' || e === 'ppt') return 'PPT'
  if (e === 'xlsx' || e === 'xls') return 'XLS'
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'avif'].includes(e)) return 'IMG'
  if (['mp3', 'wav', 'm4a', 'aac'].includes(e)) return 'AUD'
  if (['mp4', 'mov', 'mkv', 'flv', 'webm'].includes(e)) return 'VID'
  if (['txt', 'md'].includes(e)) return 'TXT'
  return e.slice(0, 3).toUpperCase()
}

export function stageLabel(stage: ConvertStage): string {
  switch (stage) {
    case 'convert': return 'OnlyOffice 转换'
    case 'linearize': return '线性化'
    case 'thumb': return '缩略图'
    case 'pages': return '栅格化'
    case 'textLayer': return '文字层'
    default: return ''
  }
}