/**
 * 配图生成编排。
 *
 * 适配器只负责纯数据转换，真正的网络请求、超时、SSRF 校验、落盘都收敛在这里，
 * 这样三家服务商共用同一套错误处理与缓存逻辑，不会出现三份实现漂移。
 */
import crypto from 'node:crypto'
import fsp from 'node:fs/promises'

import { describeImageError, getImageAdapter, normalizeStoredSize } from '../shared/image-adapters.mjs'
import {
  imageCacheExists,
  imageCacheKey,
  imageCachePath,
  imageCacheUrl,
  isSafeCacheFile,
  pruneImageCache,
  saveImageFromBase64,
  saveImageFromUrl,
} from './image-cache.mjs'


/** 上游一次能吞下的参考图上限，防止请求体爆掉 */
const MAX_REFERENCE_IMAGES = 4

/**
 * 把参考图转成上游能接受的 data URL。
 *
 * 参考图存在本地缓存里（/api/image-cache/xxx.png），而上游只认公网 URL 或 base64，
 * 所以这里读盘转一层。**单张读不到就跳过** —— 少一张参考图不该让整张分镜出不来。
 */
async function resolveReferenceImages(urls) {
  const out = []
  for (const url of (Array.isArray(urls) ? urls : []).slice(0, MAX_REFERENCE_IMAGES)) {
    const name = String(url ?? '').split('/').pop() ?? ''
    if (!isSafeCacheFile(name)) continue
    try {
      const buffer = await fsp.readFile(imageCachePath(name))
      out.push(`data:image/png;base64,${buffer.toString('base64')}`)
    } catch {
      // 单张读不到就跳过
    }
  }
  return out
}

/**
 * 参考图指纹，参与缓存键。
 *
 * 参考图变了但分镜提示词没变时（用户点了参考图上的「重新生成这一张」），
 * 键里不含参考图就会直接命中旧缓存、拿回旧图，等于白改。
 * 用缓存文件名的哈希当指纹：文件名本身就是内容哈希，够用且不用读盘。
 */
function referenceFingerprint(urls) {
  const list = (Array.isArray(urls) ? urls : []).map((url) => String(url ?? '')).filter(Boolean)
  if (list.length === 0) return ''
  return crypto.createHash('sha256').update(list.join('|')).digest('hex').slice(0, 16)
}

/** 单张配图的整体超时。图片生成普遍比文本慢得多。 */
export const IMAGE_REQUEST_TIMEOUT_MS = 180_000

/**
 * 单张超时的允许区间（毫秒），与设置页的 30~3600 秒一一对应。
 * 越界只做收敛：小的抬到下限、大的压到上限，而不是丢给上游去撞运气。
 */
export const MIN_IMAGE_TIMEOUT_MS = 30_000
export const MAX_IMAGE_TIMEOUT_MS = 3_600_000

/** 把用户填的超时收敛到合理区间；填了非法值就回落默认值 */
export function normalizeTimeoutMs(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(MAX_IMAGE_TIMEOUT_MS, Math.max(MIN_IMAGE_TIMEOUT_MS, Math.round(n)))
}

/** 带业务错误码的错误，端点据此映射状态码与提示 */
export class ImageError extends Error {
  constructor(message, code, status = 500) {
    super(message)
    this.name = 'ImageError'
    this.code = code
    this.status = status
  }
}

/** 从上游错误里翻译出中文提示，并给出合适的状态码 */
function upstreamError(provider, status, rawBody) {
  const httpStatus = status === 401 || status === 403 ? 401 : status === 429 ? 429 : status === 400 || status === 404 || status === 422 ? 400 : 502
  return new ImageError(describeImageError(provider, status, rawBody), `UPSTREAM_${status}`, httpStatus)
}

/**
 * 网络层异常统一转成可读提示。
 *
 * timeoutSeconds 必须实际传进来 —— 否则把超时调大之后，真正超时的那条消息
 * 仍然说旧数字，跟设置对不上，非常误导。
 */
function networkError(err, baseUrl, timeoutSeconds) {
  if (err?.name === 'AbortError') {
    const limit = timeoutSeconds ? `（>${timeoutSeconds}s）` : ''
    return new ImageError(
      `等待图片服务超时${limit}。云端模型在高峰期会明显变慢，可以把超时调大后重试。`,
      'TIMEOUT',
      504,
    )
  }
  const cause = String(err?.cause?.code ?? err?.code ?? '')
  if (['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ECONNRESET', 'ETIMEDOUT'].includes(cause)) {
    return new ImageError(`连不上图片服务（${baseUrl}）。请确认服务已启动、地址与端口是否正确。`, 'CONNECT_FAILED', 502)
  }
  return new ImageError(`调用图片服务失败：${err?.message ?? err}`, 'IMAGE_ERROR', 500)
}

/** 同步型：一次请求拿到结果 */
async function runSync(adapter, { prompt, baseUrl, apiKey, model, size, referenceImages, timeoutMs, signal }) {
  const spec = adapter.buildRequest({ prompt, model, size, referenceImages })
  const url = `${baseUrl}${spec.path}`

  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(adapter.needsKey && apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(spec.body),
      signal,
      redirect: 'manual',
    })
  } catch (err) {
    throw networkError(err, baseUrl, Math.round(timeoutMs / 1000))
  }

  const raw = await res.text()
  if (!res.ok) throw upstreamError(adapter.id, res.status, raw)

  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    throw new ImageError(`图片服务返回了非 JSON 内容：${raw.slice(0, 200)}`, 'BAD_UPSTREAM_JSON', 502)
  }

  const images = adapter.extractImages(payload)
  if (images.length === 0) {
    throw new ImageError('图片服务没有返回图片，请重试。', 'NO_IMAGE', 502)
  }
  return images[0]
}

/**
 * 为一条分镜生成配图。
 *
 * @returns {Promise<{ url: string, cached: boolean, provider: string, model: string }>}
 */
export async function generateImageForShot({
  provider,
  prompt,
  baseUrl,
  apiKey,
  model,
  size,
  /** 参考图（本地缓存 URL 列表），会转成 data URL 传给上游做主体一致性 */
  referenceImages,
  /** 单张超时（毫秒）。留空用默认值 */
  timeoutMs,
  force = false,
}) {
  const text = String(prompt ?? '').trim()
  if (!text) throw new ImageError('这条分镜没有画面提示词，无法生成配图。', 'EMPTY_PROMPT', 400)

  const adapter = getImageAdapter(provider)
  if (!adapter) throw new ImageError(`不支持的图片服务商：${provider}`, 'UNKNOWN_PROVIDER', 400)

  const origin = String(baseUrl ?? '').trim()
  if (!origin) throw new ImageError('没有配置图片服务的接口地址。', 'BAD_BASE_URL', 400)

  if (adapter.needsKey && !String(apiKey ?? '').trim()) {
    throw new ImageError('尚未配置图片模型 API Key。请在「设置 → 图片模型」填写。', 'MISSING_IMAGE_KEY', 500)
  }

  const effectiveModel = String(model ?? '').trim() || adapter.defaultModel
  // 空值与已下线的方图收敛回该家默认。放在服务端是做双保险 ——
  // 前端漏了也好、直接打接口也好，脏尺寸都到不了上游
  const effectiveSize = normalizeStoredSize(adapter.id, size)
  const effectiveTimeoutMs = normalizeTimeoutMs(timeoutMs, IMAGE_REQUEST_TIMEOUT_MS)

  // 未点「换一张」时先查缓存 —— 命中即返回，真实省掉一次计费
  const key = imageCacheKey({
    provider: adapter.id,
    model: effectiveModel,
    size: effectiveSize,
    prompt: text,
    referenceKey: referenceFingerprint(referenceImages),
    salt: force ? String(Date.now()) : '',
  })
  if (!force && (await imageCacheExists(key))) {
    return { url: imageCacheUrl(key), cached: true, provider: adapter.id, model: effectiveModel }
  }

  // 参考图：本地缓存路径 → data URL。服务商不支持就不白读一遍盘。
  // 读失败的单张会被丢掉，不影响整张出图
  const resolvedReferences =
    (adapter.maxReferenceImages ?? 0) > 0 ? await resolveReferenceImages(referenceImages) : []

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), effectiveTimeoutMs)

  try {
    const result = await runSync(adapter, {
      prompt: text,
      baseUrl: origin,
      apiKey,
      model: effectiveModel,
      size: effectiveSize,
      referenceImages: resolvedReferences,
      timeoutMs: effectiveTimeoutMs,
      signal: controller.signal,
    })

    try {
      if (result.base64) await saveImageFromBase64(result.base64, key)
      else await saveImageFromUrl(result.url ?? result.viewUrl, key, { signal: controller.signal })
    } catch (err) {
      // 已经生成出来了但没存下来，属于可重试的中间态
      throw new ImageError(`图片已生成但保存失败：${err?.message ?? err}`, 'SAVE_FAILED', 502)
    }

    void pruneImageCache() // 写入后顺手清理，不阻塞响应
    return { url: imageCacheUrl(key), cached: false, provider: adapter.id, model: effectiveModel }
  } finally {
    clearTimeout(timer)
  }
}
