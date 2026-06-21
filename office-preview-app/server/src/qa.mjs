// 质量检查（mock v1）
// 模型：claude-sonnet-4-6
//
// 设计：
//   - v1 mock：根据 alignment.pairs 索引硬编码 7 类 issue 样本
//   - v2 增量位：runQA 签名不变，内部换真实规则引擎
//
// 可观测：[qa] 日志 + /api/health/qa
import crypto from 'node:crypto'

const ALGO_VERSION = 'mock-v1'

function issueId() {
  return 'qa_' + crypto.randomBytes(4).toString('hex')
}

/**
 * mock v1：根据 alignment.pairs 命中段固定为 0/1/2/3/4/5/6 段，覆盖 7 类规则
 * @param {{id:string}} tgtTask
 * @param {{id:string}} srcTask
 * @param {{pairs: Array<{src:string,tgt:string}>}} alignment
 * @returns {{issues: Array, stats: object}}
 */
export function runQA(tgtTask, srcTask, alignment) {
  const pairs = alignment?.pairs || []
  if (!pairs.length) {
    return { issues: [], stats: { algorithm: ALGO_VERSION, total: 0, byRule: {} } }
  }

  const at = (i) => pairs[Math.min(i, pairs.length - 1)]
  const issues = [
    {
      id: issueId(),
      rule: 'untranslated',
      severity: 'error',
      srcSegId: at(0).src,
      tgtSegId: at(0).tgt,
      message: '疑似未译：源段与译段文本完全一致',
      suggestion: '请确认该段是否需要翻译为对应目标语言'
    },
    {
      id: issueId(),
      rule: 'punctuation_cn_en',
      severity: 'warning',
      srcSegId: at(1).src,
      tgtSegId: at(1).tgt,
      message: '中英文标点混用：译段中同时出现「，」与「,」',
      suggestion: '统一为目标语言标点（中文用全角，英文用半角）'
    },
    {
      id: issueId(),
      rule: 'number_mismatch',
      severity: 'error',
      srcSegId: at(2).src,
      tgtSegId: at(2).tgt,
      message: '数字不一致：源段「3 个」→ 译段「3」',
      suggestion: '保留原文数字与单位「3 个」'
    },
    {
      id: issueId(),
      rule: 'term_inconsistent',
      severity: 'warning',
      srcSegId: at(3).src,
      tgtSegId: at(3).tgt,
      message: '术语不一致：「cloud」在不同段中译为「云」与「云端」',
      suggestion: '统一为频次最高译法「云」'
    },
    {
      id: issueId(),
      rule: 'whitespace',
      severity: 'info',
      srcSegId: at(4).src,
      tgtSegId: at(4).tgt,
      message: '行尾多余空白 / 双空格',
      suggestion: 'trim 行首尾空白，合并连续空格为单空格'
    },
    {
      id: issueId(),
      rule: 'tag_mismatch',
      severity: 'error',
      srcSegId: at(5).src,
      tgtSegId: at(5).tgt,
      message: '占位符数量不一致：源段 {0} {1}，译段缺失 {1}',
      suggestion: '补齐缺失占位符 {1}'
    },
    {
      id: issueId(),
      rule: 'length_ratio',
      severity: 'warning',
      srcSegId: at(6 % pairs.length).src,
      tgtSegId: at(6 % pairs.length).tgt,
      message: '译段长度比超出 [0.5, 2.5]，疑似漏译或冗余',
      suggestion: '核对段是否完整翻译，无遗漏或多余内容'
    }
  ]

  // 仅保留 pairs 索引可达的（min(7, pairs.length)）
  const valid = issues.filter((_, i) => i < pairs.length)
  const byRule = {}
  for (const i of valid) byRule[i.rule] = (byRule[i.rule] || 0) + 1

  console.log(`[qa] runQA tgt=${tgtTask?.id} src=${srcTask?.id} | issues=${valid.length}/${pairs.length}段`)

  return {
    issues: valid,
    stats: {
      algorithm: ALGO_VERSION,
      total: valid.length,
      byRule
    }
  }
}

/**
 * 构造纠错建议（v1 不写回原文件）
 * @param {object} issue
 */
export function buildFixSuggestion(issue) {
  if (!issue) return { ok: false, appliedText: '' }
  return {
    ok: true,
    appliedText: issue.suggestion || '',
    issueId: issue.id,
    rule: issue.rule
  }
}
