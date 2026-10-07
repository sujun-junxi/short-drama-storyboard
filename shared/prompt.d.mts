export interface Shot {
  shotNumber: number
  sceneDescription: string
  characterAction: string
  dialogue: string
  shotType: string
  imagePrompt: string
}

export interface ParsedShots {
  shots: Shot[]
  refused?: string | null
}

export interface ModelOption {
  value: string
  label: string
}

/** 统一视觉设定（视觉圣经）：固定整组画面的角色 / 场景 / 画风 / 色调，供页面展示与配图拼接 */
export interface VisualSetting {
  characters: {
    name: string
    appearance: string
    clothing: string
    /** 英文参考图描述：单独给这个角色出一张设定图，后续作为参考图复用 */
    referencePrompt: string
  }[]
  sceneLayout: string
  /** 英文参考图描述：核心场景的空镜，后续作为参考图复用 */
  sceneReferencePrompt: string
  artStyle: string
  colorLighting: string
  negative: string
  /** 英文逗号分隔的锚定提示词，拼到每条分镜前以保证统一 */
  imageAnchor: string
  summary: string
}

export interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

export interface PartialShot {
  shotNumber: number
  sceneDescription: string
  shotType: string
}

export declare const SHOT_TYPES: string[]
export declare const SHOT_COUNT: number
export declare function parseCompletedShots(content: unknown): PartialShot[]
export declare const MODEL_OPTIONS: ModelOption[]
export declare const DEFAULT_BASE_URL: string
export declare const SYSTEM_PROMPT: string
export declare const SYSTEM_PROMPT_VISUAL_SETTING: string
export declare const SAMPLING_PARAMS: {
  temperature: number
  top_p: number
  response_format: { type: 'json_object' }
}

export declare function buildUserPrompt(input: {
  topic?: string
  script?: string
  style?: string
  visualSetting?: VisualSetting | null
}): string
export declare function buildMessages(input: {
  topic?: string
  script?: string
  style?: string
  visualSetting?: VisualSetting | null
}): ChatMessage[]
export declare function serializeVisualSetting(vs: VisualSetting | null | undefined): string
export declare function buildVisualSettingMessages(input: {
  topic?: string
  script?: string
  style?: string
}): ChatMessage[]
export declare function parseVisualSetting(content: string): VisualSetting
export declare function combineImagePrompt(anchor: string | null | undefined, shotPrompt: string | null | undefined): string
export declare function parseShots(content: string): ParsedShots
export declare function sanitizeImagePrompt(value: unknown): string
export declare function describeUpstreamError(status: number, rawBody: unknown): string
