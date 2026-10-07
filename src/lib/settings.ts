import { Preferences } from '@capacitor/preferences'

import { hostOf, normalizeBaseUrl } from '../../shared/endpoint.mjs'
import { getImageAdapter, isAdapterAvailableOn, normalizeStoredSize } from '../../shared/image-adapters.mjs'
import { DEFAULT_BASE_URL } from '../../shared/prompt.mjs'
import { IS_DESKTOP, IS_NATIVE } from './platform'

/** 单个图片服务商的配置。每家各存一套，切换服务商时自动带出。 */
export interface ImageProviderConfig {
  baseUrl: string
  apiKey: string
  model: string
  /**
   * 单张图超时（**秒**）。留空用适配器默认。
   *
   * 存的就是设置页里用户看到的那个单位，只在真正发请求时转成毫秒
   * （见 imageTimeoutMs）—— 之前存秒当毫秒用，等于把超时取消掉了。
   */
  timeoutSeconds?: number
  /** 尺寸覆盖，留空用适配器默认 */
  size?: string
}

export interface Settings {
  apiKey: string
  /** OpenAI 兼容的接口根地址，不含结尾斜杠、不含 /chat/completions */
  baseUrl: string
  model: string
  /** 当前选中的图片服务商 id。配图由用户在结果区主动触发，不做自动生成 */
  imageProvider: string
  /** 每家一套图片配置 */
  imageConfigs: Record<string, ImageProviderConfig>
}

export const DEFAULT_IMAGE_PROVIDER = 'bailian'

/** 某服务商的初始配置，取自适配器定义的默认值 */
export function defaultImageConfig(providerId: string): ImageProviderConfig {
  const adapter = getImageAdapter(providerId)
  return {
    baseUrl: adapter?.defaultBaseUrl ?? '',
    apiKey: '',
    model: adapter?.defaultModel ?? '',
    size: adapter?.defaultSize ?? '',
  }
}

/** 正数才算「填了」；空值、0、NaN、负数一律当作没填 */
function toPositiveNumber(value: unknown): number | undefined {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/**
 * 单张图超时：设置里存秒，发给服务端的是毫秒。
 *
 * 换算只在这一处做 —— 之前 UI 按秒收、字段按毫秒命名、服务端按毫秒用，
 * 三个环节各差一点，结果填 180（秒）变成 180 毫秒，请求刚发出去就被掐断。
 */
export function imageTimeoutMs(config: ImageProviderConfig | undefined): number | undefined {
  const seconds = toPositiveNumber(config?.timeoutSeconds)
  return seconds === undefined ? undefined : Math.round(seconds * 1000)
}

/**
 * 解析某套图片配置实际要用的 Key。
 *
 * 图片 Key 留空时复用文本模型的 Key —— 但**只在两者指向同一个服务时**才允许：
 * 把 A 家的 Key 发给 B 家，上游只会回一个让人摸不着头脑的 401。
 * 地址不同又没填图片 Key 时返回空串，由调用方提示去补这个服务的 Key。
 */
export function resolveImageApiKey(settings: Settings, config: ImageProviderConfig | undefined): string {
  const own = String(config?.apiKey ?? '').trim()
  if (own) return own
  const host = hostOf(config?.baseUrl ?? '')
  return host !== '' && host === hostOf(settings.baseUrl) ? settings.apiKey : ''
}

/**
 * 默认配置。
 *
 * 刻意**不提供「构建期注入 API Key」的机制** —— 那种做法的代价是把 Key 编进前端产物，
 * 一旦安装包或构建结果流出去，Key 就跟着泄露了（还会被平台的密钥扫描盯上并吊销）。
 * 需要预置默认值请走**服务端**读 .env（见 server/app.mjs），那份配置不会被分发出去。
 */
export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  baseUrl: DEFAULT_BASE_URL,
  model: 'qwen-plus',
  imageProvider: DEFAULT_IMAGE_PROVIDER,
  imageConfigs: { [DEFAULT_IMAGE_PROVIDER]: defaultImageConfig(DEFAULT_IMAGE_PROVIDER) },
}

// 通用键名
const KEY_API_KEY = 'storyboard_api_key'
const KEY_BASE_URL = 'storyboard_base_url'
const KEY_MODEL = 'storyboard_model'
const KEY_IMAGE_PROVIDER = 'storyboard_image_provider'
const KEY_IMAGE_CONFIGS = 'storyboard_image_configs'

// 早期版本用的是绑定百炼的键名，只读兼容，避免老用户配置丢失
const LEGACY_KEY_API_KEY = 'dashscope_api_key'
const LEGACY_KEY_MODEL = 'dashscope_model'

/** 桌面端写入 userData/config.json，由 Electron 主进程同步给内嵌后端 */
async function readLocal(key: string): Promise<string | null> {
  if (IS_NATIVE) return (await Preferences.get({ key })).value
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

async function writeLocal(key: string, value: string): Promise<void> {
  if (IS_NATIVE) {
    await Preferences.set({ key, value })
    return
  }
  try {
    localStorage.setItem(key, value)
  } catch {
    /* 隐私模式下 localStorage 可能不可写，忽略 */
  }
}

/** 先读新键，没有再回落到旧键 */
async function readWithLegacy(key: string, legacyKey?: string): Promise<string | null> {
  const value = await readLocal(key)
  if (value) return value
  return legacyKey ? readLocal(legacyKey) : null
}

function resolveBaseUrl(raw: string | null | undefined): string {
  return normalizeBaseUrl(raw || '') || DEFAULT_BASE_URL
}


/**
 * 需要持久化的字符串字段白名单。
 * 给 ImageProviderConfig 新增字符串字段时必须同步加到这里，否则会出现
 * 「界面能改、刷新即丢」这种事之前踩过一次，所以用白名单挡住。
 */
const PERSIST_STRING_KEYS = [
  'baseUrl',
  'apiKey',
  'model',
  'size',
] as const

/** 解析存下来的 JSON；坏了就返回空对象，不让一条脏数据毁掉整个设置 */
function parseImageConfigs(raw: string | null | undefined): Record<string, ImageProviderConfig> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, ImageProviderConfig> = {}
    for (const [id, cfg] of Object.entries(parsed)) {
      if (!cfg || typeof cfg !== 'object') continue
      const value = cfg as Partial<ImageProviderConfig>
      // 逐字段手写很容易漏，改成按白名单挑：以后给 ImageProviderConfig
      // 加字符串字段，必须同时加进 PERSIST_STRING_KEYS。
      const picked: Record<string, string | undefined> = {}
      for (const key of PERSIST_STRING_KEYS) {
        const field = (value as Record<string, unknown>)[key]
        picked[key] = field === undefined || field === null ? undefined : String(field)
      }
      out[id] = {
        baseUrl: picked.baseUrl ?? '',
        apiKey: picked.apiKey ?? '',
        model: picked.model ?? '',
        // 空值与已下线的方图在读取时就收敛，设置页下拉才不会停在无效选项上
        size: normalizeStoredSize(id, picked.size),
        // 超时是数字，单独转换；非法值丢掉让它回落默认。
        // 老版本存的 timeoutMs 直接忽略：那个字段当年按秒写、按毫秒用，
        // 从来没生效过，重新落到默认值比沿用脏数据更靠谱。
        timeoutSeconds: toPositiveNumber(value.timeoutSeconds),
      } as ImageProviderConfig
    }
    return out
  } catch {
    return {}
  }
}

export async function loadSettings(): Promise<Settings> {
  const finish = (
    apiKey: string | null | undefined,
    baseUrl: string | null | undefined,
    model: string | null | undefined,
    rawImageProvider: string | null | undefined,
    rawImageConfigs: string | null | undefined,
  ): Settings => {
    // 服务商必须在当前平台可用：在手机端不可用的要回落，
    // 否则设置页会显示一个手机端根本跑不了的服务
    const stored = parseImageConfigs(rawImageConfigs)
    const candidate = getImageAdapter(rawImageProvider) ? String(rawImageProvider) : DEFAULT_IMAGE_PROVIDER
    const imageProvider = isAdapterAvailableOn(candidate, { native: IS_NATIVE }) ? candidate : DEFAULT_IMAGE_PROVIDER

    return {
      apiKey: String(apiKey ?? ''),
      baseUrl: resolveBaseUrl(baseUrl),
      model: model || DEFAULT_SETTINGS.model,
      imageProvider,
      // 当前选中的那家必须存在，否则补上默认值
      imageConfigs: { ...stored, [imageProvider]: stored[imageProvider] ?? defaultImageConfig(imageProvider) },
    }
  }

  if (IS_DESKTOP && window.electronAPI) {
    try {
      const s = await window.electronAPI.getSettings()
      return finish(s.apiKey, s.baseUrl, s.model, s.imageProvider, s.imageConfigs)
    } catch {
      /* 桥接不可用时退回本地存储 */
    }
  }

  const [apiKey, baseUrl, model, imageProvider, imageConfigs] = await Promise.all([
    readWithLegacy(KEY_API_KEY, LEGACY_KEY_API_KEY),
    readWithLegacy(KEY_BASE_URL),
    readWithLegacy(KEY_MODEL, LEGACY_KEY_MODEL),
    readLocal(KEY_IMAGE_PROVIDER),
    readLocal(KEY_IMAGE_CONFIGS),
  ])
  return finish(apiKey, baseUrl, model, imageProvider, imageConfigs)
}

export async function saveSettings(settings: Settings): Promise<void> {
  const candidate = getImageAdapter(settings.imageProvider) ? settings.imageProvider : DEFAULT_IMAGE_PROVIDER
  const imageProvider = isAdapterAvailableOn(candidate, { native: IS_NATIVE }) ? candidate : DEFAULT_IMAGE_PROVIDER

  const next: Settings = {
    apiKey: settings.apiKey.trim(),
    baseUrl: resolveBaseUrl(settings.baseUrl),
    model: settings.model.trim() || DEFAULT_SETTINGS.model,
    imageProvider,
    imageConfigs: settings.imageConfigs ?? {},
  }

  const serialized = {
    ...next,
    imageConfigs: JSON.stringify(next.imageConfigs),
  }

  if (IS_DESKTOP && window.electronAPI) {
    try {
      await window.electronAPI.saveSettings(serialized)
    } catch {
      /* 忽略桥接失败 */
    }
  }
  await Promise.all([
    writeLocal(KEY_API_KEY, next.apiKey),
    writeLocal(KEY_BASE_URL, next.baseUrl),
    writeLocal(KEY_MODEL, next.model),
    writeLocal(KEY_IMAGE_PROVIDER, serialized.imageProvider),
    writeLocal(KEY_IMAGE_CONFIGS, serialized.imageConfigs),
  ])
}

