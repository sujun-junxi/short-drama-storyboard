/**
 * 分镜生成的核心逻辑 —— 前后端共用同一份。
 *
 * Web / 桌面端：由 server/index.mjs 引入，在 Node 侧组装请求并解析返回。
 * APK（Capacitor）：由前端直接引入，用 CapacitorHttp 直连模型服务时复用同一套
 *                   prompt 与解析逻辑，避免两套实现漂移。
 */

/** 允许的镜头类型，用于约束模型输出 */
export const SHOT_TYPES = [
  '特写',
  '近景',
  '中景',
  '全景',
  '远景',
  '过肩镜头',
  '俯拍',
  '仰拍',
  '推镜头',
  '拉镜头',
  '摇镜头',
  '跟拍',
  '手持镜头',
]

/** 可选模型（下拉框顺序即推荐顺序） */
export const MODEL_OPTIONS = [
  { value: 'qwen-plus', label: 'qwen-plus（推荐 · 均衡）' },
  { value: 'qwen-max', label: 'qwen-max（效果最佳）' },
  { value: 'qwen-turbo', label: 'qwen-turbo（最快）' },
  { value: 'qwen-flash', label: 'qwen-flash（最省）' },
]

/** 默认接口地址（北京地域） */
export const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'

export const SYSTEM_PROMPT = `你是一位资深短剧导演兼分镜师，长期服务于横屏短剧创作，擅长把文字剧本翻译成可执行的拍摄脚本与 AI 绘图提示词。

请根据用户给出的「短剧主题」「剧本」「风格偏好」，输出 5 个连续镜头构成的分镜表，形成一个有起承转合的微型叙事段落。

## 输出格式（严格遵守）
只输出一个 JSON 对象，不要输出任何解释、前后缀文字或 markdown 代码块。结构如下：
{"shots":[ {shot1}, {shot2}, {shot3}, {shot4}, {shot5} ]}

每个镜头对象包含且仅包含以下 6 个字段：
1. "shotNumber"：整数，镜头编号，依次为 1、2、3、4、5。
2. "sceneDescription"：画面描述，60-100 字。写清场景、时间、光线、构图与情绪氛围，让人读完能想象出画面。
3. "characterAction"：人物动作，20-50 字。写具体可执行的表演动作，不要写心理活动。
4. "dialogue"：台词或旁白。写成「角色名：台词」的格式；若该镜头无台词，写「（无台词，环境音：XXX）」。
5. "shotType"：镜头类型，只能从以下列表中选一个：${SHOT_TYPES.join('、')}。
6. "imagePrompt"：画面提示词。一段英文 AI 文生图提示词，用逗号分隔短语，顺序为：主体与外貌、动作、环境、光线、镜头与景别、风格词。不要换行，不要包含中文。严禁出现任何清晰度/画质词（如 8k、4k、高清、masterpiece、best quality、ultra detailed、HDR、UHD）与任何画面比例词（如 16:9、9:16、3:2、4:3、1:1、aspect ratio）。横屏短剧画幅固定，比例词会干扰下游文生图。

## 内容要求
- 5 个镜头要有节奏变化：不要连续 3 个镜头使用相同的 shotType。
- 镜头之间要有叙事推进：建议覆盖「建立情境 → 冲突出现 → 情绪升级 → 转折 → 收尾钩子」。
- 台词要口语化、短促、有钩子，符合横屏短剧前三秒抓人的特点；不要书面语。
- 题材主次：当用户给出多个题材时，第一个为「主基调」，主导全片的气质、节奏与色彩倾向；其余为「辅助元素」，作为局部元素自然融入，不得与主基调平均用力，也不得互相矛盾。
- imagePrompt 禁止画质词与比例词：不要写 8k、4k、1080p、高清、超清、masterpiece、best quality、ultra detailed、HDR、UHD 等清晰度描述，也不要写 16:9、9:16、3:2、4:3、1:1、aspect ratio、1920x1080 等比例描述。画幅在后期统一处理，出现这些词会干扰文生图。
- 除 imagePrompt 外，所有内容使用简体中文。
- 内容必须符合中国法律法规与公序良俗。若用户输入包含暴力、色情、违法或政治敏感内容，请输出 {"shots":[],"refused":"请更换健康合规的创作主题"}。`

/**
 * 把统一视觉设定对象序列化成可读文本，注入分镜提示词的【统一视觉设定】段。
 * 仅用于给文本模型看，不影响配图（配图直接拼 imageAnchor）。
 */
export function serializeVisualSetting(vs) {
  if (!vs || typeof vs !== 'object') return ''
  const lines = []
  const chars = Array.isArray(vs.characters) ? vs.characters : []
  if (chars.length) {
    lines.push('角色：')
    for (const c of chars) {
      const name = String(c?.name ?? '').trim() || '未知角色'
      const appearance = String(c?.appearance ?? '').trim()
      const clothing = String(c?.clothing ?? '').trim()
      lines.push(`- ${name}：外貌 ${appearance || '—'}；服装 ${clothing || '—'}`)
    }
  }
  if (vs.sceneLayout) lines.push(`核心场景布局：${vs.sceneLayout}`)
  if (vs.artStyle) lines.push(`整体画风：${vs.artStyle}`)
  if (vs.colorLighting) lines.push(`色调光线：${vs.colorLighting}`)
  if (vs.negative) lines.push(`负面约束：${vs.negative}`)
  if (vs.imageAnchor) lines.push(`锚定提示词（拼接前缀）：${vs.imageAnchor}`)
  return lines.join('\n')
}

export function buildUserPrompt({ topic, script, style, visualSetting } = {}) {
  const settingBlock = visualSetting
    ? `\n【统一视觉设定（务必遵守，保证整组画面一致）】\n${serializeVisualSetting(visualSetting)}\n\n注意：每条分镜的 imagePrompt 必须与上述统一视觉设定保持一致（尤其是角色外貌、服装、场景空间与画风），不要引入相互矛盾的视觉信息。\n`
    : ''
  return `请为下面这部短剧生成分镜。

【短剧主题】${topic || '（用户未填写，请根据剧本自行归纳）'}

【剧本】
${script || '（用户未提供剧本，请根据主题原创一段可用的剧情）'}

【风格偏好】
${style || '（未指定，默认都市写实）'}
${settingBlock}
请输出 5 个镜头的 JSON 分镜表。`
}

/** 组装完整的 messages，Web/桌面/APK 三端共用 */
export function buildMessages({ topic, script, style, visualSetting } = {}) {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt({ topic, script, style, visualSetting }) },
  ]
}

// ---------------- 统一视觉设定（视觉圣经） ----------------

/**
 * 视觉圣经（Visual Bible）的 system prompt：让模型一次性产出一份固定整组画面的
 * 统一视觉设定（角色外貌/服装、场景布局、画风、色调光线、负面约束，以及可直接拼到
 * 每条分镜提示词前的英文锚定提示词 imageAnchor）。
 */
export const SYSTEM_PROMPT_VISUAL_SETTING = `你是一位资深美术指导（Production Designer）与视觉开发艺术家，擅长为短剧 / 影视项目制定统一的「视觉圣经（Visual Bible）」，确保整组画面在角色、场景、画风上高度一致。

请根据用户给出的「短剧主题」「剧本」「风格偏好」，输出一份用于固定整组分镜画面的「统一视觉设定」。

## 输出格式（严格遵守）
只输出一个 JSON 对象，不要输出任何解释、前后缀文字或 markdown 代码块。结构如下：
{
  "characters": [ { "name": "角色名", "appearance": "外貌特征（年龄/性别/发型/面部/体型/辨识度）", "clothing": "服装（款式/颜色/配饰，须可复现）", "referencePrompt": "一段英文逗号分隔的短语，用于单独生成这个角色的参考图。要求：纯色/中性背景、正面半身、单人、光线均匀、服装与外貌特征写全，便于后续当参考图复用。不要中文、不要换行、不要清晰度词与比例词。" } ],
  "sceneLayout": "核心场景空间布局：主要场景有哪些、各自的空间关系与关键道具陈设。",
  "sceneReferencePrompt": "一段英文逗号分隔的短语，用于生成核心场景的参考图。要求：空镜（不出现人物）、交代空间布局与关键陈设、画风与色调与设定一致。不要中文、不要换行、不要清晰度词与比例词。",
  "artStyle": "整体画风：如电影感写实、日系动漫、赛博朋克、胶片、莫兰迪等。",
  "colorLighting": "色调与光线：主色调、光影方向、氛围（暖/冷、明暗）。",
  "negative": "负面约束：应避免的元素（肢体变形、多余手指、水印、无关文字、低质模糊等）。",
  "imageAnchor": "一段英文逗号分隔的锚定提示词，用于拼接到每条分镜提示词前以保证统一。顺序：角色与外貌、服装、场景空间、画风、色调光线。不要换行、不要中文、不要清晰度词（如 8k、masterpiece、best quality）、不要比例词（如 16:9、aspect ratio）。",
  "summary": "一句中文总结，便于在界面展示。"
}

## 要求
- characters 覆盖剧本主要出场角色，外貌与服装要具体、可复现，避免「普通」「正常」这类空泛词。
- imageAnchor 必须可直接拼到每条分镜提示词前；用逗号分隔短语；控制在 40 个短语以内，过长会被截断。
- referencePrompt 与 sceneReferencePrompt 是给文生图模型单独出参考图用的，必须是**英文**、可直接送进模型，不能只是中文描述的翻译腔。
- 内容必须符合中国法律法规与公序良俗。
- 若用户输入包含暴力、色情、违法或政治敏感内容，请输出 {"characters":[],"sceneLayout":"","artStyle":"","colorLighting":"","negative":"","imageAnchor":"","summary":"请更换健康合规的创作主题"}。`

/**
 * 统一视觉设定的请求消息。
 *
 * 刻意**不接收分镜** —— 设定在分镜之前产出，此时还没有分镜可参考。
 * 角色与场景的范围只能由主题和剧本推断（见 SYSTEM_PROMPT_VISUAL_SETTING 的要求）。
 */
export function buildVisualSettingMessages({ topic, script, style } = {}) {
  return [
    { role: 'system', content: SYSTEM_PROMPT_VISUAL_SETTING },
    {
      role: 'user',
      content: `请为下面这部短剧制定统一视觉设定。

【短剧主题】${topic || '（用户未填写，请根据剧本自行归纳）'}

【剧本】
${script || '（用户未提供剧本，请根据主题原创一段可用的剧情）'}

【风格偏好】
${style || '（未指定，默认都市写实）'}

请输出统一视觉设定的 JSON。`,
    },
  ]
}

/** 目标分镜条数（提示词与进度统计共用同一来源） */
export const SHOT_COUNT = 5

/** 推荐给模型服务的采样参数，三端保持一致 */
export const SAMPLING_PARAMS = { temperature: 0.85, top_p: 0.9, response_format: { type: 'json_object' } }

// ---------------- 解析与归一化 ----------------

/** 字段别名：兼容模型偶尔使用中文或下划线键名的情况 */
const FIELD_ALIASES = {
  shotNumber: ['shotNumber', 'shot_number', 'shot', '镜头编号', '镜号', '编号', 'index'],
  sceneDescription: ['sceneDescription', 'scene_description', '画面描述', '画面', '场景描述'],
  characterAction: ['characterAction', 'character_action', '人物动作', '动作', '表演'],
  dialogue: ['dialogue', 'line', '台词', '台词或旁白', '旁白', '对白'],
  shotType: ['shotType', 'shot_type', '镜头类型', '景别', '运镜'],
  imagePrompt: ['imagePrompt', 'image_prompt', '画面提示词', '提示词', '绘图提示词'],
}

function pickField(obj, aliases) {
  for (const key of aliases) {
    const value = obj?.[key]
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim()
  }
  return ''
}

function normalizeShotType(value) {
  if (!value) return '中景'
  const hit = SHOT_TYPES.find((t) => value.includes(t))
  return hit ?? value
}

// ---------------- imagePrompt 清洗 ----------------

/**
 * 命中即整段剔除的禁用短语（均非全局，供逐段 test 判定）。
 * 分三类：分辨率/清晰度、画质口号、宽高比。
 */
const BANNED_PROMPT_PATTERNS = [
  /\b(?:8k|4k|2k|1080p|720p|480p|uhd|hdr|hd|full\s*hd)\b/i,
  /高清|超清|超高清|蓝光|高分辨率/,
  /high\s*resolution|high-res/i,
  /masterpiece|best\s*quality|highest\s*quality|top\s*quality|high\s*quality|ultra[-\s]?detailed|highly\s*detailed|super\s*detailed/i,
  // 限定常见比例，避免把 13:25 这类时间误判（数字紧邻数字时不构成词边界）
  /\b(?:16\s*[:：]\s*9|9\s*[:：]\s*16|4\s*[:：]\s*3|3\s*[:：]\s*4|3\s*[:：]\s*2|2\s*[:：]\s*3|21\s*[:：]\s*9|1\s*[:：]\s*1)\b/,
  /\baspect\s*ratio\b/i,
  /\b\d{3,4}\s*[x×]\s*\d{3,4}\b/i,
]

/** 兜底用的合并全局正则 */
const BANNED_PROMPT_GLOBAL = new RegExp(BANNED_PROMPT_PATTERNS.map((re) => re.source).join('|'), 'gi')

/**
 * 清洗模型生成的 imagePrompt：按逗号切分短语，整段剔除命中的
 * 「清晰度 / 画质口号 / 宽高比」，再重组。与 normalizeShotType 对称。
 *
 * 用「整段剔除」而不是全局替换，是为了不误伤 cinematic、film grain、
 * close-up 这类正常内容。只作用于模型输出，用户自填的风格文本不经过这里。
 */
export function sanitizeImagePrompt(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''

  const kept = raw
    .split(/[,，]/)
    .map((phrase) => phrase.trim())
    .filter(Boolean)
    .filter((phrase) => !BANNED_PROMPT_PATTERNS.some((re) => re.test(phrase)))

  const cleaned = kept.join(', ')
  if (cleaned) return cleaned

  // 兜底：所有短语都被剔除时，改为整串剥离违禁词，尽量留下可用内容。
  // 硬约束是绝不输出违禁词，因此极端情况下宁可返回空串。
  return raw
    .replace(BANNED_PROMPT_GLOBAL, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,，]+|[\s,，]+$/g, '')
    .trim()
}

/**
 * 从流式中（可能残缺的）content 里提取**已完整写完**的分镜，用于边生成边展示。
 *
 * shot 对象没有嵌套（6 个字段都是标量），所以 /{[^{}]*}/ 能精确切出已闭合的对象，
 * 且不会匹配外层含 `[` 的 {"shots":[…]}。逐个 JSON.parse，失败说明该段仍残缺，跳过。
 */
export function parseCompletedShots(content) {
  const text = String(content ?? '')
  if (!text) return []

  const out = []
  for (const match of text.matchAll(/\{[^{}]*\}/g)) {
    let obj
    try {
      obj = JSON.parse(match[0])
    } catch {
      continue
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) continue

    const sceneDescription = pickField(obj, FIELD_ALIASES.sceneDescription)
    // 必须有画面描述才算有效分镜，挡掉 {} 这类空对象
    if (!sceneDescription) continue

    out.push({
      shotNumber: Number(pickField(obj, FIELD_ALIASES.shotNumber)) || out.length + 1,
      sceneDescription,
      shotType: normalizeShotType(pickField(obj, FIELD_ALIASES.shotType)),
    })
    if (out.length >= SHOT_COUNT) break
  }

  return out
}

function safeJson(text) {
  let s = String(text ?? '').trim()
  if (!s) throw new Error('模型返回内容为空。')

  // 去掉 ```json ... ``` 代码块包裹
  const fenced = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fenced) s = fenced[1].trim()

  // 截取首尾花括号之间的内容，丢弃多余的解释文字
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start !== -1 && end > start) s = s.slice(start, end + 1)

  try {
    return JSON.parse(s)
  } catch {
    const arrStart = s.indexOf('[')
    const arrEnd = s.lastIndexOf(']')
    if (arrStart !== -1 && arrEnd > arrStart) return JSON.parse(s.slice(arrStart, arrEnd + 1))
    throw new Error(`模型返回的不是合法 JSON：${s.slice(0, 200)}`)
  }
}

/**
 * 把模型返回的原始文本解析成标准化分镜数组。
 * @returns {{ shots: Array, refused?: string|null }}
 */
export function parseShots(content) {
  const data = safeJson(content)
  if (data?.refused && Array.isArray(data.shots) && data.shots.length === 0) {
    return { shots: [], refused: String(data.refused) }
  }

  const list =
    data?.shots ?? data?.storyboard ?? data?.storyboards ?? data?.分镜 ?? data?.data ?? (Array.isArray(data) ? data : null)

  if (!Array.isArray(list)) throw new Error('模型返回的数据中没有找到分镜数组，请重试。')

  const shots = list
    .map((item, i) => ({
      shotNumber: Number(pickField(item, FIELD_ALIASES.shotNumber)) || i + 1,
      sceneDescription: pickField(item, FIELD_ALIASES.sceneDescription),
      characterAction: pickField(item, FIELD_ALIASES.characterAction),
      dialogue: pickField(item, FIELD_ALIASES.dialogue),
      shotType: normalizeShotType(pickField(item, FIELD_ALIASES.shotType)),
      imagePrompt: sanitizeImagePrompt(pickField(item, FIELD_ALIASES.imagePrompt)),
    }))
    .filter((s) => s.sceneDescription || s.dialogue || s.imagePrompt)

  if (shots.length === 0) throw new Error('模型返回的分镜内容为空，请重试。')
  return { shots }
}

// ---------------- 统一视觉设定：解析与拼接 ----------------

/**
 * 把模型返回的原始文本解析成结构化统一视觉设定，并对 imageAnchor 做清洗
 * （剔除清晰度词 / 比例词，与下游文生图保持一致）。
 * 容错：缺字段填默认、characters 过滤空项，保证前端一定能拿到可用对象。
 */
export function parseVisualSetting(content) {
  const data = safeJson(content)
  const vs = {
    characters: [],
    sceneLayout: '',
    sceneReferencePrompt: '',
    artStyle: '',
    colorLighting: '',
    negative: '',
    imageAnchor: '',
    summary: '',
  }

  if (Array.isArray(data?.characters)) {
    vs.characters = data.characters
      .map((c) => ({
        name: String(c?.name ?? '').trim(),
        appearance: String(c?.appearance ?? '').trim(),
        clothing: String(c?.clothing ?? '').trim(),
        // 参考图描述同样要清洗：比例词会干扰下游文生图
        referencePrompt: sanitizeImagePrompt(c?.referencePrompt ?? ''),
      }))
      .filter((c) => c.name || c.appearance || c.clothing)
  }

  vs.sceneLayout = String(data?.sceneLayout ?? '').trim()
  vs.sceneReferencePrompt = sanitizeImagePrompt(data?.sceneReferencePrompt ?? '')
  vs.artStyle = String(data?.artStyle ?? '').trim()
  vs.colorLighting = String(data?.colorLighting ?? '').trim()
  vs.negative = String(data?.negative ?? '').trim()
  // 锚定提示词要清洗掉清晰度 / 比例词，保持与下游文生图一致
  vs.imageAnchor = sanitizeImagePrompt(data?.imageAnchor ?? '')
  vs.summary = String(data?.summary ?? '').trim()
  return vs
}

/**
 * 把统一视觉设定的锚定提示词拼到每条分镜提示词前。最终在 /api/image 端会再整体
 * 过一遍 sanitizeImagePrompt，这里只负责拼接。锚定为空时直接返回分镜提示词。
 */
export function combineImagePrompt(anchor, shotPrompt) {
  const a = String(anchor ?? '').trim()
  const p = String(shotPrompt ?? '').trim()
  if (!a) return p
  if (!p) return a
  return `${a}, ${p}`
}

/** 把上游的 HTTP 错误码翻译成用户能看懂的中文提示 */
export function describeUpstreamError(status, rawBody) {
  let message = ''
  try {
    message = JSON.parse(rawBody)?.error?.message ?? ''
  } catch {
    message = String(rawBody ?? '').slice(0, 200)
  }
  const prefix = {
    400: '请求参数有误（可能是模型名称不存在）。',
    401: 'API Key 无效或已过期，请在「设置」里重新填写。',
    403: '该 API Key 没有调用此模型的权限，请确认模型已开通、账号额度充足。',
    404: '接口地址或模型名称可能不正确，请检查服务商与模型名。',
    429: '触发上游限流，请稍后重试。',
  }[status]
  return prefix
    ? `${prefix}${message ? ` 原始信息：${message}` : ''}`
    : `模型服务返回错误 ${status}：${message}`
}
