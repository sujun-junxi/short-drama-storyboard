import { Check, Loader2, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { PHASE_META, PHASE_ORDER, type GeneratePhase } from '@/lib/progress'
import { useElapsedSeconds, useSmoothPhase } from '@/lib/useProgress'
import { cn } from '@/lib/utils'

interface GenerationProgressProps {
  phase: GeneratePhase
  /** 已生成的条数（网页/桌面为流式统计的真实值，APK 为估算值） */
  completed?: number
  total?: number
  /** 条数是估算值时加「约」前缀如实区分 */
  estimated?: boolean
  onCancel?: () => void
  className?: string
}

/** 生成过程的四步进度清单，含已用时间、条数进度与取消 */
export function GenerationProgress({
  phase,
  completed: completedProp,
  total: totalProp,
  estimated,
  onCancel,
  className,
}: GenerationProgressProps) {
  const smooth = useSmoothPhase(phase) ?? phase
  const elapsedMs = useElapsedSeconds(true)
  const currentIndex = PHASE_ORDER.indexOf(smooth)
  const seconds = Math.floor(elapsedMs / 1000)

  const total = totalProp && totalProp > 0 ? totalProp : 5
  const completed = Math.min(total, Math.max(0, completedProp ?? 0))

  return (
    <div className={cn('border-border bg-card rounded-xl border p-4 shadow-sm sm:p-5', className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-foreground text-sm font-medium">生成进度</span>
        <div className="flex shrink-0 items-center gap-1">
          <span className="text-muted-foreground text-xs tabular-nums">已用 {seconds}s</span>
          {onCancel ? (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onCancel}
              aria-label="取消生成"
              title="取消生成"
              className="text-muted-foreground hover:text-foreground"
            >
              <X />
            </Button>
          ) : null}
        </div>
      </div>

      <ol className="flex flex-col">
        {PHASE_ORDER.map((step, index) => {
          const done = index < currentIndex
          const active = index === currentIndex
          return (
            <li key={step} className="flex min-w-0 items-center gap-2.5 py-1.5">
              <span className="grid size-5 shrink-0 place-items-center">
                {done ? (
                  <Check className="text-primary size-4" strokeWidth={2.5} />
                ) : active ? (
                  <Loader2 className="text-primary size-4 animate-spin" />
                ) : (
                  <span className="border-muted-foreground/40 size-3.5 rounded-full border-2" />
                )}
              </span>
              <span
                className={cn(
                  'truncate text-sm transition-colors',
                  done && 'text-muted-foreground',
                  active && 'text-foreground font-medium',
                  !done && !active && 'text-muted-foreground/50',
                )}
              >
                {PHASE_META[step].label}
              </span>
            </li>
          )
        })}
      </ol>

      {/* 条数进度放在清单下方：头部已有「已用 Ns + 取消」，窄屏再塞一个会挤 */}
      <div className="border-border/60 mt-3 flex items-center justify-between gap-2 border-t pt-3">
        <span className="text-muted-foreground text-xs">已生成分镜</span>
        <span className="text-foreground text-xs font-medium tabular-nums">
          {estimated ? '约 ' : ''}
          {completed} / {total} 条
        </span>
      </div>
    </div>
  )
}
