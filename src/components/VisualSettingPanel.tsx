import { useEffect, useState } from 'react'
import { AlertCircle, ChevronDown, Loader2, Palette, RefreshCw, Sparkles, Users } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/field'
import type { ReferenceImage, VisualSetting } from '@/lib/types'
import { ReferenceImages } from '@/components/ReferenceImages'
import { cn } from '@/lib/utils'

export type VisualSettingStatus = 'idle' | 'loading' | 'success' | 'error'

interface VisualSettingPanelProps {
  status: VisualSettingStatus
  setting: VisualSetting | null
  error: string | null
  /** 应用编辑后的设定，并据此重新生成全部配图 */
  onApply: (draft: VisualSetting) => void
  onRetry: () => void
  /** 参考图：角色与场景各一张 */
  references?: ReferenceImage[]
  /** 单张参考图重新生成 */
  onRegenerateReference?: (id: string) => void
}

/** 只读的展示项 */
function Row({ label, value }: { label: string; value: string }) {
  if (!value) return null
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:gap-3">
      <span className="text-muted-foreground w-20 shrink-0 text-xs leading-5">{label}</span>
      <span className="text-foreground/85 text-xs leading-5">{value}</span>
    </div>
  )
}

/**
 * 统一视觉设定（视觉圣经）面板。
 *
 * 设定**先于分镜**产出（分镜的 imagePrompt 受它约束），展示角色 / 场景 / 画风 / 色调 / 负面约束，
 * 并把真正拼进配图提示词的「锚定提示词」做成可编辑 —— 想调整整体风格时改这里即可，改完一键重出配图。
 */
export function VisualSettingPanel({
  status,
  setting,
  error,
  onApply,
  onRetry,
  references = [],
  onRegenerateReference,
}: VisualSettingPanelProps) {
  const [open, setOpen] = useState(true)
  const [anchor, setAnchor] = useState(setting?.imageAnchor ?? '')

  // 重新生成设定后，把草稿同步成新的锚定提示词
  useEffect(() => {
    setAnchor(setting?.imageAnchor ?? '')
  }, [setting])

  if (status === 'idle') return null

  if (status === 'loading') {
    return (
      <div className="border-border bg-card flex items-center gap-3 rounded-lg border px-4 py-3 shadow-sm">
        <Loader2 className="text-primary size-4 shrink-0 animate-spin" />
        <span className="text-foreground/80 text-sm">正在生成统一视觉设定…</span>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="border-border bg-card flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 shadow-sm">
        <AlertCircle className="text-destructive size-4 shrink-0" />
        <span className="text-foreground/80 min-w-0 flex-1 text-xs leading-relaxed">
          统一视觉设定生成失败{error ? `：${error}` : ''}。配图仍会按各条分镜自己的提示词生成，只是整组一致性会弱一些。
        </span>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw />
          重试
        </Button>
      </div>
    )
  }

  if (!setting) return null

  const dirty = anchor.trim() !== setting.imageAnchor

  return (
    <div className="border-border bg-card rounded-lg border shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <Palette className="text-primary size-4 shrink-0" />
        <span className="text-sm font-semibold">统一视觉设定</span>
        <span className="text-muted-foreground hidden min-w-0 flex-1 truncate text-xs sm:block">
          {setting.summary}
        </span>
        <ChevronDown className={cn('text-muted-foreground size-4 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>

      {open ? (
        <div className="border-border flex flex-col gap-3 border-t px-4 py-3">
          {setting.summary ? <p className="text-foreground/85 text-xs leading-relaxed sm:hidden">{setting.summary}</p> : null}

          {setting.characters.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
                <Users className="size-3.5" />
                角色
              </span>
              <div className="flex flex-col gap-1.5 pl-5">
                {setting.characters.map((c, i) => (
                  <div key={`${c.name}-${i}`} className="text-foreground/85 text-xs leading-5">
                    <span className="text-foreground font-medium">{c.name || `角色 ${i + 1}`}</span>
                    {c.appearance ? <span>：{c.appearance}</span> : null}
                    {c.clothing ? <span className="text-muted-foreground">　服装：{c.clothing}</span> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <Row label="核心场景" value={setting.sceneLayout} />
          <Row label="整体画风" value={setting.artStyle} />
          <Row label="色调光线" value={setting.colorLighting} />
          <Row label="负面约束" value={setting.negative} />

          {/* 参考图放在描述之后、锚定提示词之前：它是由这些描述衍生出来的可视化结果 */}
          <div className="pt-1">
            <ReferenceImages references={references} onRegenerate={onRegenerateReference} />
          </div>

          <div className="flex flex-col gap-2 pt-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground text-xs font-medium">锚定提示词（拼到每条分镜提示词前）</span>
              {dirty ? <span className="text-primary text-xs">已修改</span> : null}
            </div>
            <Textarea
              value={anchor}
              onChange={(e) => setAnchor(e.target.value)}
              placeholder="英文逗号分隔的提示词，会拼到每条分镜提示词之前"
              className="min-h-20 font-mono text-xs"
              spellCheck={false}
            />
            <p className="text-muted-foreground text-xs leading-relaxed">
              上面的描述用于核对设定；真正拼进配图提示词的是这段锚定提示词。改动后重出配图会得到新的图（缓存键随提示词变化）。
            </p>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => onApply({ ...setting, imageAnchor: anchor.trim() })} disabled={!dirty}>
                <Sparkles />
                应用并重新生成配图
              </Button>
              {dirty ? (
                <Button variant="ghost" size="sm" onClick={() => setAnchor(setting.imageAnchor)}>
                  还原
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
