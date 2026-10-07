/**
 * 生成过程的阶段模型。
 *
 * 阶段信号有两个来源，这里只定义模型本身，不关心来源：
 * - 网页 / 桌面：服务端通过 SSE 推送真实阶段（见 server/app.mjs 的 /api/generate-stream）
 * - APK：CapacitorHttp 不支持流式，用本地估算时间表模拟
 */
import { SHOT_COUNT, type PartialShot } from '../../shared/prompt.mjs'

/** 生成过程中的条数进度，以及已写完分镜的文本 */
export interface GenerateProgress {
  completed: number
  total: number
  /** 已写完分镜的文本。网页/桌面来自流式解析；APK 拿不到，恒为空数组 */
  shots: PartialShot[]
}

export type GeneratePhase = 'preparing' | 'calling' | 'generating' | 'parsing'

/** 阶段顺序，同时用于进度清单渲染与「是否前进」的判定 */
export const PHASE_ORDER: GeneratePhase[] = ['preparing', 'calling', 'generating', 'parsing']

export const PHASE_META: Record<GeneratePhase, { label: string }> = {
  preparing: { label: '正在分析剧本' },
  calling: { label: '正在调用大模型' },
  generating: { label: '正在生成分镜' },
  parsing: { label: '正在整理结果' },
}

export interface EstimateStep {
  phase: GeneratePhase
  /** 停留时长（毫秒）；Infinity 表示一直停在这个阶段直到外部结束 */
  hold: number
}

/**
 * APK 的本地估算时间表。
 *
 * 关键设计：把「不确定的等待」全部归到 generating 阶段（hold = Infinity）。
 * 这样无论真实耗时是 3 秒还是 60 秒，文案都成立——不会出现卡在「正在调用大模型」
 * 很久、让人以为请求挂了的观感。
 *
 * 注：APK 只有「请求已发出」和「响应已返回」两个真实时点，中间无法感知，
 * 所以这里只做展示层面的估算，不代表真实进度。
 */
export const NATIVE_ESTIMATE_MS: EstimateStep[] = [
  { phase: 'preparing', hold: 700 },
  { phase: 'calling', hold: 2500 },
  { phase: 'generating', hold: Number.POSITIVE_INFINITY },
]

/** 给定已用毫秒数，返回落在哪个估算阶段 */
export function estimatePhaseAt(elapsedMs: number, schedule: EstimateStep[] = NATIVE_ESTIMATE_MS): GeneratePhase {
  let acc = 0
  for (const step of schedule) {
    if (!Number.isFinite(step.hold)) return step.phase
    acc += step.hold
    if (elapsedMs < acc) return step.phase
  }
  return schedule[schedule.length - 1].phase
}

export interface NativeEstimator {
  /** 停止计时（请求结束或用户取消） */
  stop: () => void
  /** 请求已返回，推到最后一个阶段让用户看到收尾 */
  finish: () => void
}

export interface NativeEstimatorOptions {
  schedule?: EstimateStep[]
  /** generating 阶段每多少毫秒估算「又写完一条」 */
  shotIntervalMs?: number
  /** 估算出的条数进度。手机端拿不到流式内容，shots 恒为空数组 */
  onProgress?: (progress: GenerateProgress) => void
}

/** 目标分镜条数，与 shared/prompt.mjs 的 SHOT_COUNT 同源 */
export const TOTAL_SHOTS = SHOT_COUNT

/**
 * 按时间表推进阶段，阶段变化时回调。仅浏览器环境使用。
 * 传入 onProgress 时还会在 generating 阶段按时间估算「已完成条数」（APK 专用）。
 */
export function createNativeEstimator(
  onPhase: (phase: GeneratePhase) => void,
  options: NativeEstimatorOptions = {},
): NativeEstimator {
  const { schedule = NATIVE_ESTIMATE_MS, shotIntervalMs = 2500, onProgress } = options
  const start = performance.now()
  let current: GeneratePhase | null = null
  let generatingStart = 0
  let lastCompleted = 0
  let stopped = false

  const tick = () => {
    if (stopped) return
    const now = performance.now()

    const next = estimatePhaseAt(now - start, schedule)
    if (next !== current) {
      current = next
      if (next === 'generating') generatingStart = now
      onPhase(next)
    }

    if (onProgress && current === 'generating' && generatingStart > 0) {
      // 上限留一条：还没拿到结果就把 5 条全标成已完成会误导，
      // 最后一条等 finish() 时再补
      const estimated = Math.min(TOTAL_SHOTS - 1, Math.floor((now - generatingStart) / shotIntervalMs))
      if (estimated > lastCompleted) {
        lastCompleted = estimated
        // 手机端拿不到流式内容，shots 恒为空 —— 卡片会保持骨架形态
        onProgress({ completed: estimated, total: TOTAL_SHOTS, shots: [] })
      }
    }
  }

  tick()
  const id = window.setInterval(tick, 120)

  return {
    stop: () => {
      stopped = true
      window.clearInterval(id)
    },
    finish: () => {
      if (stopped) return
      current = 'parsing'
      onPhase('parsing')
      // 请求确实返回了，此时把条数补满才是准确的
      if (onProgress && lastCompleted < TOTAL_SHOTS) {
        lastCompleted = TOTAL_SHOTS
        onProgress({ completed: TOTAL_SHOTS, total: TOTAL_SHOTS, shots: [] })
      }
    },
  }
}
