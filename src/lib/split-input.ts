/**
 * 把一整段粘贴进来的文字拆成「主题」与「剧情」。
 *
 * 纯本地规则，不调用模型 —— 拆分必须瞬时完成，否则粘贴体验会很割裂。
 * 策略分两层：
 *   1. 认出显式标记（「主题：」「剧情：」「剧本：」等），按标记切
 *   2. 没有标记时，把首行当主题、其余当剧情
 */

export interface SplitResult {
  topic: string
  script: string
}

/** 与主题输入框的 maxLength 保持一致 */
const TOPIC_MAX = 60

/** 以句末标点结尾的行更像正文，而不是标题 */
const SENTENCE_END = /[。！？!?；;]$/

const TOPIC_MARKER = /^\s*(?:短剧)?主题\s*[:：]\s*/
const SCRIPT_MARKER = /^\s*(?:剧情|剧本|故事|梗概|大纲|内容|正文)\s*[:：]\s*/

/**
 * 判断一行是否像「主题」。
 *
 * 光看长度不够用：「订婚宴上，林氏千金当众把婚戒扔在地上。」只有 20 字，
 * 但它明显是正文首句而非标题。加一条「以句末标点结尾就不像标题」就分开了。
 */
function isTopicLike(line: string): boolean {
  return line.length > 0 && line.length <= TOPIC_MAX && !SENTENCE_END.test(line)
}

/** 去掉行首的 markdown 装饰符（# 标题、> 引用、* 列表）与行尾多余的星号 */
function stripDecorations(line: string): string {
  return line
    .replace(/^\s*[#>]+[\s]*/, '')
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/[*\s]+$/, '')
    .trim()
}

function normalize(raw: unknown): string {
  return String(raw ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * 拆出主题与剧情。返回的字段可能为空串（例如没找到主题），调用方按需填。
 */
export function splitTopicAndScript(raw: unknown): SplitResult {
  const text = normalize(raw)
  if (!text) return { topic: '', script: '' }

  const lines = text.split('\n')
  const topicIdx = lines.findIndex((l) => TOPIC_MARKER.test(l))
  const scriptIdx = lines.findIndex((l) => SCRIPT_MARKER.test(l))

  // ---------- 有显式标记：按标记切 ----------
  if (topicIdx >= 0 || scriptIdx >= 0) {
    const topic = topicIdx >= 0 ? stripDecorations(lines[topicIdx].replace(TOPIC_MARKER, '')) : ''

    let script = ''
    if (scriptIdx >= 0) {
      // 「剧情：」后面的正文，加上它之后的所有行
      const inline = stripDecorations(lines[scriptIdx].replace(SCRIPT_MARKER, ''))
      script = [inline, ...lines.slice(scriptIdx + 1)].filter((l) => l.trim() !== '').join('\n').trim()
    } else {
      // 只有「主题：」标记时，其余所有行都算剧情
      script = lines.filter((_, i) => i !== topicIdx).join('\n').trim()
    }

    return { topic: topic.length <= TOPIC_MAX ? topic : '', script }
  }

  // ---------- 无标记：首行当主题 ----------
  const first = stripDecorations(lines[0])
  const rest = lines.slice(1).join('\n').trim()

  // 单行：像标题就当主题，否则当剧情
  if (lines.length === 1) {
    return isTopicLike(first) ? { topic: first, script: '' } : { topic: '', script: first }
  }

  // 首行不像标题（太长或本身就是一句话），或后面没内容 → 整段都算剧情，
  // 主题留空由文本模型自己概括
  if (!isTopicLike(first) || !rest) {
    return { topic: '', script: text }
  }

  return { topic: first, script: rest }
}
