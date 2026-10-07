import type { VisualSetting } from '../../shared/prompt.mjs'

export interface Shot {
  shotNumber: number
  sceneDescription: string
  characterAction: string
  dialogue: string
  shotType: string
  imagePrompt: string
}

export type { VisualSetting }

export interface GenerateResult {
  model: string
  shots: Shot[]
  refused?: string | null
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null
  /** 本次生成使用的统一视觉设定（分镜出完后由前端单独产出并保存） */
  visualSetting?: VisualSetting | null
}

export type GenerateStatus = 'idle' | 'loading' | 'success' | 'error'

/**
 * 配图状态。刻意**不放进 Shot** —— Shot 是会被导出序列化的纯数据，
 * 混入 UI 状态会让导出的 JSON 里带上 imageStatus: 'loading' 这种字段。
 * 这里用与 shots 同索引的平行数组承载。
 */
export type ImageStatus = 'idle' | 'loading' | 'success' | 'error'

export interface ImageState {
  status: ImageStatus
  url?: string
  error?: string
  /** 是否命中服务端缓存（命中说明这次没花钱） */
  cached?: boolean
}

export type ReferenceKind = 'character' | 'scene'

/**
 * 参考图：由统一视觉设定衍生，先于分镜图生成，再作为参考喂给后续分镜。
 * 复用 ImageState 的状态字段，这样进度与错误提示和分镜图是同一套。
 */
export interface ReferenceImage extends ImageState {
  /** 稳定 id：`char:0` / `scene:` —— 重新生成时靠它定位，不能用数组下标 */
  id: string
  kind: ReferenceKind
  /** 展示名：角色名，或「核心场景」 */
  label: string
  /** 实际送进文生图模型的提示词 */
  prompt: string
}

/** 服务端 /api/image-adapters 返回的适配器元数据 */
export interface ImageAdapterMeta {
  id: string
  label: string
  kind: 'sync'
  needsKey: boolean
  defaultBaseUrl: string
  defaultModel: string
  models: string[]
  defaultSize: string
  sizeOptions: { value: string; label: string }[]
  baseUrlHint: string
}
