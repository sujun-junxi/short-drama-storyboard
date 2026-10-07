import { serializeVisualSetting } from '../../shared/prompt.mjs'
import type { ImageState, Shot, VisualSetting } from './types'
import { downloadFile } from './useCopy'

export interface StoryboardMeta {
  topic: string
  script: string
  style: string
  model: string
}

/**
 * 取某条分镜可导出的配图地址。
 *
 * dataURL 要排除掉：手机端 gpt-image 系列只返回 base64，会被转成几 MB 的 dataURL，
 * 写进 Markdown / JSON 会让文件大到没法用。
 */
function imageUrlAt(images: ImageState[] | undefined, index: number): string {
  const state = images?.[index]
  const url = state?.status === 'success' && state.url ? state.url : ''
  if (!url || url.startsWith('data:')) return ''
  return url
}

/** 是不是可以分享出去的绝对地址（本地缓存是 /api/... 这种相对路径，换台机器打不开） */
function isAbsoluteUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

export function shotToText(shot: Shot, index: number): string {
  return [
    `镜头 ${shot.shotNumber || index + 1}｜${shot.shotType || '未指定'}`,
    `画面描述：${shot.sceneDescription || '—'}`,
    `人物动作：${shot.characterAction || '—'}`,
    `台词/旁白：${shot.dialogue || '—'}`,
    `画面提示词：${shot.imagePrompt || '—'}`,
  ].join('\n')
}

export function storyboardToMarkdown(
  shots: Shot[],
  meta: StoryboardMeta,
  images?: ImageState[],
  visualSetting?: VisualSetting | null,
): string {
  const head = [
    '# 短剧分镜脚本',
    '',
    `- 主题：${meta.topic || '未填写'}`,
    `- 风格：${meta.style || '未指定'}`,
    `- 生成模型：${meta.model || '—'}`,
    '',
    '---',
    '',
  ]

  // 统一视觉设定放在最前面：它是整组画面的「基准」，分镜提示词都拼在它之上。
  // 摘要单独列出 —— serializeVisualSetting 是给模型看的，不含 summary。
  const settingBlock: string[] = []
  if (visualSetting) {
    settingBlock.push('## 统一视觉设定', '')
    if (visualSetting.summary) settingBlock.push(`> ${visualSetting.summary}`, '')
    settingBlock.push(serializeVisualSetting(visualSetting), '', '---', '')
  }

  const body = shots
    .map((shot, i) => {
      const url = imageUrlAt(images, i)
      if (!url) return `${shotToText(shot, i)}\n`
      // 绝对地址可以内嵌；本地缓存路径在别的机器上是坏图，只标注出处
      const line = isAbsoluteUrl(url)
        ? `![镜头 ${shot.shotNumber || i + 1} 配图](${url})`
        : `配图：本地缓存（${url}，仅本机可访问）`
      return `${shotToText(shot, i)}\n${line}\n`
    })
    .join('\n')

  const tail = meta.script.trim() ? `\n---\n\n## 原始剧本\n\n${meta.script.trim()}\n` : ''
  return head.join('\n') + settingBlock.join('\n') + body + tail
}

/**
 * 导出的 JSON 里，配图只以 imageUrl 字段体现，且仅当该条确实生成成功。
 * Shot 本身不带任何 UI 状态，所以这里不需要反向剔除。
 */
export function storyboardToJson(
  shots: Shot[],
  meta: StoryboardMeta,
  images?: ImageState[],
  visualSetting?: VisualSetting | null,
): string {
  const payload = shots.map((shot, i) => {
    const url = imageUrlAt(images, i)
    return url ? { ...shot, imageUrl: url } : shot
  })
  return JSON.stringify({ ...meta, visualSetting: visualSetting ?? null, shots: payload }, null, 2)
}

export function exportStoryboard(
  format: 'md' | 'json',
  shots: Shot[],
  meta: StoryboardMeta,
  images?: ImageState[],
  visualSetting?: VisualSetting | null,
) {
  const stamp = new Date().toISOString().slice(0, 10)
  const name = `短剧分镜_${meta.topic || '未命名'}_${stamp}`
  if (format === 'md') {
    downloadFile(`${name}.md`, storyboardToMarkdown(shots, meta, images, visualSetting), 'text/markdown')
  } else {
    downloadFile(`${name}.json`, storyboardToJson(shots, meta, images, visualSetting), 'application/json')
  }
}
