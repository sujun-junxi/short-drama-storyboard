import { AlertCircle, ImageIcon, Loader2, RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { ReferenceImage } from '@/lib/types'
import { cn } from '@/lib/utils'

interface ReferenceImagesProps {
  references: ReferenceImage[]
  /** 单张重新生成（跳过缓存，确保真的重出） */
  onRegenerate?: (id: string) => void
}

/**
 * 一张参考图：三种状态各有明确反馈 —— 生成中给转圈、失败给可读错误与重试、
 * 成功给缩略图。每张都能单独重出，不用整组重跑。
 */
function ReferenceCard({ reference, onRegenerate }: { reference: ReferenceImage; onRegenerate?: (id: string) => void }) {
  const { id, kind, label, status, url, error, cached } = reference
  const busy = status === 'loading'

  return (
    <div className="border-border flex flex-col overflow-hidden rounded-md border">
      <div className="bg-muted/40 relative aspect-video">
        {status === 'success' && url ? (
          <>
            <img src={url} alt={label} className="h-full w-full object-cover" loading="lazy" />
            {cached ? (
              <span className="bg-background/85 text-muted-foreground absolute right-1 bottom-1 rounded px-1 py-0.5 text-[10px] leading-none">
                缓存
              </span>
            ) : null}
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 px-2 text-center">
            {busy ? (
              <>
                <Loader2 className="text-primary size-4 animate-spin" />
                <span className="text-muted-foreground text-[11px]">生成中…</span>
              </>
            ) : status === 'error' ? (
              <>
                <AlertCircle className="text-destructive size-4 shrink-0" />
                <span className="text-destructive max-h-10 overflow-hidden text-[11px] leading-tight" title={error}>
                  {error || '生成失败'}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground text-[11px]">等待生成</span>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-1 px-2 py-1.5">
        <span className="text-foreground/80 truncate text-xs" title={label}>
          <span className="text-muted-foreground">{kind === 'character' ? '角色 · ' : '场景 · '}</span>
          {label}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => onRegenerate?.(id)}
          title="重新生成这一张"
          aria-label={`重新生成 ${label}`}
        >
          <RefreshCw className={cn('size-3.5', busy && 'animate-spin')} />
        </Button>
      </div>
    </div>
  )
}

/**
 * 参考图区。
 *
 * 先于分镜图产出：把统一视觉设定里的角色与核心场景各出一张图，
 * 后续每张分镜带着它们去生成，比纯文字锚定更能锁住角色与场景的一致性。
 */
export function ReferenceImages({ references, onRegenerate }: ReferenceImagesProps) {
  if (references.length === 0) return null

  const done = references.filter((r) => r.status === 'success').length
  const failed = references.filter((r) => r.status === 'error').length

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <ImageIcon className="text-muted-foreground size-3.5 shrink-0" />
        <span className="text-foreground/80 text-xs font-medium">参考图</span>
        <span className="text-muted-foreground text-xs leading-relaxed">
          先于分镜图生成，后续每张分镜都会带着它们一起出，角色与场景更统一
        </span>
        <span className="text-muted-foreground ml-auto shrink-0 text-[11px]">
          {done} / {references.length} 就绪
          {failed > 0 ? ` · ${failed} 张失败` : ''}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
        {references.map((reference) => (
          <ReferenceCard key={reference.id} reference={reference} onRegenerate={onRegenerate} />
        ))}
      </div>
    </div>
  )
}
