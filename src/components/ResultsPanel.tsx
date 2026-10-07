import { AlertCircle, Check, Clapperboard, Copy, FileJson, FileText, Loader2, RefreshCw, Sparkles } from 'lucide-react'

import { GenerationProgress } from '@/components/GenerationProgress'
import { ShotCard, type ImageProviderChoice } from '@/components/ShotCard'
import { VisualSettingPanel, type VisualSettingStatus } from '@/components/VisualSettingPanel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { exportStoryboard, storyboardToMarkdown, type StoryboardMeta } from '@/lib/export'
import type { GeneratePhase } from '@/lib/progress'
import type { GenerateStatus, ImageState, ReferenceImage, Shot, VisualSetting } from '@/lib/types'
import { useCopy } from '@/lib/useCopy'
import type { PartialShot } from '../../shared/prompt.mjs'

interface ResultsPanelProps {
  status: GenerateStatus
  /** 生成中的阶段；仅在 status === 'loading' 时有值 */
  phase: GeneratePhase | null
  /** 已生成条数与总数，驱动卡片逐张出现 */
  completed?: number
  total?: number
  /** 已写完分镜的文本，直接显示在卡片上（APK 拿不到，为空数组） */
  partialShots?: PartialShot[]
  /** 条数是否为估算值（APK 没有流式信号，只能按时间估算） */
  estimated?: boolean
  shots: Shot[]
  /** 与 shots 同索引的配图状态 */
  images?: ImageState[]
  /** 统一视觉设定（分镜出完后自动产出） */
  visualSetting?: VisualSetting | null
  visualSettingStatus?: VisualSettingStatus
  visualSettingError?: string | null
  /** 参考图：角色与场景各一张，先于分镜图产出 */
  referenceImages?: ReferenceImage[]
  /** 单张参考图重新生成 */
  onRegenerateReference?: (id: string) => void
  /** 应用编辑后的设定并重出配图 */
  onApplyVisualSetting?: (draft: VisualSetting) => void
  onRetryVisualSetting?: () => void
  error: string | null
  meta: StoryboardMeta
  onRetry: () => void
  onCancel?: () => void
  /** 批量生成还没成功的那些配图 */
  onGenerateAllImages?: () => void
  /** 生成单条 / 重试。第二参数是卡片上选的模型服务（'auto' 表示跟随文本模型） */
  onRetryImage?: (index: number, provider?: ImageProviderChoice) => void
  onRegenerateImage?: (index: number, provider?: ImageProviderChoice) => void
  onCancelImages?: () => void
}

export function ResultsPanel({
  status,
  phase,
  completed,
  total,
  partialShots,
  estimated,
  shots,
  images,
  visualSetting,
  visualSettingStatus,
  visualSettingError,
  referenceImages,
  onRegenerateReference,
  onApplyVisualSetting,
  onRetryVisualSetting,
  error,
  meta,
  onRetry,
  onCancel,
  onGenerateAllImages,
  onRetryImage,
  onRegenerateImage,
  onCancelImages,
}: ResultsPanelProps) {
  const { copiedKey, copy } = useCopy()

  if (status === 'idle') {
    return (
      <div className="border-border bg-card flex min-h-80 flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
        <Clapperboard className="text-muted-foreground size-10" strokeWidth={1.5} />
        <p className="text-foreground font-medium">还没有分镜</p>
        <p className="text-muted-foreground max-w-xs text-sm">
          在左侧填写短剧主题与剧本，点击「生成分镜」，这里会出现 5 条可拍摄的分镜脚本。
        </p>
      </div>
    )
  }

  if (status === 'loading') {
    const total9 = total && total > 0 ? total : 5
    const written = Math.min(total9, partialShots?.length ?? 0) // 已经能显示文字的条数
    const hasPending = written < total9 // 是否还有没写完的
    // 已写好的（显示真实文字）+ 1 张「正在写」的骨架
    const cardCount = hasPending ? written + 1 : written

    return (
      <div className="flex flex-col gap-4">
        {phase ? (
          <GenerationProgress
            phase={phase}
            completed={Math.max(completed ?? 0, written)}
            total={total9}
            estimated={estimated}
            onCancel={onCancel}
          />
        ) : null}
        {Array.from({ length: cardCount }, (_, i) =>
          i < written ? (
            <PartialShotCard key={i} shot={partialShots![i]} index={i} />
          ) : (
            <SkeletonCard key={i} index={i} />
          ),
        )}
        <p className="text-muted-foreground text-center text-sm">大模型正在撰写分镜，通常需要 10~30 秒…</p>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="border-destructive/40 bg-destructive/5 flex flex-col items-start gap-3 rounded-xl border p-6">
        <div className="text-destructive flex items-center gap-2 font-medium">
          <AlertCircle className="size-4" />
          生成失败
        </div>
        <p className="text-foreground/80 text-sm leading-relaxed break-words">{error}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw />
          重试
        </Button>
      </div>
    )
  }

  // 配图进度：done 把失败也算进去（那张不会再变），只要还有 loading 就说明在进行中。
  // 一张都没触发过时不显示这一行 —— 配图由用户按需发起，没点过就没有进度可言。
  const imageList = images ?? []
  const imageDone = imageList.filter((im) => im.status === 'success' || im.status === 'error').length
  const imagePending = imageList.filter((im) => im.status !== 'success').length
  const imageLoading = imageList.some((im) => im.status === 'loading')
  const imageStarted = imageList.some((im) => im.status !== 'idle')
  const imageRow = imageList.length > 0 && imageStarted ? { total: imageList.length, done: imageDone, loading: imageLoading } : null

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-card sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 shadow-sm backdrop-blur">
        <div className="flex items-center gap-2">
          <Badge className="bg-primary/10 text-primary border-primary/20">共 {shots.length} 条分镜</Badge>
          {meta.model ? <span className="text-muted-foreground text-xs">{meta.model}</span> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onGenerateAllImages && imageList.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onGenerateAllImages}
              disabled={imagePending === 0 || imageLoading}
              title="为还没有配图的分镜生成配图（已生成的会跳过）"
            >
              {imageLoading ? <Loader2 className="animate-spin" /> : <Sparkles />}
              生成全部配图
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => copy('all', storyboardToMarkdown(shots, meta, undefined, visualSetting))}
          >
            {copiedKey === 'all' ? (
              <>
                <Copy />
                已复制
              </>
            ) : (
              <>
                <Copy />
                复制全部
              </>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportStoryboard('md', shots, meta, images, visualSetting)}
          >
            <FileText />
            Markdown
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportStoryboard('json', shots, meta, images, visualSetting)}
          >
            <FileJson />
            JSON
          </Button>
          <Button variant="ghost" size="sm" onClick={onRetry}>
            <RefreshCw />
            重新生成
          </Button>
        </div>
      </div>

      {/* 统一视觉设定：让用户看见「整组画面被固定成什么样」，锚定提示词可改后重出图 */}
      {onApplyVisualSetting && onRetryVisualSetting ? (
        <VisualSettingPanel
          status={visualSettingStatus ?? 'idle'}
          setting={visualSetting ?? null}
          error={visualSettingError ?? null}
          onApply={onApplyVisualSetting}
          onRetry={onRetryVisualSetting}
          references={referenceImages ?? []}
          onRegenerateReference={onRegenerateReference}
        />
      ) : null}

      {imageRow ? (
        <div className="border-border bg-card flex items-center gap-3 rounded-lg border px-4 py-2.5 shadow-sm">
          {imageRow.loading ? (
            <Loader2 className="text-primary size-4 shrink-0 animate-spin" />
          ) : (
            <Check className="text-primary size-4 shrink-0" />
          )}
          <span className="text-foreground/80 text-sm">
            {imageRow.loading
              ? `正在生成配图 ${imageRow.done} / ${imageRow.total}`
              : `配图 ${imageRow.done} / ${imageRow.total}`}
          </span>
          <div className="bg-muted ml-auto h-1.5 w-20 overflow-hidden rounded-full sm:w-32">
            <div
              className="bg-primary h-full transition-all duration-500"
              style={{ width: `${imageRow.total ? (imageRow.done / imageRow.total) * 100 : 0}%` }}
            />
          </div>
          {imageRow.loading && onCancelImages ? (
            <button
              type="button"
              onClick={onCancelImages}
              className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2"
            >
              停止
            </button>
          ) : null}
        </div>
      ) : null}

      {shots.map((shot, i) => (
        <ShotCard
          key={`${shot.shotNumber}-${i}`}
          shot={shot}
          index={i}
          image={images?.[i]}
          onRequestImage={onRetryImage ? (provider) => onRetryImage(i, provider) : undefined}
          onRegenerateImage={onRegenerateImage ? (provider) => onRegenerateImage(i, provider) : undefined}
        />
      ))}
    </div>
  )
}

/**
 * 生成中「已经写完」的卡片：直接显示真实画面描述，不用等全部生成完。
 * 下方保留两条淡占位条，把高度往骨架卡上靠，减少卡片逐个出现时的跳动。
 */
function PartialShotCard({ shot, index }: { shot: PartialShot; index: number }) {
  return (
    <div
      data-slot="partial-card"
      className="bg-card border-border animate-fade-in-up rounded-xl border p-5 shadow-sm"
    >
      <div className="flex h-7 items-center gap-2">
        <Badge variant="secondary" className="tabular-nums">
          镜头 {shot.shotNumber || index + 1}
        </Badge>
        <Badge variant="outline">{shot.shotType}</Badge>
        <span className="text-primary ml-auto inline-flex items-center gap-1 text-[11px] font-medium">
          <Check className="size-3.5" />
          已生成
        </span>
      </div>
      <p className="text-foreground/90 mt-4 text-sm leading-relaxed">{shot.sceneDescription}</p>
      <div className="mt-3 flex flex-col gap-2">
        <div className="bg-muted/40 h-3 w-2/3 rounded" />
        <div className="bg-muted/40 h-3 w-1/2 rounded" />
      </div>
    </div>
  )
}

/**
 * 生成中的占位卡。骨架卡的头部固定 h-7、正文三行 h-3.5，
 * 与 PartialShotCard 的高度接近，避免卡片逐张出现时列表高度大幅跳动。
 */
function SkeletonCard({ index }: { index: number }) {
  return (
    <div
      data-slot="skeleton-card"
      className="bg-card border-border animate-fade-in-up rounded-xl border border-dashed p-5 shadow-sm"
    >
      <div className="flex h-7 items-center gap-2">
        <div className="bg-muted h-7 w-20 animate-pulse rounded-md" />
        <div className="bg-muted h-5 w-16 animate-pulse rounded-md" />
      </div>
      <div className="mt-4 flex flex-col gap-2">
        <div className="bg-muted h-3.5 w-full animate-pulse rounded" />
        <div className="bg-muted h-3.5 w-11/12 animate-pulse rounded" />
        <div className="bg-muted h-3.5 w-2/3 animate-pulse rounded" />
      </div>
      <span className="sr-only">第 {index + 1} 条正在生成</span>
    </div>
  )
}
