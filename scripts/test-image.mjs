/**
 * 图片链路集成测试。
 *
 * 一个 mock 上游同时扮演两家服务的端点（百炼自有协议 / OpenAI 兼容），
 * 起真实的 createApp()，验证：三家各自走通、缓存去重、force 另存、b64 解码、
 * 路径穿越、SSRF 规则、以及各类前置校验。
 *
 * 运行：npm run test:image
 */
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

// 缓存目录必须在 createApp 之前设好
const CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-image-test-'))
process.env.STORYBOARD_IMAGE_CACHE_DIR = CACHE_DIR

const { createApp } = await import('../server/app.mjs')

/** 1×1 透明 PNG，够验证「确实是图片字节」 */
const PNG_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

/** 上游行为开关 */
const mode = {
  openai: 'url', // 'url' | 'b64' | 'authFail' | 'inspection' | 'metadataUrl'
  comfyPolls: 0, // 前几次 /history 返回空，模拟还在跑
  comfyError: false,
}

let mockOrigin = ''

const mockUpstream = http.createServer((req, res) => {
  const url = new URL(req.url, mockOrigin)

  // 上游产出的图片字节
  if (url.pathname === '/fake.png') {
    res.writeHead(200, { 'Content-Type': 'image/png' })
    res.end(PNG_BUFFER)
    return
  }

  // ---- 百炼通义万相 ----
  if (url.pathname === '/api/v1/services/aigc/multimodal-generation/generation') {
    if (req.headers.authorization !== 'Bearer sk-img-test') {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ code: 'InvalidApiKey', message: 'invalid api key' }))
      return
    }
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const body = JSON.parse(raw || '{}')
      if (body.parameters?.size !== '1920*1080') {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ code: 'InvalidParameter', message: 'bad size' }))
        return
      }
      const target = mode.openai === 'metadataUrl' ? 'http://169.254.169.254/latest/meta-data' : `${mockOrigin}/fake.png`
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ output: { choices: [{ message: { content: [{ type: 'image', image: target }] } }] } }))
    })
    return
  }

  // ---- OpenAI 兼容 ----
  if (url.pathname === '/images/generations') {
    if (mode.openai === 'authFail') {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'Incorrect API key provided' } }))
      return
    }
    if (mode.openai === 'inspection') {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'content inspection failed' } }))
      return
    }
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const body = JSON.parse(raw || '{}')
      if (body.size !== '1536x1024') {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'invalid size' } }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      // gpt-image 系列只给 base64，dall-e 给 url —— 两种都要能处理
      res.end(
        JSON.stringify({
          data: mode.openai === 'b64' ? [{ b64_json: PNG_BUFFER.toString('base64') }] : [{ url: `${mockOrigin}/fake.png` }],
        }),
      )
    })
    return
  }

  res.writeHead(404).end()
})

let failed = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed += 1
}

try {
  await new Promise((r) => mockUpstream.listen(0, '127.0.0.1', r))
  mockOrigin = `http://127.0.0.1:${mockUpstream.address().port}`

  // 让文本侧不干扰：这一轮只测图片端点
  delete process.env.STORYBOARD_API_KEY
  delete process.env.BAILIAN_API_KEY

  const server = createApp({ serveStatic: false }).listen(0, '127.0.0.1')
  await new Promise((r) => server.once('listening', r))
  const base = `http://127.0.0.1:${server.address().port}`

  const callImage = (body) =>
    fetch(`${base}/api/image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  const bailianBody = (extra = {}) => ({
    provider: 'bailian',
    prompt: 'a cat',
    baseUrl: mockOrigin,
    apiKey: 'sk-img-test',
    model: 'wan2.7-image-pro',
    size: '1920*1080',
    ...extra,
  })

  // ---------- 1. 百炼链路 ----------
  const r1 = await callImage(bailianBody())
  const d1 = await r1.json()
  check('百炼·返回 200', r1.status === 200, JSON.stringify(d1))
  check('百炼·返回本地缓存地址', /^\/api\/image-cache\/[a-f0-9]{40}\.png$/.test(d1.url ?? ''), String(d1.url))
  check('百炼·首次未命中缓存', d1.cached === false)

  // ---------- 2. 缓存去重（真实省钱）----------
  const r2 = await callImage(bailianBody())
  const d2 = await r2.json()
  check('百炼·同提示词命中缓存', d2.cached === true && d2.url === d1.url, JSON.stringify(d2))

  // ---------- 3. force 另存为新文件 ----------
  const r3 = await callImage(bailianBody({ force: true }))
  const d3 = await r3.json()
  check('百炼·force 后文件名不同', d3.cached === false && d3.url !== d1.url, JSON.stringify(d3))

  // ---------- 4. 缓存确实落盘且可访问 ----------
  const fileName = String(d1.url).split('/').pop()
  check('缓存·文件已落盘', fs.existsSync(path.join(CACHE_DIR, fileName)))
  const fileRes = await fetch(`${base}${d1.url}`)
  check('缓存·返回 image/png', fileRes.headers.get('content-type')?.includes('image/png') === true)
  check('缓存·带 immutable 长缓存', (fileRes.headers.get('cache-control') ?? '').includes('immutable'))
  check('缓存·字节与上游一致', Buffer.from(await fileRes.arrayBuffer()).equals(PNG_BUFFER))

  // ---------- 5. 路径穿越与不存在 ----------
  const traverse = await fetch(`${base}/api/image-cache/..%2f..%2fapp.mjs`)
  check('缓存·拒绝路径穿越', traverse.status === 400, `实际 ${traverse.status}`)
  const missing = await fetch(`${base}/api/image-cache/${'a'.repeat(40)}.png`)
  check('缓存·不存在返回 404', missing.status === 404, `实际 ${missing.status}`)

  // ---------- 6. OpenAI 兼容：url 形态 ----------
  const openaiBody = (extra = {}) => ({
    provider: 'openai',
    prompt: 'a cat',
    baseUrl: mockOrigin,
    apiKey: 'sk-openai',
    model: 'gpt-image-1',
    size: '1536x1024',
    ...extra,
  })
  const o1 = await callImage(openaiBody())
  const od1 = await o1.json()
  check('OpenAI·url 形态走通', o1.status === 200 && od1.url?.startsWith('/api/image-cache/'), JSON.stringify(od1))

  // ---------- 7. OpenAI 兼容：b64 形态（gpt-image 只给 base64）----------
  mode.openai = 'b64'
  const o2 = await callImage(openaiBody({ prompt: 'a dog' }))
  const od2 = await o2.json()
  check('OpenAI·b64 解码落盘', o2.status === 200 && od2.url?.startsWith('/api/image-cache/'), JSON.stringify(od2))
  const b64File = await fetch(`${base}${od2.url}`)
  check('OpenAI·b64 落地内容正确', Buffer.from(await b64File.arrayBuffer()).equals(PNG_BUFFER))
  mode.openai = 'url'

  // ---------- 10. 各类前置校验 ----------
  const unknown = await callImage({ provider: 'nope', prompt: 'x', baseUrl: mockOrigin, apiKey: 'k' })
  check('未知服务商返回 400', unknown.status === 400 && (await unknown.json()).code === 'UNKNOWN_PROVIDER')

  const noPrompt = await callImage({ provider: 'bailian', prompt: '  ', baseUrl: mockOrigin, apiKey: 'k' })
  check('空提示词返回 400', noPrompt.status === 400 && (await noPrompt.json()).code === 'EMPTY_PROMPT')

  const noKey = await callImage({ provider: 'bailian', prompt: 'a cat', baseUrl: mockOrigin, apiKey: '', model: 'm' })
  check('缺 Key 返回 500', noKey.status === 500 && (await noKey.json()).code === 'MISSING_IMAGE_KEY')

  const badProto = await callImage({ provider: 'bailian', prompt: 'a cat', baseUrl: 'file:///etc', apiKey: 'k' })
  check('非法协议被拒', badProto.status === 400, `实际 ${badProto.status}`)

  // ---------- 11. 鉴权失败与内容审核 ----------
  mode.openai = 'authFail'
  const authFail = await callImage(openaiBody({ prompt: 'auth fail case' }))
  check('鉴权失败返回 401', authFail.status === 401, `实际 ${authFail.status}`)
  check('鉴权失败文案可读', String((await authFail.json()).error).includes('鉴权失败'))

  mode.openai = 'inspection'
  const inspection = await callImage(openaiBody({ prompt: 'inspection case' }))
  check('内容审核失败有专门文案', String((await inspection.json()).error).includes('内容审核'))
  mode.openai = 'url'

  // ---------- 12. SSRF：图片下载地址 ----------
  mode.openai = 'metadataUrl'
  const meta = await callImage(bailianBody({ prompt: 'metadata case' }))
  const metaBody = await meta.json()
  check('下载云元数据地址被拒', meta.status >= 400, JSON.stringify(metaBody))
  check('云元数据拒绝理由明确', String(metaBody.error).includes('云元数据'), JSON.stringify(metaBody))
  mode.openai = 'url'

  // ---------- 13. 本地服务必须能连（内网放行）----------
  const local = await callImage(bailianBody({ prompt: 'local service case' }))
  check('本地 / 内网地址放行（本地服务可用）', local.status === 200, `实际 ${local.status}`)

  // ---------- 14. 适配器元数据 ----------
  const { listImageAdapters, isAdapterAvailableOn } = await import('../shared/image-adapters.mjs')
  check('适配器·两家齐全', listImageAdapters().length === 2)
  check('适配器·百炼手机端可用', isAdapterAvailableOn('bailian', { native: true }) === true)

  // ---------- 15. 单张超时 ----------
  // 回归：normalizeTimeoutMs 曾引用两个不存在的常量，只要带上 timeoutMs 就 500
  const timed = await callImage(bailianBody({ prompt: 'timeout case', timeoutMs: 180_000 }))
  check('超时·带 timeoutMs 不再 500', timed.status === 200, `实际 ${timed.status}`)

  const { normalizeTimeoutMs, IMAGE_REQUEST_TIMEOUT_MS, MIN_IMAGE_TIMEOUT_MS, MAX_IMAGE_TIMEOUT_MS } =
    await import('../server/image.js')
  check('超时·合法值原样保留', normalizeTimeoutMs(180_000, IMAGE_REQUEST_TIMEOUT_MS) === 180_000)
  check('超时·空值回落默认', normalizeTimeoutMs(undefined, IMAGE_REQUEST_TIMEOUT_MS) === IMAGE_REQUEST_TIMEOUT_MS)
  check('超时·过小抬到下限', normalizeTimeoutMs(180, IMAGE_REQUEST_TIMEOUT_MS) === MIN_IMAGE_TIMEOUT_MS)
  check('超时·过大压到上限', normalizeTimeoutMs(99_999_999, IMAGE_REQUEST_TIMEOUT_MS) === MAX_IMAGE_TIMEOUT_MS)
  check('超时·非数字回落默认', normalizeTimeoutMs('abc', IMAGE_REQUEST_TIMEOUT_MS) === IMAGE_REQUEST_TIMEOUT_MS)

  // ---------- 16. 参考图参与缓存键 ----------
  const refA = `/api/image-cache/${'1'.repeat(40)}.png`
  const refB = `/api/image-cache/${'2'.repeat(40)}.png`
  const noRefBody = await (await callImage(bailianBody({ prompt: 'ref key case' }))).json()
  const withRefA = await callImage(bailianBody({ prompt: 'ref key case', referenceImages: [refA] }))
  const withRefABody = await withRefA.json()
  check(
    '参考图·同提示词换参考图不命中缓存',
    withRefABody.cached === false && withRefABody.url !== noRefBody.url,
    JSON.stringify(withRefABody),
  )
  const withRefAAgain = await callImage(bailianBody({ prompt: 'ref key case', referenceImages: [refA] }))
  check('参考图·参考图不变仍命中缓存', (await withRefAAgain.json()).cached === true)
  const withRefB = await callImage(bailianBody({ prompt: 'ref key case', referenceImages: [refB] }))
  check('参考图·换一张参考图另存新图', (await withRefB.json()).url !== withRefABody.url)

  server.close()
} catch (err) {
  console.error('异常:', err)
  failed += 1
} finally {
  mockUpstream.close()
  fs.rmSync(CACHE_DIR, { recursive: true, force: true })
}

console.log(failed === 0 ? '\n全部通过 ✓' : `\n${failed} 项失败 ✗`)
process.exit(failed === 0 ? 0 : 1)
