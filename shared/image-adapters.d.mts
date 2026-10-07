export interface ImageSizeOption {
  value: string
  label: string
}

/** 提取出的图片：可能是一个远程地址，也可能是 base64（gpt-image 系列只给 base64） */
export interface ExtractedImage {
  url?: string
  base64?: string
}

export interface BuildRequestParams {
  prompt: string
  model?: string
  size?: string
  /**
   * 参考图（已转成 data URL）。
   * 百炼的图像编辑模式支持最多 4 张输入图，官方用途写明「主体一致性生成」——
   * 角色 / 场景参考图就是靠它来锁住整组画面一致性的。
   */
  referenceImages?: string[]
}

interface AdapterBase {
  id: string
  label: string
  needsKey: boolean
  defaultBaseUrl: string
  defaultModel: string
  models: string[]
  defaultSize: string
  sizeOptions: ImageSizeOption[]
  /** 这家最多接受几张参考图（0 表示不支持） */
  maxReferenceImages?: number
  baseUrlHint?: string
  /** 手机端是否提供该服务商 */
  nativeSupported?: boolean
}

/** 一次请求拿到结果（百炼通义万相、OpenAI 兼容） */
export interface SyncImageAdapter extends AdapterBase {
  kind: 'sync'
  buildRequest(p: BuildRequestParams): { path: string; body: Record<string, unknown> }
  extractImages(payload: unknown): ExtractedImage[]
}

export type ImageAdapter = SyncImageAdapter

export declare const IMAGE_ADAPTERS: Record<string, ImageAdapter>
export declare const IMAGE_PROVIDER_IDS: string[]
export declare function getImageAdapter(id: unknown): ImageAdapter | null
export declare function listImageAdapters(options?: { native?: boolean }): (AdapterBase & {
  kind: 'sync'
  needsKey: boolean
  nativeSupported: boolean
})[]
export declare function isAdapterAvailableOn(providerId: unknown, options?: { native?: boolean }): boolean
/** 把存下来的尺寸收敛成可用值：只处理空值与已下线的方图，自定义尺寸放行 */
export declare function normalizeStoredSize(adapterId: string, size?: string | null): string
export declare function describeImageError(provider: string, status: number, rawBody: unknown): string
