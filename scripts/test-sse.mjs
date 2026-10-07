/**
 * SSE 集成测试：起一个 mock 上游 + 真实的 createApp()，
 * 用 fetch 读 /api/generate-stream，校验阶段序列、配置传输、参数降级与 SSRF 防护。
 *
 * 运行：npm run test:sse
 */
import http from 'node:http'
import assert from 'node:assert/strict'

import { createApp } from '../server/app.mjs'

const MOCK_SHOTS = {
  shots: Array.from({ length: 5 }, (_, i) => ({
    shotNumber: i + 1,
    sceneDescription: `第 ${i + 1} 个镜头的画面描述，豪华酒店宴会厅水晶灯倾泻下冷白光。`,
    characterAction: '陈默弯腰捡起地上的婚戒。',
    dialogue: '陈默：如你所愿。',
    shotType: '特写',
    // 第一条故意混入违禁词，验证 sanitizeImagePrompt 在真实链路里生效
    imagePrompt:
      i === 0
        ? 'close-up of a young delivery man, cinematic, film grain, 8k, 16:9'
        : `shot ${i + 1} of a delivery man, cinematic`,
  })),
}

/** 上游最近一次收到的请求体 */
let upstreamBody = null
/** 让上游拒绝 response_format，用于验证降级重试 */
let rejectJsonMode = false
/** 上游收到的请求次数 */
let upstreamHits = 0

const mockUpstream = http.createServer((req, res) => {
  if (!req.url.endsWith('/chat/completions')) {
    res.writeHead(404).end()
    return
  }
  if (req.headers.authorization !== 'Bearer sk-sse-test') {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'invalid api key' } }))
    return
  }

  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', () => {
    upstreamHits += 1
    upstreamBody = JSON.parse(raw || '{}')

    // 模拟「不支持 response_format」的网关
    if (rejectJsonMode && upstreamBody.response_format) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'response_format is not supported' } }))
      return
    }

    // 真实上游会按请求里的 stream 决定返回形式，mock 也照做，
    // 否则非流式端点会收到 SSE 而解析失败
    if (upstreamBody.stream !== true) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          model: 'mock-model',
          choices: [{ message: { role: 'assistant', content: JSON.stringify(MOCK_SHOTS) } }],
          usage: { total_tokens: 42 },
        }),
      )
      return
    }

    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' })
    const payload = JSON.stringify(MOCK_SHOTS)
    const chunks = payload.match(/.{1,40}/g) ?? []
    let i = 0

    const timer = setInterval(() => {
      if (i < chunks.length) {
        res.write(`data: ${JSON.stringify({ model: 'mock-model', choices: [{ delta: { content: chunks[i] } }] })}\n\n`)
        i += 1
        return
      }
      clearInterval(timer)
      res.write(
        `data: ${JSON.stringify({ model: 'mock-model', choices: [{ delta: {}, finish_reason: 'stop' }], usage: { total_tokens: 42 } })}\n\n`,
      )
      res.write('data: [DONE]\n\n')
      res.end()
    }, 15)
  })
})

/** 解析 SSE 文本，返回 [{ event, data }] */
function parseSse(text) {
  const out = []
  for (const frame of text.split(/\r?\n\r?\n/)) {
    let event = 'message'
    const dataLines = []
    for (const line of frame.split('\n')) {
      if (line.startsWith(':')) continue
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''))
    }
    if (dataLines.length === 0) continue
    out.push({ event, data: JSON.parse(dataLines.join('\n')) })
  }
  return out
}

let failed = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed += 1
}

try {
  await new Promise((r) => mockUpstream.listen(0, '127.0.0.1', r))
  const upstreamPort = mockUpstream.address().port

  // 不再依赖 BAILIAN_* 环境变量：配置由请求体传入，这正是本次改造要打通的链路
  delete process.env.BAILIAN_API_KEY
  delete process.env.BAILIAN_BASE_URL
  delete process.env.STORYBOARD_API_KEY
  delete process.env.STORYBOARD_BASE_URL

  const server = createApp({ serveStatic: false }).listen(0, '127.0.0.1')
  await new Promise((r) => server.once('listening', r))
  const base = `http://127.0.0.1:${server.address().port}`

  const callStream = (extra = {}) =>
    fetch(`${base}/api/generate-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({
        topic: '都市逆袭',
        script: '退婚',
        style: '都市写实',
        baseUrl: `http://127.0.0.1:${upstreamPort}`,
        apiKey: 'sk-sse-test',
        model: 'mock-model',
        ...extra,
      }),
    })

  // ---------- 1. 成功路径：阶段序列 ----------
  const res = await callStream()
  check('响应头为 text/event-stream', (res.headers.get('content-type') ?? '').includes('text/event-stream'))

  const frames = parseSse(await res.text())
  const phases = frames.filter((f) => f.event === 'phase').map((f) => f.data.phase)
  const doneFrames = frames.filter((f) => f.event === 'done')
  const errorFrames = frames.filter((f) => f.event === 'error')

  check('阶段序列完整且有序', JSON.stringify(phases) === JSON.stringify(['preparing', 'calling', 'generating', 'parsing']), JSON.stringify(phases))
  check('只收到一个 done', doneFrames.length === 1)
  check('没有 error 帧', errorFrames.length === 0, JSON.stringify(errorFrames))
  check('done 携带 5 条分镜', doneFrames[0]?.data?.shots?.length === 5)
  check('model 透传自上游', doneFrames[0]?.data?.model === 'mock-model')
  check('usage 透传自上游', doneFrames[0]?.data?.usage?.total_tokens === 42)

  // ---------- 1b. 条数进度帧 ----------
  const progressFrames = frames.filter((f) => f.event === 'progress')
  const counts = progressFrames.map((f) => f.data.completed)
  check('收到 progress 帧', progressFrames.length >= 1, JSON.stringify(counts))
  check('progress.total 为 5', progressFrames.every((f) => f.data.total === 5))
  check(
    'progress 单调不减',
    counts.every((v, i) => i === 0 || v >= counts[i - 1]),
    JSON.stringify(counts),
  )
  check(
    'progress 逐级爬升到 5',
    counts.at(-1) === 5 && new Set(counts).size >= 3,
    JSON.stringify(counts),
  )
  check('progress 未混入阶段序列', !phases.includes('progress'))

  // 每帧都应带上已完成分镜的文本，供前端边生成边显示
  const withShots = progressFrames.filter((f) => Array.isArray(f.data.shots) && f.data.shots.length > 0)
  const shotLens = progressFrames.map((f) => f.data.shots?.length ?? -1)
  check('progress 携带分镜文本', withShots.length >= 1, JSON.stringify(shotLens))
  check(
    'progress.shots 长度等于 completed',
    progressFrames.every((f) => f.data.shots.length === f.data.completed),
    JSON.stringify(shotLens),
  )
  check(
    'progress.shots 有画面描述',
    withShots.at(-1)?.data.shots.every((s) => typeof s.sceneDescription === 'string' && s.sceneDescription.length > 0),
  )
  check(
    'progress.shots 有镜头类型',
    withShots.at(-1)?.data.shots.every((s) => typeof s.shotType === 'string' && s.shotType.length > 0),
  )
  check(
    'progress.shots 只增不减',
    shotLens.every((v, i) => i === 0 || v >= shotLens[i - 1]),
    JSON.stringify(shotLens),
  )
  check('progress.shots 内容正确', withShots.at(-1)?.data.shots[0].shotNumber === 1)

  // ---------- 2. 配置由请求体传入并生效 ----------
  check('请求体里的 baseUrl 生效', upstreamHits > 0, '未打到 mock 上游')
  check('请求体里的 apiKey 生效', true) // 鉴权不通过的话上面会 401
  check('请求体里的 model 生效', upstreamBody?.model === 'mock-model')
  check('服务端确实开了流式', upstreamBody?.stream === true)
  check('默认带 response_format', upstreamBody?.response_format?.type === 'json_object')

  // ---------- 3. 清洗在真实链路里生效 ----------
  const prompt = doneFrames[0]?.data?.shots?.[0]?.imagePrompt ?? ''
  check('imagePrompt 已剔除违禁词', prompt === 'close-up of a young delivery man, cinematic, film grain', prompt)

  // ---------- 4. 参数降级：上游拒绝 response_format 时自动重试 ----------
  rejectJsonMode = true
  const degradedRes = await callStream()
  const degradedFrames = parseSse(await degradedRes.text())
  check('降级后仍成功', degradedFrames.some((f) => f.event === 'done'))
  check('降级后不再带 response_format', upstreamBody?.response_format === undefined)
  check('降级后仍保持 stream', upstreamBody?.stream === true)
  rejectJsonMode = false

  // ---------- 5. SSRF 防护 ----------
  const proto = await callStream({ baseUrl: 'file:///etc/passwd' })
  check('非法协议被拒', proto.status === 400, `实际 ${proto.status}`)

  const meta = await callStream({ baseUrl: 'http://169.254.169.254/latest' })
  check('云元数据地址被拒', meta.status === 400, `实际 ${meta.status}`)

  const badUrl = await callStream({ baseUrl: 'not-a-url' })
  check('非法 URL 被拒', badUrl.status === 400, `实际 ${badUrl.status}`)

  // ---------- 6. 前置校验：普通 JSON 而非 SSE ----------
  const bad = await fetch(`${base}/api/generate-stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  const badBody = await bad.json()
  check('空输入返回 400', bad.status === 400)
  check('空输入错误码', badBody.code === 'EMPTY_INPUT')
  check('前置校验不走 SSE', !(bad.headers.get('content-type') ?? '').includes('event-stream'))

  // ---------- 7. 缺 Key 时明确报错 ----------
  const noKey = await callStream({ apiKey: '' })
  check('缺 Key 返回 500', noKey.status === 500, `实际 ${noKey.status}`)
  check('缺 Key 错误码', (await noKey.json()).code === 'MISSING_API_KEY')

  // ---------- 8. 兼容性：旧端点仍然可用 ----------
  const legacy = await fetch(`${base}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      topic: '都市逆袭',
      script: '退婚',
      style: '',
      baseUrl: `http://127.0.0.1:${upstreamPort}`,
      apiKey: 'sk-sse-test',
      model: 'mock-model',
    }),
  })
  const legacyBody = await legacy.json()
  check('旧端点 /api/generate 仍返回 JSON', legacyBody.ok === true && legacyBody.shots?.length === 5)

  // ---------- 9. 连接测试端点也要认请求体里的地址 ----------
  const testRes = await fetch(`${base}/api/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseUrl: `http://127.0.0.1:${upstreamPort}`, apiKey: 'sk-sse-test', model: 'mock-model' }),
  })
  check('/api/test 使用请求体里的地址', testRes.status === 200, `实际 ${testRes.status}`)

  server.close()
} catch (err) {
  console.error('异常:', err)
  failed += 1
} finally {
  mockUpstream.close()
}

console.log(failed === 0 ? '\n全部通过 ✓' : `\n${failed} 项失败 ✗`)
process.exit(failed === 0 ? 0 : 1)
