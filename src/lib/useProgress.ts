import { useEffect, useRef, useState } from 'react'

import { PHASE_ORDER, type GeneratePhase } from './progress'

/** 每个阶段的最短展示时长：preparing / parsing 真实只有几毫秒，不拉长会一闪而过 */
export const PHASE_MIN_MS = 600

/** 已用毫秒数；active 为真时开始计时，每 250ms 刷新 */
export function useElapsedSeconds(active: boolean): number {
  const [ms, setMs] = useState(0)

  useEffect(() => {
    if (!active) return
    const start = performance.now()
    setMs(0)
    const id = window.setInterval(() => setMs(performance.now() - start), 250)
    return () => window.clearInterval(id)
  }, [active])

  return ms
}

/**
 * 纯函数：从当前展示阶段切到 target 之前还需等待多少毫秒（0 表示立即切）。
 * 只对「前进」施加最短停留；同级或回退（例如重新生成时归零）立即切。
 */
export function resolvePhaseDelay(
  target: GeneratePhase,
  shown: GeneratePhase | null,
  sinceShownMs: number,
  minMs = PHASE_MIN_MS,
): number {
  if (shown === null) return 0
  const targetIndex = PHASE_ORDER.indexOf(target)
  const shownIndex = PHASE_ORDER.indexOf(shown)
  if (targetIndex <= shownIndex) return 0
  return Math.max(0, minMs - sinceShownMs)
}

/**
 * 把真实阶段平滑成展示阶段：每个阶段至少停留 PHASE_MIN_MS。
 *
 * 这不改变信号本身的真实性，只是把「真实但短到看不清」的阶段拉长到可读——
 * 与骨架屏最短展示时长是同类做法。终态不在这里处理（调用方拿到结果后直接切状态，组件卸载）。
 */
export function useSmoothPhase(target: GeneratePhase | null): GeneratePhase | null {
  const [shown, setShown] = useState<GeneratePhase | null>(target)
  const shownRef = useRef<GeneratePhase | null>(target)
  const sinceRef = useRef(0)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }

    if (target === null) {
      shownRef.current = null
      setShown(null)
      return
    }

    const wait = resolvePhaseDelay(target, shownRef.current, performance.now() - sinceRef.current)
    if (wait === 0) {
      shownRef.current = target
      sinceRef.current = performance.now()
      setShown(target)
      return
    }

    // 等待期间若又有新阶段到来，上一个 effect 的清理函数会取消这个 timer
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      shownRef.current = target
      sinceRef.current = performance.now()
      setShown(target)
    }, wait)
  }, [target])

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    },
    [],
  )

  return shown
}
