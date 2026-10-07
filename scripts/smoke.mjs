// 用 Vite SSR 真实渲染组件树，校验运行时不崩溃 + 关键内容存在
import { createServer } from 'vite'
import React from 'react'
import { renderToString } from 'react-dom/server'

import { parseShots, sanitizeImagePrompt, parseCompletedShots } from '../shared/prompt.mjs'

const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}
globalThis.window = {
  matchMedia: () => ({ matches: false }),
  localStorage: globalThis.localStorage,
  addEventListener() {},
  removeEventListener() {},
  setTimeout,
  clearTimeout,
}

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })

const norm = (html) => html.replaceAll('<!-- -->', '')

const shots = [
  {
    shotNumber: 1,
    sceneDescription: '豪华酒店宴会厅，水晶灯冷白光。',
    characterAction: '陈默弯腰捡起婚戒。',
    dialogue: '陈默：如你所愿。',
    shotType: '特写',
    imagePrompt: 'close-up of a young delivery man, luxury hotel banquet hall, cinematic',
  },
  {
    shotNumber: 2,
    sceneDescription: '宴会厅大门，背影穿过人群。',
    characterAction: '陈默转身走向出口。',
    dialogue: '（无台词，环境音：高跟鞋声）',
    shotType: '跟拍',
    imagePrompt: 'medium shot tracking a man walking away, cinematic',
  },
]

const meta = { topic: '都市逆袭', script: '退婚', style: '都市写实', model: 'qwen-plus' }

try {
  const { default: App } = await vite.ssrLoadModule('/src/App.tsx')
  const { ResultsPanel } = await vite.ssrLoadModule('/src/components/ResultsPanel.tsx')
  const { InputPanel } = await vite.ssrLoadModule('/src/components/InputPanel.tsx')
  const { storyboardToMarkdown, storyboardToJson } = await vite.ssrLoadModule('/src/lib/export.ts')

  const idleHtml = norm(renderToString(React.createElement(App)))
  const inputHtml = norm(
    renderToString(
      React.createElement(InputPanel, {
        form: { topic: '都市逆袭', script: '退婚', style: '', styleTags: ['都市写实', '悬疑暗调'], quickPaste: '' },
        onChange() {},
        onSubmit() {},
        onReset() {},
        loading: false,
      }),
    ),
  )
  const successHtml = norm(
    renderToString(
      React.createElement(ResultsPanel, { status: 'success', phase: null, shots, error: null, meta, onRetry() {} }),
    ),
  )
  const errorHtml = norm(
    renderToString(
      React.createElement(ResultsPanel, {
        status: 'error',
        shots: [],
        error: 'API Key 无效',
        meta: { topic: '', script: '', style: '', model: '' },
        onRetry() {},
      }),
    ),
  )

  const md = storyboardToMarkdown(shots, meta)
  const json = JSON.parse(storyboardToJson(shots, meta))

  // ---- 设置：多服务商配置的存取与旧键迁移 ----
  const settingsMod = await vite.ssrLoadModule('/src/lib/settings.ts')

  // 旧键（绑定百炼的键名）仍要能读到，否则老用户升级后配置就丢了
  store.set('dashscope_api_key', 'sk-legacy-key')
  const legacyRead = await settingsMod.loadSettings()
  store.delete('dashscope_api_key')

  // 新键优先
  store.set('storyboard_api_key', 'sk-user-own-key')
  const withUserKey = await settingsMod.loadSettings()
  store.delete('storyboard_api_key')

  const fallbackKey = await settingsMod.loadSettings()

  // baseUrl 存取与归一化
  store.set('storyboard_base_url', 'https://api.deepseek.com/v1')
  store.set('storyboard_model', 'deepseek-chat')
  const customConn = await settingsMod.loadSettings()
  await settingsMod.saveSettings({ apiKey: 'sk-x', baseUrl: 'https://api.example.com/v1/', model: 'gpt-4o' })
  const savedBaseUrl = store.get('storyboard_base_url')
  store.delete('storyboard_base_url')
  store.delete('storyboard_model')
  store.delete('storyboard_api_key')

  // ---- 厂商预设与接口地址工具 ----
  const { getProviderById, findProviderByBaseUrl, modelSuggestionsFor, CUSTOM_PROVIDER_ID, PROVIDERS } =
    await vite.ssrLoadModule('/src/lib/providers.ts')
  const { normalizeBaseUrl, isPrivateHostname, isMetadataHost } = await vite.ssrLoadModule('/shared/endpoint.mjs')

  // ---- 参数兼容降级 ----
  const { nextCompatibilityStep, applyCompatStep } = await vite.ssrLoadModule('/shared/compat.mjs')
  const degraded = applyCompatStep({ model: 'm', response_format: { type: 'json_object' }, stream: true }, 'no-stream')

  // 注：SettingsDialog 用的是 Radix Portal，SSR 不渲染内容，无法在这里做渲染断言；
  // 它的界面在浏览器端到端验证里确认。这里只覆盖它依赖的数据层。

  // ---- 风格标签的切换语义：题材有序主次、色调平级多选、跨组共存 ----
  const { toggleStyleTag, getToneTags, promoteToneTag, composeStyle, summarizeStyle } =
    await vite.ssrLoadModule('/src/lib/style-presets.ts')

  // 题材组（ranked）：多选 + 上限 3 + 第 1 个为主基调
  const r1 = toggleStyleTag([], '都市写实') // 首个 → 主基调
  const r2 = toggleStyleTag(r1, '悬疑暗调') // 追加为第 1 个辅助
  const r3 = toggleStyleTag(r2, '甜宠清新') // 追加为第 2 个辅助，已达上限
  const r4 = toggleStyleTag(r3, '古风唯美') // 超限 → 拒绝
  const r5 = toggleStyleTag(r3, '都市写实') // 取消主基调 → 悬疑暗调自动升主
  const r6 = promoteToneTag(r2, '悬疑暗调') // 互换主次
  const r7 = toggleStyleTag(toggleStyleTag([], '都市写实'), '冷色调') // 跨组共存
  const r8 = promoteToneTag(r7, '冷色调') // 非题材 id → 原样返回

  // 色调组（multi）仍为平级多选
  const m2 = toggleStyleTag(toggleStyleTag([], '暖色调'), '高对比')
  const m3 = toggleStyleTag(m2, '暖色调')

  // ---- imagePrompt 清洗：模型输出里的清晰度词与宽高比必须被剔除 ----
  const dirty = JSON.stringify({
    shots: [
      {
        shotNumber: 1,
        sceneDescription: 'x',
        characterAction: 'y',
        dialogue: 'z',
        shotType: '特写',
        imagePrompt:
          'close-up of a young delivery man, cinematic, film grain, 8k, 16:9, masterpiece, ultra detailed',
      },
    ],
  })
  const cleaned = parseShots(dirty).shots[0].imagePrompt

  // ---- 生成进度：阶段模型、APK 估算时间表、最短展示时长平滑 ----
  const { PHASE_ORDER, PHASE_META, estimatePhaseAt } = await vite.ssrLoadModule('/src/lib/progress.ts')
  const { resolvePhaseDelay } = await vite.ssrLoadModule('/src/lib/useProgress.ts')
  const { GenerationProgress } = await vite.ssrLoadModule('/src/components/GenerationProgress.tsx')
  const progressHtml = norm(
    renderToString(React.createElement(GenerationProgress, { phase: 'generating', completed: 3, total: 5, onCancel() {} })),
  )
  const progressEstimatedHtml = norm(
    renderToString(
      React.createElement(GenerationProgress, { phase: 'generating', completed: 3, total: 5, estimated: true, onCancel() {} }),
    ),
  )

  // ---- 加载态卡片：已写完的显示真实文字，未写完的是骨架（此前零覆盖）----
  const partialOf = (n) =>
    Array.from({ length: n }, (_, i) => ({
      shotNumber: i + 1,
      sceneDescription: `第 ${i + 1} 条的画面描述：豪华酒店宴会厅，水晶灯冷白光。`,
      shotType: '特写',
    }))

  const loadingProps = (partialCount) => ({
    status: 'loading',
    phase: 'generating',
    completed: partialCount,
    total: 5,
    partialShots: partialOf(partialCount),
    shots: [],
    error: null,
    meta: { topic: '', script: '', style: '', model: '' },
    onRetry() {},
    onCancel() {},
  })
  const loading0 = norm(renderToString(React.createElement(ResultsPanel, loadingProps(0))))
  const loading2 = norm(renderToString(React.createElement(ResultsPanel, loadingProps(2))))
  const loading5 = norm(renderToString(React.createElement(ResultsPanel, loadingProps(5))))

  const cards = (html) => (html.match(/data-slot="skeleton-card"/g) ?? []).length
  const partialCards = (html) => (html.match(/data-slot="partial-card"/g) ?? []).length

  // ---- 流式条数统计（纯函数）----
  const fiveShots = JSON.stringify({
    shots: Array.from({ length: 5 }, (_, i) => ({
      shotNumber: i + 1,
      sceneDescription: 'x',
      characterAction: 'y',
      dialogue: 'z',
      shotType: '中景',
      imagePrompt: `prompt ${i + 1}`,
    })),
  })
  const cutAfter2 = fiveShots.indexOf('"shotNumber":3')

  // ---- 图片适配器（纯数据转换）----
  const {
    IMAGE_ADAPTERS,
    IMAGE_PROVIDER_IDS,
    listImageAdapters,
    isAdapterAvailableOn,
    describeImageError,
  } =
    await vite.ssrLoadModule('/shared/image-adapters.mjs')
  const bailianReq = IMAGE_ADAPTERS.bailian.buildRequest({ prompt: 'a cat' })
  // 参考图：百炼走 content 数组里的 image 对象
  const bailianWithRefs = IMAGE_ADAPTERS.bailian.buildRequest({
    prompt: 'a cat',
    referenceImages: ['data:image/png;base64,AAA', 'data:image/png;base64,BBB'],
  })
  const bailianRefContent = bailianWithRefs.body.input.messages[0].content
  // 超过 4 张要截断（上游硬限制）
  const bailianTooMany = IMAGE_ADAPTERS.bailian.buildRequest({
    prompt: 'x',
    referenceImages: Array.from({ length: 8 }, (_, i) => `data:image/png;base64,R${i}`),
  })
  // OpenAI 这一版还不支持参考图，传了也不该出现在请求体里
  const openaiWithRefs = IMAGE_ADAPTERS.openai.buildRequest({
    prompt: 'a cat',
    referenceImages: ['data:image/png;base64,AAA'],
  })
  const openaiReq = IMAGE_ADAPTERS.openai.buildRequest({ prompt: 'a cat' })

  // ---- 缓存纯函数 ----
  const { imageCacheKey, isSafeCacheFile } = await vite.ssrLoadModule('/server/image-cache.mjs')
  const cacheKeyA = imageCacheKey({ provider: 'bailian', model: 'm', size: 's', prompt: 'p' })
  const cacheKeyB = imageCacheKey({ provider: 'bailian', model: 'm', size: 's', prompt: 'p' })
  const cacheKeyForced = imageCacheKey({ provider: 'bailian', model: 'm', size: 's', prompt: 'p', salt: '123' })
  const cacheKeyRefA = imageCacheKey({ provider: 'bailian', model: 'm', size: 's', prompt: 'p', referenceKey: 'aaaa' })
  const cacheKeyRefB = imageCacheKey({ provider: 'bailian', model: 'm', size: 's', prompt: 'p', referenceKey: 'bbbb' })

  // ---- 设置：嵌套的图片配置 ----
  const imageSettingsMod = await vite.ssrLoadModule('/src/lib/settings.ts')
  const { imageTimeoutMs, resolveImageApiKey } = imageSettingsMod
  store.set('storyboard_image_provider', 'openai')
  store.set(
    'storyboard_image_configs',
    // timeoutMs 是老版本留下的脏字段（当年按秒写、按毫秒用），读取时应当直接丢弃
    JSON.stringify({
      openai: {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-img',
        model: 'gpt-image-1',
        size: '1536x1024',
        timeoutSeconds: 300,
        timeoutMs: 180,
      },
    }),
  )
  const imageSettings = await imageSettingsMod.loadSettings()
  store.delete('storyboard_image_provider')
  store.delete('storyboard_image_configs')

  // 图片 Key 的复用规则：只有同一个服务才能拿文本 Key 顶上
  const sameHostSettings = { apiKey: 'sk-text', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' }
  const crossHostSettings = { apiKey: 'sk-text', baseUrl: 'https://api.deepseek.com/v1' }
  const noKeyImageCfg = { baseUrl: 'https://dashscope.aliyuncs.com', apiKey: '', model: 'wan2.7-image-pro' }
  const ownKeyImageCfg = { baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-img-own', model: 'gpt-image-1' }

  // ---- ShotCard 的配图块 ----
  const { ShotCard } = await vite.ssrLoadModule('/src/components/ShotCard.tsx')
  const shotForCard = {
    shotNumber: 1,
    sceneDescription: '画面描述',
    characterAction: '动作',
    dialogue: '台词',
    shotType: '特写',
    imagePrompt: 'a cat',
  }
  const cardNoImage = norm(renderToString(React.createElement(ShotCard, { shot: shotForCard, index: 0 })))
  const cardOk = norm(
    renderToString(
      React.createElement(ShotCard, {
        shot: shotForCard,
        index: 0,
        image: { status: 'success', url: '/api/image-cache/abc.png' },
      }),
    ),
  )
  const cardLoading = norm(
    renderToString(React.createElement(ShotCard, { shot: shotForCard, index: 0, image: { status: 'loading' } })),
  )
  const cardError = norm(
    renderToString(
      React.createElement(ShotCard, {
        shot: shotForCard,
        index: 0,
        image: { status: 'error', error: '生成失败' },
      }),
    ),
  )
  // 未生成时也渲染图片块，让用户能主动点「生成配图」（配图不再自动触发）
  const cardIdle = norm(
    renderToString(
      React.createElement(ShotCard, { shot: shotForCard, index: 0, image: { status: 'idle' }, onRequestImage() {} }),
    ),
  )

  // ---- 导出：dataURL 不能写进导出文件（手机端 base64 图会撑爆文件）----
  const dataUrlMd = storyboardToMarkdown([shotForCard], meta, [
    { status: 'success', url: 'data:image/png;base64,AAAAAAAA' },
  ])
  const dataUrlJson = JSON.parse(
    storyboardToJson([shotForCard], meta, [{ status: 'success', url: 'data:image/png;base64,AAAAAAAA' }]),
  )

  // ---- ResultsPanel 的配图进度行 ----
  const imageRowHtml = norm(
    renderToString(
      React.createElement(ResultsPanel, {
        status: 'success',
        phase: null,
        shots,
        images: [{ status: 'success', url: '/a.png' }, { status: 'loading' }],
        imageEnabled: true,
        error: null,
        meta,
        onRetry() {},
        onCancelImages() {},
        onGenerateAllImages() {},
      }),
    ),
  )

  // ---- 快速粘贴：规则拆分 ----
  const { splitTopicAndScript } = await vite.ssrLoadModule('/src/lib/split-input.ts')
  const splitCases = {
    marked: splitTopicAndScript('主题：都市逆袭\n剧情：订婚宴上，婚戒被扔在地上。'),
    onlyTopic: splitTopicAndScript('主题：都市逆袭\n订婚宴上，婚戒被扔在地上。'),
    firstLine: splitTopicAndScript('都市逆袭：被当众退婚的外卖员\n\n订婚宴上，林氏千金当众把婚戒扔在地上。'),
    longFirst: splitTopicAndScript(`${'这是一段很长的正文开头'.repeat(8)}\n后面还有更多内容。`),
    singleShort: splitTopicAndScript('都市逆袭'),
    singleLong: splitTopicAndScript('订婚宴上，林氏千金苏晴当着众宾客的面把婚戒扔在地上，说外卖员陈默癞蛤蟆想吃天鹅肉。'),
    markdown: splitTopicAndScript('# 都市逆袭\n\n订婚宴上，婚戒被扔在地上。'),
    altMarker: splitTopicAndScript('剧本：订婚宴上的对峙\n主题：都市逆袭'),
  }

  // ---- 统一视觉设定 ----
  const { VisualSettingPanel } = await vite.ssrLoadModule('/src/components/VisualSettingPanel.tsx')
  const { buildReferenceTargets, readyReferenceUrls, MAX_CHARACTER_REFS } = await vite.ssrLoadModule('/src/lib/reference.ts')
  const {
    buildVisualSettingMessages,
    parseVisualSetting,
    serializeVisualSetting,
    combineImagePrompt,
  } = await vite.ssrLoadModule('/shared/prompt.mjs')

  // 设定先行：请求里不应再出现任何分镜内容
  const settingMessages = buildVisualSettingMessages({ topic: '都市逆袭', script: '退婚', style: '都市写实' })
  const settingUserText = settingMessages[1].content

  const parsedSetting = parseVisualSetting(
    JSON.stringify({
      characters: [
        {
          name: '陈默',
          appearance: '28岁短发',
          clothing: '深色夹克',
          // 参考图描述里的比例词同样要清洗
          referencePrompt: 'Chen Mo, short hair, dark jacket, plain background, 16:9',
        },
      ],
      sceneLayout: '雨夜天台与写字楼大厅',
      sceneReferencePrompt: 'rainy rooftop at night, empty scene, wet floor',
      artStyle: '电影感写实',
      colorLighting: '冷蓝主调，低照度',
      negative: '肢体变形、水印',
      // 混入清晰度词与比例词，应被清洗掉
      imageAnchor: 'Chen Mo, short hair, dark jacket, 8k, masterpiece, 16:9, rainy rooftop',
      summary: '雨夜冷调写实',
    }),
  )

  // ---- 参考图：从视觉设定推演要生成哪几张 ----
  const referenceTargets = buildReferenceTargets(parsedSetting)
  const charRef = referenceTargets.find((r) => r.kind === 'character')
  const sceneRef = referenceTargets.find((r) => r.kind === 'scene')

  // 参考图描述缺失时要能兜底（用中文外貌+服装拼一段），不能整张不出
  const noRefPromptSetting = parseVisualSetting(
    JSON.stringify({ characters: [{ name: '林薇', appearance: '长发', clothing: '白裙' }] }),
  )
  const fallbackTargets = buildReferenceTargets(noRefPromptSetting)

  // 只把**已成功**的参考图交给后续分镜，失败/进行中的不能混进去
  const readyUrls = readyReferenceUrls([
    { id: 'char:0', kind: 'character', label: 'A', prompt: 'p', status: 'success', url: '/a.png' },
    { id: 'char:1', kind: 'character', label: 'B', prompt: 'p', status: 'loading' },
    { id: 'char:2', kind: 'character', label: 'C', prompt: 'p', status: 'error', error: 'x' },
    { id: 'scene:', kind: 'scene', label: 'S', prompt: 'p', status: 'success', url: '/s.png' },
  ])

  // 非法 JSON 会明确抛错（服务端据此回 500 + 可读文案），字段缺失则补空值不炸
  let badJsonThrew = false
  try {
    parseVisualSetting('not json')
  } catch {
    badJsonThrew = true
  }
  const sparseSetting = parseVisualSetting('{"summary":"只有摘要"}')

  const settingPanelBase = {
    onApply() {},
    onRetry() {},
  }
  const panelSuccess = norm(
    renderToString(
      React.createElement(VisualSettingPanel, { ...settingPanelBase, status: 'success', setting: parsedSetting, error: null }),
    ),
  )
  const panelLoading = norm(
    renderToString(React.createElement(VisualSettingPanel, { ...settingPanelBase, status: 'loading', setting: null, error: null })),
  )
  const panelError = norm(
    renderToString(
      React.createElement(VisualSettingPanel, { ...settingPanelBase, status: 'error', setting: null, error: '模型超时' }),
    ),
  )
  const panelIdle = norm(
    renderToString(React.createElement(VisualSettingPanel, { ...settingPanelBase, status: 'idle', setting: null, error: null })),
  )

  const mdWithSetting = storyboardToMarkdown(
    [shotForCard],
    meta,
    undefined,
    parsedSetting,
  )
  const jsonWithSetting = JSON.parse(storyboardToJson([shotForCard], meta, undefined, parsedSetting))

  const checks = [
    ['App 初始渲染', idleHtml.includes('短剧分镜生成器')],
    ['App 空态提示', idleHtml.includes('还没有分镜')],
    ['输入区三个字段', inputHtml.includes('短剧主题') && inputHtml.includes('剧本') && inputHtml.includes('风格偏好')],
    ['输入区风格预设', inputHtml.includes('赛博朋克') && inputHtml.includes('复古胶片')],
    ['风格分组标题', ['题材调性', '画面色调', '镜头语言'].every((k) => inputHtml.includes(k))],
    ['风格语义标注', inputHtml.includes('最多选 3 个') && inputHtml.includes('可多选')],
    ['题材·计数带上限', inputHtml.includes('已选 2/3')],
    ['题材·主辅徽标', inputHtml.includes('>主<') && inputHtml.includes('>辅<')],
    ['风格说明区渲染', inputHtml.includes('现代都市生活质感')],
    ['未选分组显示占位提示', inputHtml.includes('可叠加多个色调')],
    ['输入区生成按钮', inputHtml.includes('生成分镜')],
    ['成功态·镜头编号', successHtml.includes('镜头 1') && successHtml.includes('镜头 2')],
    ['成功态·镜头类型', successHtml.includes('特写') && successHtml.includes('跟拍')],
    ['成功态·字段齐全', ['画面描述', '人物动作', '台词 / 旁白', '画面提示词'].every((k) => successHtml.includes(k))],
    ['成功态·提示词内容', successHtml.includes('close-up of a young delivery man')],
    ['成功态·工具条', successHtml.includes('共 2 条分镜') && successHtml.includes('复制全部')],
    ['错误态渲染', errorHtml.includes('生成失败') && errorHtml.includes('API Key 无效')],
    ['Markdown 导出', md.includes('# 短剧分镜脚本') && md.includes('画面提示词：')],
    ['JSON 导出', json.shots.length === 2 && json.shots[0].shotType === '特写'],
    ['用户自填 Key 优先', withUserKey.apiKey === 'sk-user-own-key'],
    ['未填时 Key 为空（不再有内置 Key）', fallbackKey.apiKey === ''],
    ['旧键名仍可读到（迁移兼容）', legacyRead.apiKey === 'sk-legacy-key'],
    ['自定义接口地址可存取', customConn.baseUrl === 'https://api.deepseek.com/v1' && customConn.model === 'deepseek-chat'],
    ['保存时归一化尾斜杠', savedBaseUrl === 'https://api.example.com/v1'],

    ['厂商预设·地址正确', getProviderById('deepseek')?.baseUrl === 'https://api.deepseek.com/v1'],
    ['厂商预设·按地址反查', findProviderByBaseUrl('https://api.deepseek.com/v1/')?.id === 'deepseek'],
    ['厂商预设·未知地址返回空', findProviderByBaseUrl('https://unknown.example.com/v1') === undefined],
    ['厂商预设·含自定义项', PROVIDERS.length >= 8 && typeof CUSTOM_PROVIDER_ID === 'string'],
    [
      '厂商预设·模型建议',
      modelSuggestionsFor('deepseek').includes('deepseek-chat') && modelSuggestionsFor(CUSTOM_PROVIDER_ID).length > 0,
    ],

    ['地址·归一化', normalizeBaseUrl('https://x.com/v1/') === 'https://x.com/v1'],
    ['地址·识别内网', isPrivateHostname('127.0.0.1') && isPrivateHostname('localhost') && isPrivateHostname('192.168.1.5')],
    ['地址·公网域名不算内网', !isPrivateHostname('api.openai.com')],
    ['地址·识别云元数据', isMetadataHost('169.254.169.254')],

    ['降级·关键词命中', nextCompatibilityStep('full', { status: 400, bodyText: 'response_format is not supported', streamCapable: true }) === 'no-response-format'],
    ['降级·500 也重试一次', nextCompatibilityStep('full', { status: 500, bodyText: 'oops', streamCapable: false }) === 'no-response-format'],
    ['降级·中文报错也算', nextCompatibilityStep('full', { status: 400, bodyText: '不支持的参数 stream', streamCapable: true }) === 'no-response-format'],
    ['降级·流式再去掉 stream', nextCompatibilityStep('no-response-format', { status: 400, bodyText: 'stream not supported', streamCapable: true }) === 'no-stream'],
    ['降级·非流式不再降', nextCompatibilityStep('no-response-format', { status: 400, bodyText: 'x', streamCapable: false }) === null],
    ['降级·401 不重试', nextCompatibilityStep('full', { status: 401, bodyText: 'unauthorized', streamCapable: true }) === null],
    ['降级·429 不重试', nextCompatibilityStep('full', { status: 429, bodyText: 'rate limit', streamCapable: true }) === null],
    ['降级·正确移除参数', !('response_format' in degraded) && !('stream' in degraded) && degraded.model === 'm'],
    ['题材·首个即主基调', r1.length === 1 && r1[0] === '都市写实'],
    ['题材·按点击顺序追加', r2.length === 2 && r2[0] === '都市写实' && r2[1] === '悬疑暗调'],
    ['题材·最多选 3 个', r3.length === 3],
    ['题材·超限拒绝新项', r4.length === 3 && !r4.includes('古风唯美')],
    ['题材·取消主基调后自动升主', r5.length === 2 && getToneTags(r5)[0] === '悬疑暗调'],
    ['题材·互换主次', r6[0] === '悬疑暗调' && r6[1] === '都市写实'],
    ['题材·跨组共存不影响主基调', r7.includes('冷色调') && getToneTags(r7)[0] === '都市写实'],
    ['题材·非题材 id 不参与编排', r8[0] === '都市写实' && r8.includes('冷色调')],
    ['色调·多选组可叠加', m2.length === 2 && m2.includes('暖色调') && m2.includes('高对比')],
    ['色调·多选组可单独取消', m3.length === 1 && m3[0] === '高对比'],
    [
      '文案·结构化多行',
      composeStyle(['悬疑暗调', '甜宠清新', '冷色调', '高对比', '手持纪实'], '暖调电影感') ===
        '题材主基调：悬疑暗调\n题材辅助元素：甜宠清新\n画面色调：冷色调、高对比\n镜头语言：手持纪实\n自定义补充：暖调电影感',
    ],
    ['文案·仅色调时不出现题材行', composeStyle(['冷色调'], '') === '画面色调：冷色调'],
    ['文案·仅自定义文本', composeStyle([], '暖调') === '自定义补充：暖调'],
    ['文案·空值拼接安全', composeStyle(undefined, '  ') === ''],
    [
      '摘要·单行主次',
      summarizeStyle(['悬疑暗调', '甜宠清新', '冷色调'], '') === '悬疑暗调（主基调） · 甜宠清新 · 冷色调',
    ],
    ['清洗·剔除清晰度与比例', cleaned === 'close-up of a young delivery man, cinematic, film grain'],
    ['清洗·不误删正常词', cleaned.includes('cinematic') && cleaned.includes('film grain') && cleaned.includes('close-up')],
    ['清洗·无残留违禁词', !/8k|16:9|masterpiece|ultra detailed/i.test(cleaned)],
    ['清洗·全命中回落空串', sanitizeImagePrompt('8k, 4k, masterpiece') === ''],
    ['清洗·空值安全', sanitizeImagePrompt(undefined) === ''],

    ['进度·四个阶段文案', ['正在分析剧本', '正在调用大模型', '正在生成分镜', '正在整理结果'].every((k) => progressHtml.includes(k))],
    ['进度·显示已用时间', progressHtml.includes('已用 ')],
    ['进度·可取消', progressHtml.includes('取消生成')],
    ['进度·已生成条数行', progressHtml.includes('已生成分镜') && progressHtml.includes('3 / 5 条')],
    ['进度·估算值标「约」', progressEstimatedHtml.includes('约 3 / 5 条')],

    ['卡片·0 条时只有 1 张骨架', cards(loading0) === 1 && partialCards(loading0) === 0],
    ['卡片·2 条时显示真实文字', partialCards(loading2) === 2 && loading2.includes('第 1 条的画面描述')],
    ['卡片·2 条时仍有 1 张骨架', cards(loading2) === 1],
    ['卡片·显示序号与镜头类型', loading2.includes('镜头 1') && loading2.includes('特写')],
    ['卡片·5 条时已无骨架', cards(loading5) === 0 && partialCards(loading5) === 5],
    ['卡片·不泄露未写到的条', !loading2.includes('第 3 条的画面描述')],
    ['卡片·仍显示进度清单', loading0.includes('生成进度')],

    ['部分解析·完整 5 条', parseCompletedShots(fiveShots).length === 5],
    ['部分解析·截断到 2 条', parseCompletedShots(fiveShots.slice(0, cutAfter2)).length === 2],
    [
      '部分解析·字段提取正确',
      (() => {
        const s = parseCompletedShots(fiveShots)[0]
        return s.shotNumber === 1 && s.sceneDescription === 'x' && s.shotType === '中景'
      })(),
    ],
    ['部分解析·空值安全', parseCompletedShots('').length === 0 && parseCompletedShots(null).length === 0],
    ['部分解析·忽略残缺对象', parseCompletedShots('{"shots":[{"shotNumber":1,"sceneDescription":"半截').length === 0],
    ['部分解析·忽略空对象', parseCompletedShots('{"shots":[{},{"shotNumber":1}]}').length === 0],
    ['部分解析·封顶 5', parseCompletedShots(fiveShots + fiveShots).length === 5],

    ['图片·百炼尺寸用星号', bailianReq.body.parameters.size === '1920*1080'],
    ['图片·百炼不带不支持的参数', !('negative_prompt' in bailianReq.body) && !('prompt_extend' in bailianReq.body.parameters)],
    ['图片·百炼端点路径', bailianReq.path === '/api/v1/services/aigc/multimodal-generation/generation'],

    // ---- 参考图注入 ----
    ['参考图·无图时 content 只有文本', bailianReq.body.input.messages[0].content.length === 1],
    ['参考图·文本仍在第一位', bailianRefContent[0].text === 'a cat'],
    ['参考图·以 image 对象追加', bailianRefContent.length === 3 && bailianRefContent[1].image === 'data:image/png;base64,AAA'],
    ['参考图·顺序保持', bailianRefContent[2].image === 'data:image/png;base64,BBB'],
    ['参考图·超过 4 张被截断', bailianTooMany.body.input.messages[0].content.length === 5],
    ['参考图·能力元数据可查', IMAGE_ADAPTERS.bailian.maxReferenceImages === 4],
    ['参考图·OpenAI 暂不支持（标注为 0）', IMAGE_ADAPTERS.openai.maxReferenceImages === 0],
    ['参考图·OpenAI 请求体不夹带', !JSON.stringify(openaiWithRefs.body).includes('base64')],
    ['图片·OpenAI 尺寸用字母x', openaiReq.body.size === '1536x1024'],
    ['图片·OpenAI 端点路径', openaiReq.path === '/images/generations'],
    ['图片·OpenAI 不带 response_format', !('response_format' in openaiReq.body)],
    [
      '图片·百炼取图路径',
      IMAGE_ADAPTERS.bailian.extractImages({
        output: { choices: [{ message: { content: [{ type: 'image', image: 'https://x/a.png' }] } }] },
      })[0]?.url === 'https://x/a.png',
    ],
    ['图片·OpenAI 取 url', IMAGE_ADAPTERS.openai.extractImages({ data: [{ url: 'https://x/a.png' }] })[0]?.url === 'https://x/a.png'],
    [
      '图片·OpenAI 取 b64',
      IMAGE_ADAPTERS.openai.extractImages({ data: [{ b64_json: 'AAAA' }] })[0]?.base64 === 'AAAA',
    ],
    ['图片·异常结构返回空', IMAGE_ADAPTERS.openai.extractImages({ nope: 1 }).length === 0 && IMAGE_ADAPTERS.bailian.extractImages(null).length === 0],


    ['缓存·同输入键稳定', cacheKeyA === cacheKeyB && cacheKeyA.endsWith('.png')],
    ['缓存·加盐后键不同', cacheKeyForced !== cacheKeyA],
    ['缓存·参考图不同则键不同', cacheKeyRefA !== cacheKeyRefB && cacheKeyRefA !== cacheKeyA],
    ['缓存·文件名白名单', isSafeCacheFile(`${'a'.repeat(40)}.png`) === true],
    ['缓存·拒绝路径穿越', isSafeCacheFile('../../app.mjs') === false && isSafeCacheFile('x.png') === false],

    ['设置·带出各家配置', imageSettings.imageProvider === 'openai' && imageSettings.imageConfigs.openai.model === 'gpt-image-1'],
    ['设置·图片尺寸随家保存', imageSettings.imageConfigs.openai.size === '1536x1024'],
    ['设置·当前服务商配置必存在', Boolean(imageSettings.imageConfigs[imageSettings.imageProvider])],
    ['设置·已无自动配图开关', !('imageEnabled' in imageSettings)],
    ['超时·秒按秒存', imageSettings.imageConfigs.openai.timeoutSeconds === 300],
    ['超时·老字段 timeoutMs 不沿用', imageSettings.imageConfigs.openai.timeoutSeconds !== 180],
    ['超时·秒转毫秒', imageTimeoutMs(imageSettings.imageConfigs.openai) === 300_000],
    ['超时·未填时交给服务端默认', imageTimeoutMs({ baseUrl: '', apiKey: '', model: '' }) === undefined],
    ['超时·非法值忽略', imageTimeoutMs({ baseUrl: '', apiKey: '', model: '', timeoutSeconds: -5 }) === undefined],
    ['图片 Key·同源复用文本 Key', resolveImageApiKey(sameHostSettings, noKeyImageCfg) === 'sk-text'],
    ['图片 Key·跨服务不复用', resolveImageApiKey(crossHostSettings, noKeyImageCfg) === ''],
    ['图片 Key·自己填的优先', resolveImageApiKey(crossHostSettings, ownKeyImageCfg) === 'sk-img-own'],

    ['适配器·手机端只提供两家', listImageAdapters({ native: true }).length === 2],
    ['适配器·桌面端两家齐全', listImageAdapters().length === 2],
    ['适配器·百炼手机端可用', isAdapterAvailableOn('bailian', { native: true }) === true],

    ['适配器元数据·含默认值', listImageAdapters().find((a) => a.id === 'bailian')?.defaultModel === 'wan2.7-image-pro'],
    ['适配器元数据·百炼不再提供方图', !(listImageAdapters().find((a) => a.id === 'bailian')?.sizeOptions ?? []).some((o) => o.value === '2048*2048')],
    ['适配器元数据·OpenAI 不再提供方图', !(listImageAdapters().find((a) => a.id === 'openai')?.sizeOptions ?? []).some((o) => o.value === '1024x1024')],

    ['错误文案·鉴权失败', describeImageError('bailian', 401, '{}').includes('鉴权失败')],
    ['错误文案·内容审核', describeImageError('bailian', 400, '{"code":"data_inspection_failed"}').includes('内容审核')],
    ['错误文案·限流', describeImageError('bailian', 429, '{}').includes('限流')],
    ['错误文案·OpenAI 尺寸提示', describeImageError('openai', 400, '{}').includes('固定枚举')],

    ['卡片·不传配图时无图片块', !cardNoImage.includes('<img')],
    ['卡片·成功态渲染图片', cardOk.includes('<img') && cardOk.includes('loading="lazy"')],
    ['卡片·成功态图片地址正确', cardOk.includes('/api/image-cache/abc.png')],
    ['卡片·加载态提示', cardLoading.includes('正在生成配图')],
    ['卡片·失败态可重试', cardError.includes('重试') && cardError.includes('生成失败')],
    ['卡片·未生成时提供生成入口', cardIdle.includes('生成配图')],
    ['卡片·未生成时不提前出现图片框', !cardIdle.includes('aspect-video')],
    ['卡片·配图旁有模型选择', cardIdle.includes('<select') && cardIdle.includes('选择配图使用的模型服务')],
    ['卡片·模型选择含跟随文本模型项', cardIdle.includes('跟随文本模型')],
    ['卡片·模型选择列出各服务商', cardIdle.includes('百炼') && cardIdle.includes('OpenAI')],
    ['卡片·加载态才出现图片框', cardLoading.includes('aspect-video')],
    ['卡片·失败态保留图片框', cardError.includes('aspect-video')],

    ['结果区·配图进度行', imageRowHtml.includes('正在生成配图') && imageRowHtml.includes('1 / 2')],
    ['结果区·可停止配图', imageRowHtml.includes('停止')],
    ['结果区·批量生成入口', imageRowHtml.includes('生成全部配图')],
    ['导出·不写入 dataURL', !dataUrlMd.includes('data:image') && !('imageUrl' in dataUrlJson.shots[0])],

    // ---- 统一视觉设定 ----
    // 设定先行：请求里不能夹带分镜（那时还没有分镜），只能靠主题与剧本推断
    ['设定·不再夹带分镜清单', !settingUserText.includes('已完成的分镜') && !settingUserText.includes('镜头 1')],
    ['设定·仍带主题与剧本', settingUserText.includes('都市逆袭') && settingUserText.includes('退婚')],
    ['设定·仍带风格偏好', settingUserText.includes('都市写实')],
    ['设定·要求产出英文参考图描述', settingMessages[0].content.includes('referencePrompt') && settingMessages[0].content.includes('sceneReferencePrompt')],

    // ---- 参考图 ----
    ['参考图·角色与场景各一张', Boolean(charRef) && Boolean(sceneRef)],
    ['参考图·角色带名字与提示词', charRef?.label === '陈默' && String(charRef?.prompt).includes('Chen Mo')],
    ['参考图·id 稳定可定位', charRef?.id === 'char:0' && sceneRef?.id === 'scene:'],
    ['参考图·初始状态为待生成', charRef?.status === 'idle'],
    ['参考图·描述里的比例词被清洗', !String(charRef?.prompt).includes('16:9')],
    ['参考图·缺描述时用外貌服装兜底', fallbackTargets.length === 1 && String(fallbackTargets[0]?.prompt).includes('白裙')],
    ['参考图·设定为空时不产出', buildReferenceTargets(null).length === 0],
    ['参考图·只收集已成功的', JSON.stringify(readyUrls) === JSON.stringify(['/a.png', '/s.png'])],
    ['参考图·角色上限为 4', MAX_CHARACTER_REFS === 4],


    ['设定·要求覆盖剧本主要角色', settingMessages[0].content.includes('覆盖剧本主要出场角色')],

    ['设定解析·角色字段', parsedSetting.characters.length === 1 && parsedSetting.characters[0].name === '陈默'],
    ['设定解析·各字段完整', parsedSetting.sceneLayout.includes('天台') && parsedSetting.artStyle.includes('写实')],
    ['设定解析·负面约束', parsedSetting.negative.includes('水印')],
    ['设定解析·锚定清洗掉清晰度词', !/8k|masterpiece/i.test(parsedSetting.imageAnchor)],
    ['设定解析·锚定清洗掉比例词', !/16:9/.test(parsedSetting.imageAnchor)],
    ['设定解析·锚定保留有效内容', parsedSetting.imageAnchor.includes('Chen Mo') && parsedSetting.imageAnchor.includes('rainy rooftop')],
    ['设定解析·非法 JSON 明确抛错', badJsonThrew],
    ['设定解析·字段缺失补空值不炸', sparseSetting.summary === '只有摘要' && sparseSetting.imageAnchor === '' && sparseSetting.characters.length === 0],

    ['拼接·锚定在前分镜在后', combineImagePrompt('anchor A', 'shot B') === 'anchor A, shot B'],
    ['拼接·无锚定时原样返回', combineImagePrompt('', 'shot B') === 'shot B'],
    ['拼接·无分镜时返回锚定', combineImagePrompt('anchor A', '') === 'anchor A'],
    ['拼接·两者都空返回空', combineImagePrompt(null, null) === ''],

    [
      '序列化·含角色与锚定',
      serializeVisualSetting(parsedSetting).includes('陈默') && serializeVisualSetting(parsedSetting).includes('锚定提示词'),
    ],
    ['序列化·空值安全', serializeVisualSetting(null) === ''],

    ['设定面板·成功态展示各字段', panelSuccess.includes('统一视觉设定') && panelSuccess.includes('雨夜冷调写实')],
    ['设定面板·展示角色与服装', panelSuccess.includes('陈默') && panelSuccess.includes('深色夹克')],
    ['设定面板·展示场景画风色调', panelSuccess.includes('核心场景') && panelSuccess.includes('整体画风') && panelSuccess.includes('色调光线')],
    ['设定面板·锚定提示词可编辑', panelSuccess.includes('锚定提示词') && panelSuccess.includes('<textarea')],
    ['设定面板·提供应用按钮', panelSuccess.includes('应用并重新生成配图')],
    ['设定面板·加载态', panelLoading.includes('正在生成统一视觉设定')],
    ['设定面板·失败态带重试', panelError.includes('生成失败') && panelError.includes('模型超时') && panelError.includes('重试')],
    ['设定面板·失败时说明可降级', panelError.includes('按各条分镜自己的提示词')],
    ['设定面板·idle 不渲染', panelIdle === ''],

    ['导出·Markdown 带视觉设定', mdWithSetting.includes('## 统一视觉设定') && mdWithSetting.includes('雨夜冷调写实')],
    ['导出·Markdown 带锚定提示词', mdWithSetting.includes('Chen Mo')],
    ['导出·JSON 带视觉设定', jsonWithSetting.visualSetting?.artStyle === '电影感写实'],
    ['导出·无设定时 JSON 为 null', JSON.parse(storyboardToJson([shotForCard], meta)).visualSetting === null],


    ['快速粘贴·有粘贴框', inputHtml.includes('快速粘贴') && inputHtml.includes('quick-paste')],
    ['快速粘贴·说明拆分规则', inputHtml.includes('首行当主题')],
    ['拆分·显式标记优先', splitCases.marked.topic === '都市逆袭' && splitCases.marked.script.includes('婚戒')],
    ['拆分·只有主题标记时其余算剧情', splitCases.onlyTopic.topic === '都市逆袭' && splitCases.onlyTopic.script.includes('订婚宴')],
    [
      '拆分·无标记时首行当主题',
      splitCases.firstLine.topic === '都市逆袭：被当众退婚的外卖员' && splitCases.firstLine.script.includes('订婚宴'),
    ],
    ['拆分·首行过长则整段当剧情', splitCases.longFirst.topic === '' && splitCases.longFirst.script.includes('后面还有更多内容')],
    ['拆分·单行短文本当主题', splitCases.singleShort.topic === '都市逆袭' && splitCases.singleShort.script === ''],
    ['拆分·单行长文本当剧情', splitCases.singleLong.topic === '' && splitCases.singleLong.script.includes('订婚宴')],
    ['拆分·剥离 markdown 装饰符', splitCases.markdown.topic === '都市逆袭'],
    ['拆分·标记顺序无关', splitCases.altMarker.topic === '都市逆袭' && splitCases.altMarker.script.includes('对峙')],
    ['拆分·空值安全', splitTopicAndScript('').topic === '' && splitTopicAndScript(null).script === ''],
    ['拆分·主题不超过上限', splitTopicAndScript('主'.repeat(59) + '\n正文').topic.length === 59],
    ['阶段枚举完整有序', PHASE_ORDER.length === 4 && PHASE_META.parsing.label === '正在整理结果'],
    [
      'APK 估算时间表·边界',
      estimatePhaseAt(0) === 'preparing' &&
        estimatePhaseAt(699) === 'preparing' &&
        estimatePhaseAt(700) === 'calling' &&
        estimatePhaseAt(3199) === 'calling' &&
        estimatePhaseAt(3200) === 'generating' &&
        estimatePhaseAt(1e9) === 'generating',
    ],
    ['平滑·首帧立即展示', resolvePhaseDelay('preparing', null, 0) === 0],
    ['平滑·补足最短展示时长', resolvePhaseDelay('calling', 'preparing', 100, 600) === 500],
    ['平滑·停留已足够则立即', resolvePhaseDelay('calling', 'preparing', 900, 600) === 0],
    ['平滑·回退时立即切换', resolvePhaseDelay('preparing', 'generating', 0, 600) === 0],
  ]

  let failed = 0
  for (const [name, ok] of checks) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
    if (!ok) failed++
  }
  console.log(failed === 0 ? '\n全部通过 ✓' : `\n${failed} 项失败 ✗`)
  process.exitCode = failed === 0 ? 0 : 1
} catch (err) {
  console.error('渲染异常：', err)
  process.exitCode = 1
} finally {
  await vite.close()
}
