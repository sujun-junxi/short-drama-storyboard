/**
 * 参考图的推演逻辑（纯函数）。
 *
 * 思路：统一视觉设定里已经有角色与场景的描述，把它转成「几张可以直接送进文生图的提示词」，
 * 先生成出来当锚，后续每张分镜图都带着它们去生成，一致性会明显好于纯文字。
 */
import type { VisualSetting } from '../../shared/prompt.mjs'
import type { ReferenceImage } from './types'

/**
 * 最多给几个角色出参考图。
 * 角色表末尾往往是次要人物，对整组一致性影响很小，但每张参考图都要多花一次生成 ——
 * 不值得为次要人物多花一次生成。
 */
export const MAX_CHARACTER_REFS = 4

/** 模型没给 referencePrompt 时的兜底：用中文外貌+服装拼一段也能出图 */
function fallbackCharacterPrompt(character: VisualSetting['characters'][number]): string {
  const bits = [character?.appearance, character?.clothing]
    .map((v) => String(v ?? '').trim())
    .filter(Boolean)
  if (bits.length === 0) return ''
  return `${bits.join('，')}，角色设定图，正面半身，纯色背景，光线均匀`
}

/**
 * 从统一视觉设定推演出要生成哪些参考图。
 * 设定为空（生成失败、或用户还没生成）时返回空数组，调用方据此跳过这一步。
 */
export function buildReferenceTargets(setting: VisualSetting | null | undefined): ReferenceImage[] {
  if (!setting) return []

  const out: ReferenceImage[] = []
  const characters = Array.isArray(setting.characters) ? setting.characters.slice(0, MAX_CHARACTER_REFS) : []

  characters.forEach((character, index) => {
    const prompt = String(character?.referencePrompt ?? '').trim() || fallbackCharacterPrompt(character)
    if (!prompt) return
    out.push({
      id: `char:${index}`,
      kind: 'character',
      label: String(character?.name ?? '').trim() || `角色 ${index + 1}`,
      prompt,
      status: 'idle',
    })
  })

  const scenePrompt = String(setting.sceneReferencePrompt ?? '').trim()
  if (scenePrompt) {
    out.push({ id: 'scene:', kind: 'scene', label: '核心场景', prompt: scenePrompt, status: 'idle' })
  }

  return out
}

/**
 * 把参考图的 url 收集起来，供后续分镜图当输入。
 * 只取已经成功生成的那些 —— 失败或还在跑的不该被塞进请求。
 */
export function readyReferenceUrls(references: ReferenceImage[]): string[] {
  return references.filter((r) => r.status === 'success' && r.url).map((r) => String(r.url))
}
