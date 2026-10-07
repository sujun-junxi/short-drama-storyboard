/**
 * 模型服务商预设（前端专用，只有设置页引用）。
 *
 * 协议限定 **OpenAI 兼容**：POST {baseUrl}/chat/completions + Authorization: Bearer <key>。
 * baseUrl 是兼容根路径，不要带 /chat/completions。
 *
 * ⚠️ 模型名只作输入建议，不追求最新——各家迭代很快，用户可直接填写任意模型名，
 *    以厂商文档为准。baseUrl 若日后有变更，用户也可自行修改。
 */
import { DEFAULT_BASE_URL } from '../../shared/prompt.mjs'

export interface ProviderPreset {
  id: string
  label: string
  baseUrl: string
  /** 仅用于 datalist 建议 */
  models: string[]
  /** 「去哪拿 Key」链接 */
  keyUrl?: string
  /** 该服务商的额外提示 */
  hint?: string
}

export const CUSTOM_PROVIDER_ID = 'custom'

export const PROVIDERS: ProviderPreset[] = [
  {
    id: 'bailian',
    label: '阿里云百炼（通义千问）',
    baseUrl: DEFAULT_BASE_URL,
    models: ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen-flash'],
    keyUrl: 'https://bailian.console.aliyun.com/?tab=model#/api-key',
    hint: '新加坡地域请把地址改为 https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini'],
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek（深度求索）',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'moonshot',
    label: '月之暗面 Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4-flash', 'glm-4-air', 'glm-4-plus'],
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
  },
  {
    id: 'siliconflow',
    label: '硅基流动 SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: ['Qwen/Qwen2.5-7B-Instruct', 'Qwen/Qwen2.5-72B-Instruct', 'deepseek-ai/DeepSeek-V3'],
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
    hint: '模型名要带组织前缀，例如 Qwen/Qwen2.5-7B-Instruct。',
  },
  {
    id: 'volcengine',
    label: '字节火山方舟（豆包）',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    models: [],
    keyUrl: 'https://console.volcengine.com/ark',
    hint: '方舟用「接入点 ID」当模型名，形如 ep-2024xxxxxx-xxxxx。',
  },
  {
    id: 'ollama',
    label: 'Ollama（本机运行）',
    baseUrl: 'http://127.0.0.1:11434/v1',
    models: ['qwen2.5:7b', 'llama3.1:8b', 'deepseek-r1:7b'],
    hint: '本地模型不校验 Key，随便填一个即可（例如 ollama）。',
  },
]

export function getProviderById(id: string): ProviderPreset | undefined {
  return PROVIDERS.find((p) => p.id === id)
}

/** 用 baseUrl 反查预设，供设置页回显与自动切换服务商 */
export function findProviderByBaseUrl(baseUrl: string): ProviderPreset | undefined {
  const target = String(baseUrl ?? '')
    .trim()
    .replace(/\/+$/, '')
    .toLowerCase()
  if (!target) return undefined
  return PROVIDERS.find((p) => p.baseUrl.trim().replace(/\/+$/, '').toLowerCase() === target)
}

/** 某服务商的模型建议；未匹配到预设时返回全部去重建议 */
export function modelSuggestionsFor(providerId: string): string[] {
  const provider = getProviderById(providerId)
  if (provider) return provider.models
  const all = new Set<string>()
  for (const p of PROVIDERS) for (const m of p.models) all.add(m)
  return [...all]
}
