import { CapacitorHttp } from '@capacitor/core'

import { IS_NATIVE } from './platform'
import type { GeneratePhase, GenerateProgress } from './progress'
import { loadSettings, type Settings } from './settings'
import type { GenerateResult, ImageAdapterMeta, Shot } from './types'
import { applyCompatStep, COMPAT_STEPS, nextCompatibilityStep, type CompatStep } from '../../shared/compat.mjs'
import { normalizeBaseUrl } from '../../shared/endpoint.mjs'
import { describeImageError, getImageAdapter, listImageAdapters } from '../../shared/image-adapters.mjs'
import {
  buildMessages,
  combineImagePrompt,
  describeUpstreamError,
  parseShots,
  SAMPLING_PARAMS,
  DEFAULT_BASE_URL,
  type PartialShot,
  type VisualSetting,
} from '../../shared/prompt.mjs'

export interface GeneratePayload {
  topic: string
  script: string
  style: string
  /** 统一视觉设定（视觉圣经）。分镜出完后产出，配图时拼到每条提示词前。 */
  visualSetting?: VisualSetting | null
  /** 界面「设置」里配置的项。不传则服务端用自己的默认值。 */
  model?: string
  baseUrl?: string
  apiKey?: string
}

/**
 * 生成统一视觉设定的入参。
 * **不带分镜** —— 设定先行，此时还没有分镜可参考。
 */
export interface VisualSettingPayload {
  topic: string
  script: string
  style: string
}

/** 生成统一视觉设定：调用服务端 /api/visual-setting，返回结构化设定（含英文锚定提示词） */
export async function generateVisualSetting(payload: VisualSettingPayload): Promise<VisualSetting> {
  // 与 generateStoryboard 一样要把界面里填的配置带上，否则服务端只能读自己的 .env
  const settings = await loadSettings()
  const res = await fetch('/api/visual-setting', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      topic: payload.topic,
      script: payload.script,
      style: payload.style,
      model: settings.model,
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
    }),
  })
  if (!res.ok) await readError(res, `生成视觉设定失败（HTTP ${res.status}）`)
  const data = (await res.json()) as { ok: boolean; visualSetting: VisualSetting }
  return data.visualSetting
}

/** 把统一视觉设定的锚定提示词拼到单条分镜提示词前，整组画面更统一 */
export function buildImagePrompt(setting: VisualSetting | null | undefined, shotImagePrompt: string): string {
  return combineImagePrompt(setting?.imageAnchor, shotImagePrompt)
}

export interface GenerateOptions {
  /** 真实阶段回调。网页/桌面端由服务端 SSE 推送；APK 不传，由本地估算时间表驱动 */
  onPhase?: (phase: GeneratePhase) => void
  /** 条数进度回调。网页/桌面是流式解析的真实值；APK 是本地估算值（shots 恒为空） */
  onProgress?: (progress: GenerateProgress) => void
  /** 用于取消生成（APK 的原生请求无法中止，见 generateNative 注释） */
  signal?: AbortSignal
}

async function readError(res: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const data = await res.json()
    if (data?.error) message = String(data.error)
  } catch {
    /* 响应体不是 JSON，保留默认文案 */
  }
  throw new Error(message)
}

export async function generateStoryboard(
  payload: GeneratePayload,
  options: GenerateOptions = {},
): Promise<GenerateResult> {
  const settings = await loadSettings()
  return IS_NATIVE
    ? generateNative(payload, settings)
    : generateViaServer(payload, settings, options)
}

/**
 * Web / 桌面：消费 /api/generate-stream 的 SSE，拿到服务端推送的真实阶段信号。
 * 界面里配置的 Key / 接口地址 / 模型一并带上，服务端不再只能读自己的 .env。
 *
 * 注意不能用 EventSource：它只支持 GET，带不了 POST body。
 */
async function generateViaServer(
  payload: GeneratePayload,
  settings: Settings,
  options: GenerateOptions = {},
): Promise<GenerateResult> {
  const { onPhase, onProgress, signal } = options

  const res = await fetch('/api/generate-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({
      ...payload,
      model: settings.model,
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
    }),
    signal,
  })

  // 前置校验（空输入 / 缺 Key）仍以普通 JSON + 非 2xx 返回
  if (!res.ok) await readError(res, `生成失败（HTTP ${res.status}）`)

  const contentType = res.headers.get('content-type') ?? ''
  // 服务端不支持 SSE（代理剥离 / 旧版本）时降级为一次性 JSON
  if (!res.body || !contentType.includes('text/event-stream')) {
    const data = (await res.json()) as GenerateResult & { error?: string }
    if (data.error) throw new Error(String(data.error))
    return normalize(data)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  // 先收原始 done 载荷，normalize 放到 try 之外执行 —— 它对 refused / 空结果
  // 抛出的中文提示不能被下面的网络异常分支吞掉
  let raw: (GenerateResult & { refused?: string | null }) | null = null
  let failure: Error | null = null

  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const frames = buffer.split(/\r?\n\r?\n/)
      buffer = frames.pop() ?? ''

      for (const frame of frames) {
        let event = 'message'
        const dataLines: string[] = []

        for (const line of frame.split('\n')) {
          if (line.startsWith(':')) continue // 心跳注释
          if (line.startsWith('event:')) event = line.slice(6).trim()
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''))
        }
        if (dataLines.length === 0) continue

        let body: Record<string, unknown>
        try {
          body = JSON.parse(dataLines.join('\n'))
        } catch {
          continue
        }

        if (event === 'phase' && body.phase) {
          onPhase?.(body.phase as GeneratePhase)
        } else if (event === 'progress') {
          const completed = Number(body.completed)
          const total = Number(body.total)
          const shots = Array.isArray(body.shots) ? (body.shots as PartialShot[]) : []
          if (Number.isFinite(completed) && Number.isFinite(total)) {
            onProgress?.({ completed, total, shots })
          }
        } else if (event === 'done') {
          if (body.error) failure = new Error(String(body.error))
          else raw = body as unknown as GenerateResult & { refused?: string | null }
        } else if (event === 'error') {
          failure = new Error(String(body.error ?? '生成失败，请重试。'))
        }
      }
    }
  } catch (err) {
    // 用户取消：原样抛出，由调用方识别 AbortError
    if ((err as DOMException)?.name === 'AbortError') throw err
    throw new Error('与服务器的连接中断，请重试。')
  }

  if (failure) throw failure
  if (!raw) throw new Error('服务器没有返回分镜结果，请重试。')
  return normalize(raw)
}

/** APK：用原生 HTTP 直连模型服务，绕过 WebView 的 CORS 限制 */
async function generateNative(payload: GeneratePayload, settings: Settings): Promise<GenerateResult> {
  if (!settings.apiKey) throw new Error('请先在设置里填写 API Key。')

  const res = await postWithCompatibilityNative(chatCompletionsUrl(settings.baseUrl), settings.apiKey, {
    model: settings.model,
    messages: buildMessages(payload),
    ...SAMPLING_PARAMS,
  })

  if (res.status < 200 || res.status >= 300) {
    throw new Error(describeUpstreamError(res.status, JSON.stringify(res.data ?? '')))
  }

  const content = res.data?.choices?.[0]?.message?.content ?? ''
  const parsed = parseShots(content)
  if (parsed.refused) throw new Error(parsed.refused)

  return {
    model: res.data?.model ?? settings.model,
    usage: res.data?.usage ?? null,
    shots: parsed.shots,
  }
}

/** 用最小请求验证配置是否可用。只需要连接三项，不关心图片配置。 */
export async function testConnection(settings: {
  apiKey: string
  baseUrl: string
  model: string
}): Promise<void> {
  if (!settings.apiKey) throw new Error('请先填写 API Key。')

  if (IS_NATIVE) {
    const res = await CapacitorHttp.post({
      url: chatCompletionsUrl(settings.baseUrl),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
      data: { model: settings.model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 },
    })
    if (res.status < 200 || res.status >= 300) {
      throw new Error(describeUpstreamError(res.status, JSON.stringify(res.data ?? '')))
    }
    return
  }

  const res = await fetch('/api/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
  if (!res.ok) await readError(res, `连接测试失败（HTTP ${res.status}）`)
}

/** 拼出完整的 chat/completions 地址；baseUrl 为空时回落默认值 */
function chatCompletionsUrl(baseUrl: string): string {
  const base = normalizeBaseUrl(baseUrl) || DEFAULT_BASE_URL
  return `${base}/chat/completions`
}

/**
 * 原生请求的参数兼容降级：部分服务不支持 response_format，
 * 命中就逐级去掉可选参数重试。CapacitorHttp 不支持流式，所以不会走到 no-stream。
 */
async function postWithCompatibilityNative(
  url: string,
  apiKey: string,
  baseBody: Record<string, unknown>,
): Promise<Awaited<ReturnType<typeof CapacitorHttp.post>>> {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }
  let step: CompatStep = COMPAT_STEPS.FULL
  let res = await CapacitorHttp.post({ url, headers, data: applyCompatStep(baseBody, step) })

  for (let attempt = 0; attempt < 2 && (res.status < 200 || res.status >= 300); attempt += 1) {
    const next = nextCompatibilityStep(step, {
      status: res.status,
      bodyText: JSON.stringify(res.data ?? ''),
      streamCapable: false,
    })
    if (!next) break
    step = next
    res = await CapacitorHttp.post({ url, headers, data: applyCompatStep(baseBody, step) })
  }

  return res
}

/** 配图请求：只走服务端（手机端不支持配图，那边没有缓存能力） */
export interface ImagePayload {
  provider: string
  prompt: string
  baseUrl: string
  apiKey: string
  model: string
  size?: string
  /**
   * 参考图（本地缓存 URL 列表）。服务端会转成 data URL 传给上游做主体一致性；
   * 不支持参考图的服务商会忽略它。
   */
  referenceImages?: string[]
  /**
   * 单张超时（毫秒）。留空由服务端按服务商给默认值。
   * 云端模型在高峰期会明显变慢，这个值是给用户兜底的。
   */
  timeoutMs?: number
  /** true 表示「换一张」：跳过缓存并另存新图，会重新计费 */
  force?: boolean
}

export interface ImageResult {
  url: string
  cached: boolean
  provider: string
  model: string
}

/** 为一条分镜生成配图。网页/桌面走服务端（会落盘缓存），手机端直连图片服务。 */
export async function generateImage(payload: ImagePayload, signal?: AbortSignal): Promise<ImageResult> {
  if (IS_NATIVE) return generateImageNative(payload)
  const res = await fetch('/api/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  })
  if (!res.ok) await readError(res, `生成配图失败（HTTP ${res.status}）`)
  return (await res.json()) as ImageResult
}

/**
 * 手机端直连图片服务。
 *
 * 没有服务端可做下载缓存，只能用模型返回的临时链接（百炼 24 小时、OpenAI 60 分钟），
 * 过期后图片会显示不出来 —— 界面上要如实提示用户及时导出。
 * gpt-image 系列只返回 base64，这里转成 dataURL 直接给 <img> 用。
 */
async function generateImageNative(payload: ImagePayload): Promise<ImageResult> {
  const adapter = getImageAdapter(payload.provider)
  if (!adapter || adapter.kind !== 'sync' || adapter.nativeSupported === false) {
    throw new Error('该图片服务在手机端不可用，请在设置里换一个。')
  }

  const spec = adapter.buildRequest({ prompt: payload.prompt, model: payload.model, size: payload.size })
  const base = normalizeBaseUrl(payload.baseUrl) || adapter.defaultBaseUrl
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (adapter.needsKey && payload.apiKey) headers.Authorization = `Bearer ${payload.apiKey}`

  const res = await CapacitorHttp.post({
    url: `${base}${spec.path}`,
    headers,
    data: spec.body,
    connectTimeout: 30_000,
    readTimeout: 180_000,
  })

  if (res.status < 200 || res.status >= 300) {
    const raw = typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? {})
    throw new Error(describeImageError(adapter.id, res.status, raw))
  }

  let body = res.data
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body)
    } catch {
      throw new Error('图片服务返回了非 JSON 内容。')
    }
  }

  const images = adapter.extractImages(body)
  if (images.length === 0) throw new Error('图片服务没有返回图片，请重试。')

  const first = images[0]
  const url = first.base64 ? `data:image/png;base64,${first.base64}` : String(first.url ?? '')
  if (!url) throw new Error('图片服务没有返回可用的图片地址。')

  // 手机端没有缓存与去重，cached 恒为 false
  return { url, cached: false, provider: adapter.id, model: payload.model }
}

/** 取图片适配器元数据。APK 没有服务端，所以直接用 shared 里的定义。 */
export function listImageAdaptersForUi(native: boolean): ImageAdapterMeta[] {
  return listImageAdapters({ native }) as ImageAdapterMeta[]
}

function normalize(data: GenerateResult & { refused?: string | null }): GenerateResult {
  if (data.refused) throw new Error(data.refused)
  const shots: Shot[] = Array.isArray(data.shots) ? data.shots : []
  if (shots.length === 0) throw new Error('模型没有返回有效的分镜内容，请重试。')
  return { ...data, shots }
}
