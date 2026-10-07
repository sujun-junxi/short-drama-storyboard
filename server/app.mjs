import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import dns from 'node:dns/promises'
import { isIP } from 'node:net'
import dotenv from 'dotenv'

import { applyCompatStep, COMPAT_STEPS, nextCompatibilityStep } from '../shared/compat.mjs'
import { isMetadataHost, isPrivateHostname, normalizeBaseUrl } from '../shared/endpoint.mjs'
import { ImageError, generateImageForShot } from './image.js'
import { imageCacheDir, isSafeCacheFile, pruneImageCache } from './image-cache.mjs'
import {
  buildMessages,
  buildVisualSettingMessages,
  parseShots,
  parseCompletedShots,
  parseVisualSetting,
  describeUpstreamError,
  MODEL_OPTIONS,
  SHOT_TYPES,
  SHOT_COUNT,
  SAMPLING_PARAMS,
  DEFAULT_BASE_URL,
} from '../shared/prompt.mjs'

export const PROJECT_ROOT = path.resolve(import.meta.dirname, '..')

const REQUEST_TIMEOUT_MS = 120_000

// 按优先级合并 .env 与 .env.local（后者覆盖前者）。
// 每次调用都比对文件 mtime，因此改完 Key 无需重启服务。
const ENV_FILES = ['.env', '.env.local'].map((name) => path.join(PROJECT_ROOT, name))
let envCache = { sig: '', values: {} }

export function envValues() {
  const sig = ENV_FILES.map((p) => {
    try {
      return `${p}:${fs.statSync(p).mtimeMs}`
    } catch {
      return `${p}:-`
    }
  }).join('|')

  if (sig !== envCache.sig) {
    const merged = {}
    for (const p of ENV_FILES) {
      try {
        Object.assign(merged, dotenv.parse(fs.readFileSync(p)))
      } catch {
        /* 文件不存在时跳过 */
      }
    }
    envCache = { sig, values: merged }
  }
  return envCache.values
}

/**
 * 创建 Express 应用。
 * @param {{ serveStatic?: boolean }} options serveStatic 为真时托管 dist 并回退到 index.html
 */
export function createApp({ serveStatic = false } = {}) {
  const app = express()
  // 不信任 X-Forwarded-For：SSRF 防护依赖真实的 req.ip 判断是否回环来源
  app.set('trust proxy', false)
  app.use(express.json({ limit: '2mb' }))

  // 启动时清一次过期的配图缓存（异步，不阻塞启动）
  void pruneImageCache()

  // 依次尝试若干变量名；每个名字先看进程环境变量，再回落到 .env / .env.local
  const pickEnv = (...names) => {
    for (const name of names) {
      const value = String(process.env[name] ?? envValues()[name] ?? '').trim()
      if (value) return value
    }
    return ''
  }

  // Key 优先级：界面里填的（Electron 注入 STORYBOARD_UI_KEY）> .env 的通用名
  // > 旧的 BAILIAN_* / DASHSCOPE_*（保留兼容）
  const getApiKey = () =>
    String(process.env.STORYBOARD_UI_KEY ?? '').trim() ||
    pickEnv('STORYBOARD_API_KEY', 'BAILIAN_API_KEY', 'DASHSCOPE_API_KEY')

  const getModel = () =>
    String(process.env.STORYBOARD_UI_MODEL ?? '').trim() ||
    pickEnv('STORYBOARD_MODEL', 'BAILIAN_MODEL', 'DASHSCOPE_MODEL') ||
    'qwen-plus'

  const getBaseUrl = () => {
    const url =
      String(process.env.STORYBOARD_UI_BASE_URL ?? '').trim() ||
      pickEnv('STORYBOARD_BASE_URL', 'BAILIAN_BASE_URL', 'DASHSCOPE_BASE_URL')
    return normalizeBaseUrl(url) || DEFAULT_BASE_URL
  }

  // ---------- 接口地址安全校验（SSRF 防护） ----------

  const isLoopback = (ip) => ip === '::1' || ip === '::ffff:127.0.0.1' || String(ip ?? '').startsWith('127.')

  /**
   * 校验用户填的接口地址。空字符串表示「用服务端默认值」，直接放行。
   * 内网地址仅在本机来源或显式开启开关时放行，这样 Electron / 本地开发能用 Ollama，
   * 而对公网部署的远程请求则拒绝。
   */
  async function resolveSafeBaseUrl(raw, allowLocal) {
    const value = normalizeBaseUrl(raw)
    if (!value) return { ok: true, url: '' }

    let url
    try {
      url = new URL(value)
    } catch {
      return { ok: false, error: '接口地址不是合法的 URL。' }
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { ok: false, error: '接口地址只支持 http / https 协议。' }
    }
    if (url.username || url.password) {
      return { ok: false, error: '接口地址不能包含用户名或密码。' }
    }

    const host = url.hostname
    if (isMetadataHost(host)) return { ok: false, error: '出于安全考虑，禁止访问云元数据地址。' }
    if (isPrivateHostname(host) && !allowLocal) {
      return { ok: false, error: '出于安全考虑，当前来源不允许使用本机 / 内网接口地址。' }
    }

    if (!isIP(host)) {
      let records
      try {
        records = await dns.lookup(host, { all: true })
      } catch {
        return { ok: false, error: `无法解析接口地址的主机名：${host}` }
      }
      for (const record of records) {
        if (isMetadataHost(record.address)) {
          return { ok: false, error: '出于安全考虑，禁止访问云元数据地址。' }
        }
        if (isPrivateHostname(record.address) && !allowLocal) {
          return { ok: false, error: '出于安全考虑，接口地址指向了本机 / 内网。' }
        }
      }
    }

    return { ok: true, url: value }
  }

  /**
   * 解析本次请求实际要用的接口地址 / Key / 模型。
   *
   * 关键安全规则：**若 baseUrl 被请求体覆盖，且请求体没带 Key，则绝不回落到服务端 Key**。
   * 否则攻击者只要把地址指向自己的服务器，就能骗到服务端保存的密钥。
   */
  async function resolveConnection(req) {
    const body = req.body ?? {}
    const allowLocal = isLoopback(req.ip) || process.env.STORYBOARD_ALLOW_LOCAL_ENDPOINTS === 'true'
    const serverBaseUrl = getBaseUrl()

    const checked = await resolveSafeBaseUrl(body.baseUrl, allowLocal)
    if (!checked.ok) return { error: checked.error }

    const baseUrl = checked.url || serverBaseUrl
    const endpointOverridden = Boolean(checked.url) && checked.url !== serverBaseUrl

    const clientKey = String(body.apiKey ?? '').trim()
    let apiKey = ''
    if (clientKey) apiKey = clientKey
    else if (endpointOverridden) apiKey = '' // 防密钥外泄
    else apiKey = getApiKey()

    const model = String(body.model ?? '').trim() || getModel()
    return { baseUrl, apiKey, model }
  }

  /**
   * 带参数兼容降级的 POST。ok 时不读 body（留给流式消费），失败时返回已读文本。
   */
  async function postWithCompatibility({ url, apiKey, baseBody, streamCapable, signal }) {
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }
    let step = COMPAT_STEPS.FULL
    let response = null
    let raw = ''

    for (let attempt = 0; attempt < 3; attempt += 1) {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(applyCompatStep(baseBody, step)),
        signal,
        redirect: 'manual', // 防 SSRF：不跟随跳转
      })
      if (response.ok) return { response, raw: '', step }

      raw = await response.text()
      const next = nextCompatibilityStep(step, {
        status: response.status,
        bodyText: raw,
        streamCapable,
      })
      if (!next) break
      step = next
    }

    return { response, raw, step }
  }

  // ---------- 健康检查 / 配置 ----------
  app.get('/api/config', (_req, res) => {
    res.json({
      ok: true,
      hasKey: Boolean(getApiKey()),
      model: getModel(),
      models: MODEL_OPTIONS.map(({ value, label }) => ({ value, label })),
      baseUrl: getBaseUrl(),
      shotTypes: SHOT_TYPES,
    })
  })

  // ---------- 生成分镜 ----------
  app.post('/api/generate', async (req, res) => {
    const { topic = '', script = '', style = '', visualSetting = null } = req.body ?? {}

    if (!String(topic).trim() && !String(script).trim()) {
      return res.status(400).json({ error: '请至少填写「短剧主题」或「剧本」中的一项。', code: 'EMPTY_INPUT' })
    }

    const conn = await resolveConnection(req)
    if (conn.error) return res.status(400).json({ error: conn.error, code: 'BAD_BASE_URL' })
    if (!conn.apiKey) {
      return res.status(500).json({
        error: '尚未配置 API Key。请点右上角「设置」填写你的模型服务 Key。',
        code: 'MISSING_API_KEY',
      })
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
      const { response: upstream, raw } = await postWithCompatibility({
        url: `${conn.baseUrl}/chat/completions`,
        apiKey: conn.apiKey,
        baseBody: {
          model: conn.model,
          messages: buildMessages({ topic, script, style, visualSetting }),
          ...SAMPLING_PARAMS,
        },
        streamCapable: false,
        signal: controller.signal,
      })

      const bodyText = upstream.ok ? await upstream.text() : raw

      if (!upstream.ok) {
        return res.status(mapUpstreamStatus(upstream.status)).json({
          error: describeUpstreamError(upstream.status, bodyText),
          code: `UPSTREAM_${upstream.status}`,
        })
      }

      let payload
      try {
        payload = JSON.parse(bodyText)
      } catch {
        return res
          .status(502)
          .json({ error: `模型服务返回了非 JSON 内容：${bodyText.slice(0, 200)}`, code: 'BAD_UPSTREAM_JSON' })
      }

      const content = payload?.choices?.[0]?.message?.content ?? ''
      const parsed = parseShots(content)

      res.json({
        ok: true,
        model: payload.model || conn.model,
        usage: payload.usage ?? null,
        shots: parsed.shots,
        refused: parsed.refused ?? null,
      })
    } catch (err) {
      if (err?.name === 'AbortError') {
        return res.status(504).json({ error: `模型响应超时（>${REQUEST_TIMEOUT_MS / 1000}s），请重试。`, code: 'TIMEOUT' })
      }
      console.error('[generate]', err)
      res.status(500).json({ error: `调用模型服务失败：${err?.message ?? err}`, code: 'SERVER_ERROR' })
    } finally {
      clearTimeout(timer)
    }
  })

  // ---------- 生成分镜（SSE：推送真实阶段进度） ----------
  // 与 /api/generate 的区别只在传输方式：这里用 stream:true 调上游，
  // 因此能区分「等响应头」（calling）与「读 token 流」（generating）两个真实阶段。
  app.post('/api/generate-stream', async (req, res) => {
    const { topic = '', script = '', style = '', visualSetting = null } = req.body ?? {}

    // 前置校验仍用普通 JSON + 状态码，客户端先判 res.ok 再进流式
    if (!String(topic).trim() && !String(script).trim()) {
      return res.status(400).json({ error: '请至少填写「短剧主题」或「剧本」中的一项。', code: 'EMPTY_INPUT' })
    }

    const conn = await resolveConnection(req)
    if (conn.error) return res.status(400).json({ error: conn.error, code: 'BAD_BASE_URL' })
    if (!conn.apiKey) {
      return res.status(500).json({
        error: '尚未配置 API Key。请点右上角「设置」填写你的模型服务 Key。',
        code: 'MISSING_API_KEY',
      })
    }

    res.status(200)
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders?.()
    res.write(': connected\n\n')

    const send = (event, data) => {
      if (res.writableEnded) return
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    const controller = new AbortController()
    let abortReason = ''
    const timer = setTimeout(() => {
      abortReason = 'TIMEOUT'
      controller.abort()
    }, REQUEST_TIMEOUT_MS)

    // 客户端断开（关页面 / 点取消）→ 中止上游，避免继续烧 token
    const onClose = () => {
      if (!res.writableEnded) {
        abortReason = 'CLIENT_CLOSED'
        controller.abort()
      }
    }
    res.on('close', onClose)

    // 心跳：防止反向代理掐掉空闲连接
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': ping\n\n')
    }, 15_000)

    try {
      send('phase', { phase: 'preparing', at: Date.now() })
      const messages = buildMessages({ topic, script, style, visualSetting })

      send('phase', { phase: 'calling', at: Date.now() })
      const { response: upstream, raw } = await postWithCompatibility({
        url: `${conn.baseUrl}/chat/completions`,
        apiKey: conn.apiKey,
        baseBody: {
          model: conn.model,
          messages,
          temperature: SAMPLING_PARAMS.temperature,
          top_p: SAMPLING_PARAMS.top_p,
          response_format: SAMPLING_PARAMS.response_format,
          stream: true,
        },
        streamCapable: true,
        signal: controller.signal,
      })

      if (!upstream.ok) {
        return send('error', {
          error: describeUpstreamError(upstream.status, raw),
          code: `UPSTREAM_${upstream.status}`,
          status: mapUpstreamStatus(upstream.status),
        })
      }

      // 响应头已到达 → 模型开始产出 token
      send('phase', { phase: 'generating', at: Date.now() })

      const contentType = upstream.headers.get('content-type') ?? ''
      let content = ''
      let usedModel = ''
      let usage = null

      // 进度上报：只在「已完成条数增加」时推帧，顺带带上已完成分镜的文本。
      // 总量上限 5，天然就是节流上界。
      let lastProgress = 0
      const reportProgress = (completed, shots = []) => {
        const n = Math.max(lastProgress, Math.min(SHOT_COUNT, Number(completed) || 0))
        if (n <= lastProgress) return
        lastProgress = n
        send('progress', { completed: n, total: SHOT_COUNT, shots, at: Date.now() })
      }

      // 主信号是解析出的完整对象（能拿到文字），条数即它的长度 ——
      // 保证「已生成 N 条」与「屏幕上已有 N 张有内容的卡」严格对应。
      const onStreamProgress = (raw) => {
        const shots = parseCompletedShots(raw)
        if (shots.length === 0) return // 还没写完一条，不推
        reportProgress(shots.length, shots)
      }

      if (contentType.includes('text/event-stream')) {
        const acc = await readOpenAIStream(upstream.body, onStreamProgress)
        content = acc.content
        usedModel = acc.model
        usage = acc.usage
      } else {
        // 上游忽略了 stream，退化为一次性 JSON（这条路径没有中间进度）
        const raw = await upstream.text()
        let payload
        try {
          payload = JSON.parse(raw)
        } catch {
          return send('error', {
            error: `模型服务返回了非 JSON 内容：${raw.slice(0, 200)}`,
            code: 'BAD_UPSTREAM_JSON',
            status: 502,
          })
        }
        content = payload?.choices?.[0]?.message?.content ?? ''
        usedModel = payload?.model ?? ''
        usage = payload?.usage ?? null
      }

      send('phase', { phase: 'parsing', at: Date.now() })
      const parsed = parseShots(content)

      // 统一收尾：流式路径通常已推到末值（会被去重跳过），非流式路径在这里才拿到真实条数。
      // 不补传内容 —— 紧接着的 done 帧带着完整 shots，前端马上就切到结果页了。
      reportProgress(parsed.shots.length)

      send('done', {
        ok: true,
        model: usedModel || conn.model,
        usage,
        shots: parsed.shots,
        refused: parsed.refused ?? null,
      })
    } catch (err) {
      if (err?.name === 'AbortError') {
        // 客户端已经走了，再发也没人收
        if (abortReason === 'CLIENT_CLOSED') return
        return send('error', {
          error: `模型响应超时（>${REQUEST_TIMEOUT_MS / 1000}s），请重试。`,
          code: 'TIMEOUT',
          status: 504,
        })
      }
      console.error('[generate-stream]', err)
      send('error', { error: `调用模型服务失败：${err?.message ?? err}`, code: 'SERVER_ERROR', status: 500 })
    } finally {
      clearTimeout(timer)
      clearInterval(heartbeat)
      res.off('close', onClose)
      if (!res.writableEnded) res.end()
    }
  })

  // ---------- 统一视觉设定（视觉圣经）：**设定先行**，产出后供分镜生成与配图共用 ----------
  app.post('/api/visual-setting', async (req, res) => {
    const { topic = '', script = '', style = '' } = req.body ?? {}

    if (!String(topic).trim() && !String(script).trim()) {
      return res.status(400).json({ error: '请至少填写「短剧主题」或「剧本」中的一项。', code: 'EMPTY_INPUT' })
    }

    const conn = await resolveConnection(req)
    if (conn.error) return res.status(400).json({ error: conn.error, code: 'BAD_BASE_URL' })
    if (!conn.apiKey) {
      return res.status(500).json({
        error: '尚未配置 API Key。请点右上角「设置」填写你的模型服务 Key。',
        code: 'MISSING_API_KEY',
      })
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
      const { response: upstream, raw } = await postWithCompatibility({
        url: `${conn.baseUrl}/chat/completions`,
        apiKey: conn.apiKey,
        baseBody: {
          model: conn.model,
          messages: buildVisualSettingMessages({ topic, script, style }),
          ...SAMPLING_PARAMS,
        },
        streamCapable: false,
        signal: controller.signal,
      })

      const bodyText = upstream.ok ? await upstream.text() : raw

      if (!upstream.ok) {
        return res.status(mapUpstreamStatus(upstream.status)).json({
          error: describeUpstreamError(upstream.status, bodyText),
          code: `UPSTREAM_${upstream.status}`,
        })
      }

      let payload
      try {
        payload = JSON.parse(bodyText)
      } catch {
        return res
          .status(502)
          .json({ error: `模型服务返回了非 JSON 内容：${bodyText.slice(0, 200)}`, code: 'BAD_UPSTREAM_JSON' })
      }

      const content = payload?.choices?.[0]?.message?.content ?? ''
      const visualSetting = parseVisualSetting(content)

      res.json({ ok: true, model: payload.model || conn.model, visualSetting })
    } catch (err) {
      if (err?.name === 'AbortError') {
        return res.status(504).json({ error: `模型响应超时（>${REQUEST_TIMEOUT_MS / 1000}s），请重试。`, code: 'TIMEOUT' })
      }
      console.error('[visual-setting]', err)
      res.status(500).json({ error: `调用模型服务失败：${err?.message ?? err}`, code: 'SERVER_ERROR' })
    } finally {
      clearTimeout(timer)
    }
  })

  // ---------- 连通性测试（验证配置是否有效） ----------
  app.post('/api/test', async (req, res) => {
    const conn = await resolveConnection(req)
    if (conn.error) return res.status(400).json({ error: conn.error, code: 'BAD_BASE_URL' })

    const apiKey = conn.apiKey
    const model = conn.model

    if (!apiKey) {
      return res.status(400).json({ error: '请先填写 API Key。', code: 'EMPTY_KEY' })
    }

    try {
      const upstream = await fetch(`${conn.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
        signal: AbortSignal.timeout(30_000),
      })
      if (!upstream.ok) {
        const raw = await upstream.text()
        return res.status(mapUpstreamStatus(upstream.status)).json({
          error: describeUpstreamError(upstream.status, raw),
          code: `UPSTREAM_${upstream.status}`,
        })
      }
      res.json({ ok: true, model })
    } catch (err) {
      res.status(500).json({ error: `连接测试失败：${err?.message ?? err}`, code: 'TEST_FAILED' })
    }
  })

  // ---------- 图片：为一条分镜生成配图 ----------
  app.post('/api/image', async (req, res) => {
    const {
      provider,
      prompt,
      baseUrl,
      apiKey,
      model,
      size,
      referenceImages,
      timeoutMs,
      force,
    } = req.body ?? {}

    if (!String(prompt ?? '').trim()) {
      return res.status(400).json({ error: '这条分镜没有画面提示词，无法生成配图。', code: 'EMPTY_PROMPT' })
    }

    // 图片侧刻意放行内网 / 回环地址：本机跑的自建网关 / OpenAI 兼容服务都在 127.0.0.1。
    // 云元数据地址仍然恒拒（在 resolveSafeBaseUrl 内部判断）。
    const checked = await resolveSafeBaseUrl(baseUrl, true)
    if (!checked.ok) return res.status(400).json({ error: checked.error, code: 'BAD_BASE_URL' })

    try {
      const result = await generateImageForShot({
        provider,
        prompt,
        baseUrl: checked.url,
        apiKey: String(apiKey ?? '').trim(),
        model,
        size,
        referenceImages,
        timeoutMs,
        force: force === true,
      })
      res.json({ ok: true, ...result })
    } catch (err) {
      if (err instanceof ImageError) {
        return res.status(err.status).json({ error: err.message, code: err.code })
      }
      console.error('[image]', err)
      res.status(500).json({ error: `生成配图失败：${err?.message ?? err}`, code: 'IMAGE_ERROR' })
    }
  })

  // ---------- 图片：读取缓存 ----------
  app.get('/api/image-cache/:file', (req, res) => {
    const name = req.params.file
    // 白名单同时挡掉路径穿越
    if (!isSafeCacheFile(name)) return res.status(400).json({ error: '非法文件名。', code: 'BAD_FILE' })

    const file = path.join(imageCacheDir(), name)
    if (!fs.existsSync(file)) return res.status(404).json({ error: '图片不存在或已被清理。', code: 'NOT_FOUND' })

    // 文件名基于内容哈希，同名即同图，可以放心长缓存
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    res.sendFile(file)
  })

  // ---------- 生产静态资源（Web 部署用，Electron 不需要） ----------
  if (serveStatic) {
    const distDir = path.join(PROJECT_ROOT, 'dist')
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir))
      app.use((req, res, next) => {
        if (req.path.startsWith('/api')) return next()
        res.sendFile(path.join(distDir, 'index.html'))
      })
    }
  }

  app.getConfig = () => ({ hasKey: Boolean(getApiKey()), model: getModel(), baseUrl: getBaseUrl() })
  return app
}

function mapUpstreamStatus(status) {
  if (status === 401 || status === 403) return 401
  if (status === 429) return 429
  // 用户配置类问题（地址、模型名、参数）都归为 400，让前端提示去改设置
  if (status === 400 || status === 404 || status === 422) return 400
  return 502
}

/**
 * 读取 OpenAI 兼容的流式响应，累积 choices[0].delta.content。
 * 遇 `data: [DONE]` 或流结束即返回，顺带取 model 与 usage。
 *
 * onProgress(content) 会在每追加一段 delta 后被调用，参数是累积的全文，由调用方
 * 决定怎么解读（当前用于提取已写完的分镜并推给前端）。
 * 上游忽略 stream、退化为一次性 JSON 时不会触发，由调用方末尾补推。
 */
async function readOpenAIStream(body, onProgress) {
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let content = ''
  let model = ''
  let usage = null

  for (;;) {
    const { value, done } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split(/\r?\n\r?\n/)
    buffer = frames.pop() ?? ''

    for (const frame of frames) {
      for (const line of frame.split(/\r?\n/)) {
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (!data || data === '[DONE]') continue

        let json
        try {
          json = JSON.parse(data)
        } catch {
          continue
        }
        if (json.error) throw new Error(json.error?.message ?? '上游返回错误')
        if (json.model) model = json.model
        if (json.usage) usage = json.usage
        const delta = json.choices?.[0]?.delta?.content
        if (delta) {
          content += delta
          if (onProgress) onProgress(content)
        }
      }
    }
  }

  return { content, model, usage }
}
