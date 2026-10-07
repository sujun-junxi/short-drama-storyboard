/**
 * 上游参数兼容性降级（服务端 / APK 共用）。
 *
 * 打着「OpenAI 兼容」旗号的端点，兼容程度参差不齐：有的不支持
 * response_format: json_object，有的不支持 stream。目标是在疑似「参数不被支持」时
 * 逐级去掉可选参数重试，而不是直接把错误抛给用户。
 *
 * 降级阶梯：
 *   full ──失败──▶ no-response-format ──(仅流式)失败──▶ no-stream
 */

export const COMPAT_STEPS = {
  FULL: 'full',
  NO_RESPONSE_FORMAT: 'no-response-format',
  NO_STREAM: 'no-stream',
}

/** 命中即视为「参数不被支持」，中英文与常见网关措辞都覆盖 */
const PARAM_HINTS =
  /response_format|json_object|json[_ ]?mode|stream|unsupported|not\s*support(ed)?|unknown\s+(field|parameter|arg)|invalid\s+(field|parameter|argument)|unexpected|does\s+not\s+support|不支持|未支持|未知(的)?(字段|参数)|无效(的)?参数|参数(错误|不支持|不合法)|多余(的)?(字段|参数)/i

/**
 * 这些状态码一律允许「降级重试一次」。
 * 特意包含 5xx —— 不少网关把「参数不认识」也报成 500。
 * 不含 401/403/429：那些是鉴权或限流问题，重试没意义。
 */
const RETRIABLE_STATUS = new Set([400, 404, 405, 409, 415, 422, 500, 501, 502])

export function isLikelyUnsupportedParam(status, bodyText) {
  // 响应体里提到参数名，几乎可以确定是参数问题
  if (PARAM_HINTS.test(String(bodyText ?? ''))) return true
  return RETRIABLE_STATUS.has(Number(status))
}

/**
 * 返回下一步降级动作；null 表示不再重试。
 * streamCapable 为 false（如 APK 的 CapacitorHttp）时不尝试去掉 stream。
 */
export function nextCompatibilityStep(step, { status, bodyText, streamCapable }) {
  if (!isLikelyUnsupportedParam(status, bodyText)) return null
  if (step === COMPAT_STEPS.FULL) return COMPAT_STEPS.NO_RESPONSE_FORMAT
  if (step === COMPAT_STEPS.NO_RESPONSE_FORMAT && streamCapable) return COMPAT_STEPS.NO_STREAM
  return null
}

/** 按降级步骤生成新的请求体（不修改原对象） */
export function applyCompatStep(body, step) {
  const next = { ...body }
  if (step !== COMPAT_STEPS.FULL) delete next.response_format
  if (step === COMPAT_STEPS.NO_STREAM) delete next.stream
  return next
}
