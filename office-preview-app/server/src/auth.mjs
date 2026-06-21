// 匿名身份 + JWT 签发
// 模型：claude-sonnet-4-6
import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { CONFIG } from './config.mjs'

const SECRET = process.env.COLLAB_JWT_SECRET || CONFIG.ONLYOFFICE_JWT_SECRET || 'office-preview-dev-secret'

const COLORS = ['#f55', '#5b8', '#fa0', '#08c', '#a3f', '#5c3', '#f80', '#0a8']
const NAMES = ['蓝鲸', '青鸟', '白鹭', '玄燕', '朱鹮', '紫貂', '墨狐', '苍鹰']

function usersDir() {
  if (process.env.COLLAB_USERS_DIR_OVERRIDE) return process.env.COLLAB_USERS_DIR_OVERRIDE
  const dir = path.join(CONFIG.DATA_DIR, 'users')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function uid() {
  return 'u_' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex')
}

/**
 * 签发匿名身份 + JWT
 */
export function issueAnonymous() {
  const userId = uid()
  const idx = crypto.randomInt(0, COLORS.length)
  const userName = NAMES[idx] + '#' + crypto.randomBytes(2).toString('hex')
  const color = COLORS[idx]
  const token = jwt.sign(
    { userId, userName, color, kind: 'anonymous' },
    SECRET,
    { expiresIn: '7d' }
  )
  // 落盘留底（可观测）
  try {
    const file = path.join(usersDir(), userId + '.json')
    fs.writeFileSync(file, JSON.stringify({ userId, userName, color, createdAt: Date.now() }, null, 2), 'utf-8')
  } catch (e) {
    console.warn('[auth] persist user failed:', e.message)
  }
  console.log(`[auth] issueAnonymous ${userId} (${userName})`)
  return { userId, userName, color, token }
}

/**
 * 校验 JWT
 */
export function verifyToken(token) {
  if (!token) throw new Error('missing token')
  return jwt.verify(token, SECRET)
}

export function authSecret() {
  return SECRET
}
