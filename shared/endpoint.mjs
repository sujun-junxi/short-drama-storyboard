/**
 * 接口地址的归一化与安全性判定（纯函数，前端 / Node 共用）。
 *
 * 服务端会对用户填的 baseUrl 发起请求，所以必须有 SSRF 防护：
 * 这里只提供判定原语，实际校验（含 DNS 解析）在 server/app.mjs 里做。
 */

/** 去掉首尾空格与结尾斜杠：'https://x/v1/' -> 'https://x/v1' */
export function normalizeBaseUrl(raw) {
  return String(raw ?? '').trim().replace(/\/+$/, '')
}

/**
 * 取 URL 的主机名（小写）。解析失败返回空串。
 *
 * 用于判断「这套配置和那套配置是不是同一个服务」—— 例如图片配置没填 Key 时
 * 能不能复用文本模型的 Key。
 */
export function hostOf(raw) {
  try {
    return new URL(String(raw ?? '').trim()).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/** 私有 / 回环 IPv4 网段 */
const PRIVATE_V4 = [
  /^0\./,
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^100\.(6[4-9]|[7-9]\d|1[0-2]\d)\./,
]

/** 判断主机名是否指向本机 / 内网 */
export function isPrivateHostname(hostname) {
  const host = String(hostname ?? '')
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
  if (!host) return true

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return true
  }
  if (host === '::1' || host === '::') return true
  // IPv6 唯一本地地址（fc00::/7）与链路本地（fe80::/10）
  if (host.includes(':')) return host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')

  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false // 普通域名不按内网处理
  return PRIVATE_V4.some((re) => re.test(host))
}

/** 云厂商元数据服务地址：无论来源一律拒绝 */
export function isMetadataHost(hostname) {
  const host = String(hostname ?? '').toLowerCase()
  return host === '169.254.169.254' || host === 'metadata.google.internal'
}
