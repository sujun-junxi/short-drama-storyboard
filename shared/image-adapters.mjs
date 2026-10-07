/**
 * 文生图服务适配器。
 *
 * 每个适配器只做「纯数据转换」——组装请求、从响应里取图片、判定任务状态。
 * 网络请求、SSRF 校验、超时、错误映射统统由服务端统一处理，避免三份实现漂移。
 *
 * 两类流程用 kind 区分：
 * - `sync`：一次请求拿到结果（百炼通义万相、OpenAI 兼容）
 * 两家都是同步流程，没有任务轮询那一套
 */

/** 百炼通义万相的同步端点。注意它不在 /compatible-mode/v1 下，与文本模型不同。 */
const BAILIAN_PATH = '/api/v1/services/aigc/multimodal-generation/generation'
/** OpenAI 兼容的图片端点（baseUrl 通常已含 /v1） */
const OPENAI_IMAGE_PATH = '/images/generations'

const BAILIAN_DEFAULT_MODEL = 'wan2.7-image-pro'
const BAILIAN_DEFAULT_SIZE = '1920*1080'
/** 百炼图像编辑模式最多接受 4 张输入图 */
const BAILIAN_MAX_REFS = 4
const OPENAI_DEFAULT_MODEL = 'gpt-image-1'
const OPENAI_DEFAULT_SIZE = '1536x1024'

/**
 * 已下线但仍可能残留在老配置里的尺寸 → 加载时归一化回该家默认值。
 *
 * 这一版起全项目统一横屏，方图选项被移除；老用户设置里存着的方图值如果不收敛，
 * 后面会一直以「不在选项里」的怪状态存在。
 */
const DEPRECATED_SIZES = {
  bailian: new Set(['2048*2048']),
  openai: new Set(['1024x1024']),
}

/**
 * 把存下来的尺寸收敛成可用值。
 *
 * 刻意**只处理空值与已下线的方图**，不认识的尺寸一律放行 ——
 * 自建网关 / 第三方兼容服务可能支持 1280x720 这类自定义横屏尺寸，硬校验会误伤。
 */
export function normalizeStoredSize(adapterId, size) {
  const adapter = IMAGE_ADAPTERS[String(adapterId ?? '').trim()]
  if (!adapter) return String(size ?? '').trim()
  const raw = String(size ?? '').trim()
  if (!raw) return adapter.defaultSize
  if (DEPRECATED_SIZES[adapterId]?.has(raw)) return adapter.defaultSize
  return raw
}

function extractErrorMessage(rawBody) {
  const text = String(rawBody ?? '').slice(0, 400)
  if (!text) return ''
  try {
    const parsed = JSON.parse(text)
    return String(parsed?.error?.message ?? parsed?.message ?? parsed?.code ?? text).slice(0, 300)
  } catch {
    return text
  }
}

/** 判断错误体里是否出现某些关键词（中英文都覆盖） */
function matches(text, pattern) {
  return pattern.test(String(text ?? ''))
}

// ---------------- 适配器定义 ----------------

export const IMAGE_ADAPTERS = {
  bailian: {
    id: 'bailian',
    label: '阿里云百炼（通义万相）',
    kind: 'sync',
    needsKey: true,
    defaultBaseUrl: 'https://dashscope.aliyuncs.com',
    defaultModel: BAILIAN_DEFAULT_MODEL,
    models: ['wan2.7-image-pro', 'wan2.7-image', 'wanx2.1-t2i-turbo', 'wanx2.1-t2i-plus'],
    defaultSize: BAILIAN_DEFAULT_SIZE,
    maxReferenceImages: BAILIAN_MAX_REFS,
    // 只留横屏：这一版起全项目统一横屏画幅，方图/竖屏不再提供
    sizeOptions: [
      { value: '1920*1080', label: '1920×1080（16:9 横屏）' },
      { value: '2560*1440', label: '2560×1440（16:9 横屏）' },
    ],
    baseUrlHint: '只填域名，不要带 /api/v1（例如 https://dashscope.aliyuncs.com）。新加坡地域用 https://dashscope-intl.aliyuncs.com。',

    /**
     * 百炼的图像编辑模式支持最多 4 张输入图，官方用途写明「主体一致性生成」——
     * 这正是角色/场景参考图想要的。传进来的是已经转好的 data URL
     * （上游只认公网 URL 或 base64，本地缓存文件由服务端读盘转码）。
     *
     * 注意：wan2.7-image-pro 不支持 negative_prompt 与 prompt_extend，不要加。
     */
    buildRequest({ prompt, model, size, referenceImages = [] }) {
      const content = [{ text: String(prompt ?? '') }]
      for (const image of referenceImages.slice(0, BAILIAN_MAX_REFS)) {
        if (typeof image === 'string' && image.trim()) content.push({ image })
      }
      return {
        path: BAILIAN_PATH,
        body: {
          model: model || BAILIAN_DEFAULT_MODEL,
          input: { messages: [{ role: 'user', content }] },
          parameters: {
            size: size || BAILIAN_DEFAULT_SIZE,
            n: 1,
            watermark: false,
            thinking_mode: true,
          },
        },
      }
    },

    /** 取值路径：output.choices[].message.content[]，筛 type === 'image' */
    extractImages(payload) {
      const content = payload?.output?.choices?.[0]?.message?.content
      if (!Array.isArray(content)) return []
      return content
        .filter((item) => item && (item.type === undefined || item.type === 'image') && typeof item.image === 'string')
        .map((item) => ({ url: item.image }))
        .filter((item) => item.url)
    },
  },

  openai: {
    id: 'openai',
    label: 'OpenAI 兼容（官方 / 自建网关 / 本地服务）',
    kind: 'sync',
    needsKey: true,
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: OPENAI_DEFAULT_MODEL,
    models: [
      'gpt-image-1',
      'gpt-image-2',
      'dall-e-3',
      'Qwen/Qwen-Image',
      'black-forest-labs/FLUX.1-Krea-dev',
      'Kwai-Kolors/Kolors',
    ],
    defaultSize: OPENAI_DEFAULT_SIZE,
    // /images/generations 是纯文生图；参考图要走 /images/edits（multipart），这一版还没接
    maxReferenceImages: 0,
    // 同样只留横屏。注意尺寸是上游固定枚举，不能随意加自定义值
    sizeOptions: [
      { value: '1536x1024', label: '1536×1024（3:2 横屏，推荐）' },
      { value: '1792x1024', label: '1792×1024（7:4 横屏，仅 dall-e-3）' },
    ],
    baseUrlHint:
      'OpenAI 官方填 https://api.openai.com/v1；硅基流动 / 智谱 / 自建网关填各自的兼容地址。注意尺寸是固定枚举，1920×1080 这类值在 gpt-image-1 上会报错。',

    buildRequest({ prompt, model, size }) {
      return {
        path: OPENAI_IMAGE_PATH,
        body: {
          model: model || OPENAI_DEFAULT_MODEL,
          prompt: String(prompt ?? ''),
          size: size || OPENAI_DEFAULT_SIZE,
          n: 1,
        },
      }
    },

    /** data[] 里可能是 url（dall-e 系列），也可能是 b64_json（gpt-image 系列只能给 base64） */
    extractImages(payload) {
      const data = payload?.data
      if (!Array.isArray(data)) return []
      const out = []
      for (const item of data) {
        if (typeof item?.url === 'string' && item.url) out.push({ url: item.url })
        else if (typeof item?.b64_json === 'string' && item.b64_json) out.push({ base64: item.b64_json })
      }
      return out
    },
  },
}

export const IMAGE_PROVIDER_IDS = Object.keys(IMAGE_ADAPTERS)

export function getImageAdapter(id) {
  return IMAGE_ADAPTERS[String(id ?? '').trim()] ?? null
}

/** 给前端设置页用的元数据，避免两边各硬编码一份 */
export function listImageAdapters({ native } = {}) {
  return IMAGE_PROVIDER_IDS.filter((id) => (native ? IMAGE_ADAPTERS[id].nativeSupported !== false : true)).map((id) => {
    const a = IMAGE_ADAPTERS[id]
    return {
      id: a.id,
      label: a.label,
      kind: a.kind,
      needsKey: a.needsKey === true,
      needsWorkflow: a.needsWorkflow === true,
      nativeSupported: a.nativeSupported !== false,
      defaultBaseUrl: a.defaultBaseUrl,
      defaultModel: a.defaultModel,
      models: a.models,
      defaultSize: a.defaultSize,
      sizeOptions: a.sizeOptions,
      /** 这家最多接受几张参考图（0 表示暂时不支持） */
      maxReferenceImages: a.maxReferenceImages ?? 0,
      baseUrlHint: a.baseUrlHint ?? '',
    }
  })
}

/** 该服务商在当前平台上是否可用 */
export function isAdapterAvailableOn(providerId, { native } = {}) {
  const adapter = getImageAdapter(providerId)
  if (!adapter) return false
  return native ? adapter.nativeSupported !== false : true
}

// ---------------- 错误文案 ----------------

/**
 * 把上游错误翻译成用户能看懂的中文。
 * 三家错误体结构不同，先统一抠出 message 再按关键词分类。
 */
export function describeImageError(provider, status, rawBody) {
  const message = extractErrorMessage(rawBody)
  const detail = message ? ` 原始信息：${message}` : ''

  if (status === 401 || status === 403 || matches(message, /invalid.*(api)?_?key|unauthorized|authentication|鉴权|无效的?密钥/i)) {
    return `图片服务鉴权失败：API Key 无效、未开通该图片模型或额度不足。请在「设置 → 图片模型」检查。${detail}`
  }
  if (matches(message, /model.*(not|no).*(exist|open|access)|access_?denied|未开通|模型不存在|模型未授权/i)) {
    return `图片模型不可用（可能未开通或名称有误）。${detail}`
  }
  if (matches(message, /inspection|moderation|content.*(policy|filter|violat)|审核|违规|敏感/i)) {
    return `该分镜的画面描述未通过内容审核，请修改提示词后重试。${detail}`
  }
  if (status === 429 || matches(message, /throttl|rate.?limit|quota|限流|频率/i)) {
    return `图片服务触发限流，请稍后重试。${detail}`
  }
  if (status === 400 || status === 404 || status === 422) {
    const sizeHint = provider === 'openai' ? '注意 OpenAI 兼容接口的尺寸是固定枚举（如 1536x1024）。' : ''
    return `图片请求参数有误（可能是模型名或尺寸不支持）。${sizeHint}${detail}`
  }
  return `图片服务返回错误 ${status}。${detail}`
}
