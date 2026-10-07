/**
 * 配图缓存。
 *
 * 上游返回的图片要么是临时 URL（百炼 24h、dall-e 60 分钟），要么是 base64
 * （gpt-image 系列）。两种都立刻落盘换成稳定的本地地址，避免过期后图片消失。
 *
 * 缓存键基于「服务商 + 模型 + 尺寸 + 提示词」，所以同一条提示词重复生成会直接命中缓存
 * —— 这是真实的省钱行为，而不只是加速。
 */
import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'

import { isMetadataHost } from '../shared/endpoint.mjs'

// 自己算项目根，不 import app.mjs —— 否则两边会形成循环依赖
const PROJECT_ROOT = path.resolve(import.meta.dirname, '..')

/** 单张图上限，防止上游返回异常大的内容把磁盘写满 */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024

const DEFAULT_MAX_FILES = 300
const DEFAULT_MAX_AGE_DAYS = 14

/** 缓存文件名：40 位 hex + .png，同时用于白名单校验（挡路径穿越） */
const CACHE_FILE_RE = /^[a-f0-9]{16,64}\.png$/

/**
 * 缓存目录优先级：
 *   1. STORYBOARD_IMAGE_CACHE_DIR（Electron 注入 userData，规避安装目录只读）
 *   2. 项目根下的 .cache/images
 *
 * 选 .cache 而不是 server/cache：打包脚本只复制/清理 dist server shared electron，
 * 所以 .cache 既不会进产物、也不会在重新打包时被误删。
 */
export function imageCacheDir() {
  const override = String(process.env.STORYBOARD_IMAGE_CACHE_DIR ?? '').trim()
  return override || path.join(PROJECT_ROOT, '.cache', 'images')
}

export function isSafeCacheFile(name) {
  return CACHE_FILE_RE.test(String(name ?? ''))
}

export function imageCachePath(name) {
  return path.join(imageCacheDir(), name)
}

export function imageCacheUrl(name) {
  return `/api/image-cache/${name}`
}

/**
 * 生成缓存键。正常路径不加盐 —— 同提示词命中同一文件，直接省掉一次计费；
 * 「换一张」会传 salt（时间戳），落到新文件上且不覆盖旧图，
 * 否则长缓存会一直返回旧图片。
 *
 * referenceKey 是参考图指纹：同一句提示词配上不同的角色/场景参考图，
 * 出图结果本来就不同，不能算同一次请求。
 */

export function imageCacheKey({ provider, model, size, prompt, referenceKey, salt }) {
  const material = [provider, model, size, prompt, referenceKey, salt].map((v) => String(v ?? '')).join('|')
  return `${crypto.createHash('sha256').update(material).digest('hex').slice(0, 40)}.png`
}

export async function imageCacheExists(name) {
  if (!isSafeCacheFile(name)) return false
  try {
    const stat = await fsp.stat(imageCachePath(name))
    return stat.isFile() && stat.size > 0
  } catch {
    return false
  }
}

/** 原子落盘：先写临时文件再 rename，避免读到写了一半的图 */
async function writeAtomic(name, buffer) {
  const dir = imageCacheDir()
  await fsp.mkdir(dir, { recursive: true })
  const target = path.join(dir, name)
  const temp = `${target}.${process.pid}.tmp`
  await fsp.writeFile(temp, buffer)
  await fsp.rename(temp, target)
}

/**
 * 图片下载的地址校验。
 *
 * 与文本侧不同：这里**允许内网 / 回环地址**，因为本机 OpenAI 兼容服务
 * 返回的图片就在 127.0.0.1。但云元数据地址一律拒绝——那是拿服务器凭证的经典路径。
 */
export function assertSafeImageUrl(raw) {
  let url
  try {
    url = new URL(String(raw))
  } catch {
    throw new Error('图片地址不是合法的 URL。')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('图片地址只支持 http / https 协议。')
  }
  if (url.username || url.password) {
    throw new Error('图片地址不能包含用户名或密码。')
  }
  if (isMetadataHost(url.hostname)) {
    throw new Error('出于安全考虑，禁止访问云元数据地址。')
  }
  return url.toString()
}

/** 下载远程图片并落盘 */
export async function saveImageFromUrl(remoteUrl, name, { signal } = {}) {
  const safeUrl = assertSafeImageUrl(remoteUrl)

  const res = await fetch(safeUrl, { signal, redirect: 'manual' })
  if (!res.ok) throw new Error(`下载图片失败（HTTP ${res.status}）。`)

  const contentType = res.headers.get('content-type') ?? ''
  if (!contentType.startsWith('image/')) {
    throw new Error(`上游返回的不是图片（content-type: ${contentType || '未知'}）。`)
  }

  const length = Number(res.headers.get('content-length') ?? 0)
  if (length > MAX_IMAGE_BYTES) throw new Error('图片体积超出上限（20MB）。')

  const buffer = Buffer.from(await res.arrayBuffer())
  if (buffer.byteLength > MAX_IMAGE_BYTES) throw new Error('图片体积超出上限（20MB）。')
  if (buffer.byteLength === 0) throw new Error('下载到的图片是空的。')

  await writeAtomic(name, buffer)
  return name
}

/** 把 base64 直接落盘（gpt-image 系列只返回 base64，没有可下载的地址） */
export async function saveImageFromBase64(base64, name) {
  const cleaned = String(base64 ?? '').replace(/^data:image\/\w+;base64,/, '')
  if (!cleaned) throw new Error('图片数据为空。')

  const buffer = Buffer.from(cleaned, 'base64')
  if (buffer.byteLength === 0) throw new Error('图片数据解码后为空。')
  if (buffer.byteLength > MAX_IMAGE_BYTES) throw new Error('图片体积超出上限（20MB）。')

  await writeAtomic(name, buffer)
  return name
}

let pruning = false

/**
 * 清理缓存：超过数量上限时删最旧的，超过保留天数的也删掉。
 * 带重入保护 —— 每次写入都会触发一次，并发写时不重复扫描。
 */
export async function pruneImageCache() {
  if (pruning) return
  pruning = true
  try {
    const dir = imageCacheDir()
    let files
    try {
      files = await fsp.readdir(dir)
    } catch {
      return // 目录还不存在
    }

    const maxFiles = Number(process.env.STORYBOARD_IMAGE_CACHE_MAX_FILES ?? '') || DEFAULT_MAX_FILES
    const maxAgeDays = Number(process.env.STORYBOARD_IMAGE_CACHE_MAX_AGE_DAYS ?? '') || DEFAULT_MAX_AGE_DAYS

    const entries = []
    for (const file of files) {
      if (!isSafeCacheFile(file)) {
        // 顺手清掉写残留的临时文件
        if (file.includes('.tmp')) await fsp.rm(path.join(dir, file), { force: true })
        continue
      }
      try {
        const stat = await fsp.stat(path.join(dir, file))
        entries.push({ file, mtime: stat.mtimeMs })
      } catch {
        /* 已被并发删除，忽略 */
      }
    }

    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
    const expired = entries.filter((e) => e.mtime < cutoff)

    entries.sort((a, b) => b.mtime - a.mtime) // 新的在前
    const overflow = entries.slice(Math.max(maxFiles, 0))

    const doomed = new Set([...expired, ...overflow].map((e) => e.file))
    for (const file of doomed) {
      await fsp.rm(path.join(dir, file), { force: true })
    }
  } catch (err) {
    console.error('[image-cache] 清理失败', err)
  } finally {
    pruning = false
  }
}
