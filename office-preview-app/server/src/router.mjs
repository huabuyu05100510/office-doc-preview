// 路由分发：上传 / 任务列表 / 单任务 / 文件服务（含 Range）
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { CONFIG, MIME, extOf, mimeOf, strategyOf } from './config.mjs'
import { listTasks, getTask, upsertTask, updateTask, loadTasks } from './store.mjs'
import { parseMultipart, readBody } from './multipart.mjs'
import { enqueueConvert } from './converter.mjs'
import { ensureLinearized } from './pdf-optimize.mjs'
import { extractTextLayer, pdfRenderEngine } from './pdf-rasterize.mjs'
import { getPdfiumMetrics } from './pdfium-render.mjs'

function sendJSON(res, code, data) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', '*')
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length, ETag')
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  // 防止浏览器/代理缓存任务列表等动态 JSON 响应（避免用户看到 stale 数据）
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  res.setHeader('Pragma', 'no-cache')
  res.writeHead(code)
  res.end(JSON.stringify(data))
}

function uid() {
  return 't_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex')
}

// 文件大小人类可读
function humanSize(n) {
  if (!n && n !== 0) return '-'
  const u = ['B', 'KB', 'MB', 'GB']
  let i = 0
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`
}

// 创建任务并落盘原文件
export function createTaskFromFile({ name, size, mtime, ext, strategy, originalPath }) {
  const id = uid()
  const now = Date.now()
  const task = {
    id,
    name,
    size,
    ext,
    mime: mimeOf(name),
    strategy,
    originalPath: originalPath || null,        // 仅扫描导入的样本在用
    originalUrl: `/api/files/${id}?as=original`,
    previewUrl: null,
    previewExt: null,
    convertStatus: strategy === 'convert_pdf' ? 'pending' : 'done',
    status: 'ready',
    createdAt: now,
    updatedAt: now
  }
  if (strategy === 'frontend') {
    // 直接用原文件作为预览源
    task.previewUrl = task.originalUrl
    task.previewExt = ext
  }
  // 前端 PDF：异步线性化，让 pdf.js 流式秒开（不变更策略）
  if (strategy === 'frontend' && ext === 'pdf') {
    ensureLinearized(task, originalPath || task.originalPath)
      .then(linPath => {
        if (linPath && linPath !== (originalPath || task.originalPath)) {
          updateTask(task.id, {
            previewPath: linPath,
            previewUrl: `/api/files/${task.id}?as=preview`,
            previewExt: 'pdf'
          })
        }
      })
      .catch(e => console.warn('[scan] linearize failed', task.name, e.message))
  }
  upsertTask(task)
  return task
}

// 复制/移动外部文件到 upload 目录（扫描导入用）
export function importExternalFile(absPath, { copy = true } = {}) {
  const stat = fs.statSync(absPath)
  const name = path.basename(absPath)
  const ext = extOf(name)
  const strategy = strategyOf(ext)
  if (strategy === 'unsupported') return null
  const id = uid()
  const dest = path.join(CONFIG.UPLOAD_DIR, id + '_' + name)
  if (copy) fs.copyFileSync(absPath, dest)
  else fs.renameSync(absPath, dest)
  return createTaskFromFile({
    name, size: stat.size, mtime: stat.mtimeMs, ext, strategy, originalPath: dest
  })
}

// 扫描预置样本目录，幂等导入
export function scanSamples() {
  if (!fs.existsSync(CONFIG.SAMPLES_DIR)) {
    console.log(`[scan] 样本目录不存在: ${CONFIG.SAMPLES_DIR}`)
    return 0
  }
  loadTasks()
  const existingNames = new Set(listTasks().map(t => t.name))
  let count = 0
  for (const entry of fs.readdirSync(CONFIG.SAMPLES_DIR)) {
    if (entry.startsWith('.')) continue
    const abs = path.join(CONFIG.SAMPLES_DIR, entry)
    if (!fs.statSync(abs).isFile()) continue
    if (existingNames.has(entry)) continue
    const ext = extOf(entry)
    const strategy = strategyOf(ext)
    if (strategy === 'unsupported') {
      console.log(`[scan] 跳过不支持的格式: ${entry}`)
      continue
    }
    const task = importExternalFile(abs, { copy: true })
    if (task) {
      count++
      console.log(`[scan] 导入样本: ${entry} → ${task.id} [${strategy}]`)
      if (strategy === 'convert_pdf') enqueueConvert(task, task.originalPath)
    }
  }
  return count
}

// 处理 multipart 上传：用已验证的 readBody + parseMultipart（正确性优先）
async function handleUpload(req, res) {
  try {
    const declaredCL = Number(req.headers['content-length'] || 0)
    const body = await readBody(req, CONFIG.MAX_FILE_SIZE)
    const ct = req.headers['content-type'] || ''
    const boundaryMatch = ct.match(/boundary=(?:"([^"]+)"|([^;]+))/i)
    if (!boundaryMatch) return sendJSON(res, 400, { error: 'no boundary' })
    const fields = parseMultipart(body, boundaryMatch[1] || boundaryMatch[2])
    const file = fields.file
    if (!file || !file.filename) return sendJSON(res, 400, { error: 'missing file' })

    const name = file.filename
    const ext = extOf(name)
    const strategy = strategyOf(ext)
    // 上传完整性诊断日志
    console.log(`[upload] ${name} | 声明CL=${declaredCL} 实际body=${body.length} 文件data=${file.data.length} | ${strategy}`)
    if (strategy === 'unsupported') return sendJSON(res, 415, { error: `unsupported format: .${ext}` })

    const id = uid()
    const dest = path.join(CONFIG.UPLOAD_DIR, id + '_' + name)
    fs.writeFileSync(dest, file.data)

    const task = createTaskFromFile({ name, size: file.data.length, ext, strategy, originalPath: dest })
    if (strategy === 'convert_pdf') enqueueConvert(task, dest)
    return sendJSON(res, 200, { ok: true, task })
  } catch (e) {
    return sendJSON(res, e.message === 'FILE_TOO_LARGE' ? 413 : 500, { error: e.message })
  }
}

// 文件服务（含 Range 支持，对音视频流畅拖动至关重要）
function serveFile(req, res, filePath, filename, contentTypeOverride, skipMimeLookup) {
  if (!fs.existsSync(filePath)) return sendJSON(res, 404, { error: 'file not found' })
  const stat = fs.statSync(filePath)
  const total = stat.size
  const range = req.headers['range']
  const type = contentTypeOverride || (skipMimeLookup ? 'application/octet-stream' : mimeOf(filename))
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length')
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Content-Type', type)
  res.setHeader('ETag', `"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`)
  if (filename) res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(filename)}`)

  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/)
    if (m) {
      let start = m[1] ? parseInt(m[1], 10) : 0
      let end = m[2] ? parseInt(m[2], 10) : total - 1
      if (end >= total) end = total - 1
      if (start > end) start = end
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Content-Length': end - start + 1
      })
      fs.createReadStream(filePath, { start, end }).pipe(res)
      return
    }
  }
  res.writeHead(200, { 'Content-Length': total })
  fs.createReadStream(filePath).pipe(res)
}

export async function route(req, res) {
  const url = new URL(req.url, CONFIG.HOST)
  const pathname = url.pathname

  if (req.method === 'OPTIONS') {
    sendJSON(res, 204, {})
    return
  }

  try {
    return await handleRoute(req, res, url, pathname)
  } catch (err) {
    console.error(`[router] ${req.method} ${pathname} → 500:`, err.message)
    if (!res.headersSent) {
      sendJSON(res, 500, { error: err.message || 'internal error', path: pathname })
    } else {
      try { res.end() } catch {}
    }
  }
}

async function handleRoute(req, res, url, pathname) {

  // 健康检查
  if (pathname === '/api/health') return sendJSON(res, 200, { ok: true, t: Date.now() })

  // PDFium 引擎健康 + metrics（用于线上可观测 / 性能监控）
  if (pathname === '/api/health/pdfium') {
    const m = getPdfiumMetrics()
    return sendJSON(res, 200, { ok: m.engine !== 'failed', ...m })
  }

  // 当前渲染引擎标识（被前端 perf 面板消费）
  if (pathname === '/api/render-engine') {
    return sendJSON(res, 200, { engine: pdfRenderEngine() })
  }

  // 扫描样本（开发期手动触发）
  if (pathname === '/api/scan' && req.method === 'POST') {
    const n = scanSamples()
    return sendJSON(res, 200, { ok: true, imported: n })
  }

  // 任务列表（剔除内部文件系统路径，避免信息泄漏）
  if (pathname === '/api/tasks' && req.method === 'GET') {
    const safe = listTasks().map(t => {
      const { originalPath, previewPath, thumbPath, pagesDir, ...rest } = t
      // 兜底：用 text-layer data-page-w/h 作为权威尺寸（兼容老脏数据，API 返回了 thumb 尺寸）
      if (Array.isArray(rest.pages) && rest.pages.length && rest.textDir) {
        for (const p of rest.pages) {
          try {
            const pad3 = String(p.page).padStart(3, '0')
            const txtPath = path.join(rest.textDir, `page-${pad3}.html`)
            if (!fs.existsSync(txtPath)) continue
            const html = fs.readFileSync(txtPath, 'utf-8')
            const wm = html.match(/data-page-w="([\d.]+)"/)
            const hm = html.match(/data-page-h="([\d.]+)"/)
            if (wm && hm) {
              const tw = parseFloat(wm[1])
              const th = parseFloat(hm[1])
              // 若 API 维度与 text-layer 维度不一致（典型：thumb 96 DPI vs 栅格 120 DPI），以 text-layer 为准
              if (Math.abs((p.width || 0) - tw) > 1 || Math.abs((p.height || 0) - th) > 1) {
                p.width = tw
                p.height = th
              }
            }
          } catch {}
        }
      }
      return rest
    })
    return sendJSON(res, 200, { tasks: safe })
  }

  // 上传（流式）
  if (pathname === '/api/upload' && req.method === 'POST') {
    return await handleUpload(req, res)
  }

  // 文件服务 /api/files/:id?as=original|preview|thumb|page&n=N|text&n=N
  const m = pathname.match(/^\/api\/files\/([\w-]+)$/)
  if (m && req.method === 'GET') {
    const id = m[1]
    const as = url.searchParams.get('as') || 'preview'
    const task = getTask(id)
    if (!task) return sendJSON(res, 404, { error: 'task not found' })

    // ---------- ?as=thumb ----------
    if (as === 'thumb') {
      if (!task.thumbPath || !fs.existsSync(task.thumbPath)) return sendJSON(res, 404, { error: 'thumb not ready' })
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      return serveFile(req, res, task.thumbPath, `thumb-${id}.png`, 'image/png', true)
    }

    // ---------- ?as=page&n=N ----------
    if (as === 'page') {
      const n = Number(url.searchParams.get('n'))
      if (!Number.isInteger(n) || n < 1) return sendJSON(res, 400, { error: 'invalid page number' })
      if (!task.pagesDir || !fs.existsSync(task.pagesDir)) return sendJSON(res, 404, { error: 'pages not ready' })
      const total = task.pagesTotal || 0
      if (n > total) return sendJSON(res, 404, { error: `page ${n} out of range (total ${total})` })
      const pad3 = String(n).padStart(3, '0')
      const pad2 = String(n).padStart(2, '0')
      const candidates = [
        path.join(task.pagesDir, `page-${pad3}.png`),
        path.join(task.pagesDir, `page-${pad2}.png`),
        path.join(task.pagesDir, `page-${n}.png`)
      ]
      const filePath = candidates.find(p => fs.existsSync(p))
      const safe = filePath && path.resolve(filePath).startsWith(path.resolve(task.pagesDir) + path.sep) ? filePath : null
      if (!safe) return sendJSON(res, 404, { error: `page ${n} not found` })
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      // 【PDFium 可观测】响应头：当前引擎 + 渲染耗时
      res.setHeader('X-Render-Engine', pdfRenderEngine())
      const st = fs.statSync(safe)
      res.setHeader('X-Render-Ms', String(st.mtimeMs | 0)) // 文件 mtime 作为生成时间戳
      res.setHeader('X-Page-Number', String(n))
      res.setHeader('X-Page-Total', String(total))
      return serveFile(req, res, safe, `page-${n}-${id}.png`, 'image/png', true)
    }

    // ---------- ?as=text&n=N (方案 B：透明文字覆盖层) ----------
    if (as === 'text') {
      const n = Number(url.searchParams.get('n'))
      if (!Number.isInteger(n) || n < 1) return sendJSON(res, 400, { error: 'invalid page number' })
      if (!task.textDir || !fs.existsSync(task.textDir)) return sendJSON(res, 404, { error: 'text layers not ready' })
      const total = task.pagesTotal || 0
      if (n > total) return sendJSON(res, 404, { error: `page ${n} out of range (total ${total})` })
      const pad3 = String(n).padStart(3, '0')
      const pad2 = String(n).padStart(2, '0')
      const candidates = [
        path.join(task.textDir, `page-${pad3}.html`),
        path.join(task.textDir, `page-${pad2}.html`),
        path.join(task.textDir, `page-${n}.html`)
      ]
      let filePath = candidates.find(p => fs.existsSync(p))
      const safe = filePath && path.resolve(filePath).startsWith(path.resolve(task.textDir) + path.sep) ? filePath : null
      if (!safe) return sendJSON(res, 404, { error: `text ${n} not found` })

      // 【自动重生】检测到旧版结构或非 PDFium 产物 → 用新代码按需重生
      // 1. 旧结构：含 <p style="position:absolute...display:flex"> 行容器
      // 2. 异常薄高：所有 span 高度都 < 5px（pdftotext 对长中文句的 bbox bug，旧代码无 16px 下限兜底）
      // 3. 非 PDFium 产物：缺少 data-pdfium="1" 标记（兼容老任务从 poppler 路径迁过来）
      let html = fs.readFileSync(safe, 'utf-8')
      const isOldFormat = /<p\s+style="[^"]*display:flex[^"]*align-items:\s*flex-end/i.test(html)
      const isNotPdfium = !/data-pdfium="1"/.test(html)
      const heights = [...html.matchAll(/height:\s*([\d.]+)px/g)].map(m => parseFloat(m[1]))
      const hasThinWord = heights.length > 0 && heights.every(h => h < 5)
      const reason = isOldFormat ? 'old flex <p>' : (isNotPdfium ? 'pre-pdfium' : (hasThinWord ? 'thin inkH' : null))
      if (reason && task.previewPath && fs.existsSync(task.previewPath)) {
        try {
          const result = await extractTextLayer(task.previewPath, n, safe, { renderDpi: CONFIG.RASTERIZE_PAGE_DPI })
          html = fs.readFileSync(safe, 'utf-8')
          console.log(`[text-layer] regenerated ${id}#${n} → ${result.words} chars (reason: ${reason})`)
        } catch (e) {
          console.warn(`[text-layer] regenerate failed for ${id}#${n}: ${e.message}`)
        }
      }

      // 【PDFium 可观测】响应头
      res.setHeader('Cache-Control', 'no-cache, must-revalidate')
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.setHeader('X-Render-Engine', pdfRenderEngine())
      const charCount = (html.match(/<span /g) || []).length
      res.setHeader('X-Char-Count', String(charCount))
      res.setHeader('X-Page-Number', String(n))
      res.setHeader('X-Page-Total', String(total))
      res.writeHead(200, { 'Content-Length': Buffer.byteLength(html) })
      res.end(html)
      return
    }

    // ---------- ?as=original / preview ----------
    const filePath = as === 'original' ? task.originalPath : task.previewPath || task.originalPath
    const filename = as === 'original' ? task.name : `${task.name}.${task.previewExt || task.ext}`
    return serveFile(req, res, filePath, filename)
  }

  sendJSON(res, 404, { error: 'not found', path: pathname })
}
