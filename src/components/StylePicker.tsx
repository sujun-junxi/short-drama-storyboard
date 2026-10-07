import { useState } from 'react'

import { STYLE_DIMENSIONS, TONE_MAX, getToneTags, promoteToneTag, toggleStyleTag } from '@/lib/style-presets'
import { cn } from '@/lib/utils'

interface StylePickerProps {
  value: string[]
  onChange: (next: string[]) => void
  className?: string
}

/**
 * 风格选择器：按维度分组展示风格按键，按键上只放图标与名称，
 * 详细说明统一在每组下方固定高度的说明区里展示。
 *
 * 题材组（ranked）额外带「主 / 辅」徽标，点击可互换主次。
 */
export function StylePicker({ value, onChange, className }: StylePickerProps) {
  // 只记录正在悬停/聚焦的选项 id，用于驱动说明区；不进 FormState
  const [preview, setPreview] = useState<string | null>(null)

  const clearPreview = (id: string) => setPreview((prev) => (prev === id ? null : prev))

  return (
    <div className={cn('flex flex-col', className)}>
      {STYLE_DIMENSIONS.map((dim, index) => {
        const titleId = `style-dim-${dim.id}`
        const descId = `style-desc-${dim.id}`
        const selected = dim.options.filter((opt) => value.includes(opt.id))
        const max = dim.max ?? TONE_MAX
        const atLimit = dim.mode === 'ranked' && selected.length >= max
        // 题材组按主次顺序排列，主基调排在首位
        const toneOrder = dim.mode === 'ranked' ? getToneTags(value) : []

        // 说明区优先级：悬停/聚焦项 > 题材组的主基调 > 该组已选首项 > 占位提示
        const primaryOption =
          dim.mode === 'ranked' ? dim.options.find((opt) => opt.id === toneOrder[0]) : undefined
        const shown = dim.options.find((opt) => opt.id === preview) ?? primaryOption ?? selected[0]

        // 题材组把已选项按主次顺序提到最前，让「界面排列顺序」与「主次顺序」一致——
        // 否则取消主基调后升主的项在视觉上可能不是相邻的下一个，会很反直觉。
        const orderedOptions =
          dim.mode === 'ranked'
            ? [
                ...toneOrder
                  .map((id) => dim.options.find((opt) => opt.id === id))
                  .filter((opt): opt is (typeof dim.options)[number] => Boolean(opt)),
                ...dim.options.filter((opt) => !toneOrder.includes(opt.id)),
              ]
            : dim.options

        return (
          <section
            key={dim.id}
            role="group"
            aria-labelledby={titleId}
            className={cn('flex flex-col gap-2', index > 0 && 'border-border/60 mt-4 border-t pt-4')}
          >
            <div className="flex items-center gap-2">
              <span id={titleId} className="text-foreground/80 text-xs font-medium tracking-wide">
                {dim.title}
              </span>
              <span className="text-muted-foreground/70 text-[10px]">
                {dim.mode === 'ranked' ? `最多选 ${max} 个` : dim.mode === 'single' ? '单选' : '可多选'}
              </span>
              {selected.length > 0 ? (
                <span
                  className={cn(
                    'ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums',
                    atLimit ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary',
                  )}
                >
                  已选 {selected.length}
                  {dim.mode === 'ranked' ? `/${max}` : ''}
                </span>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-1.5">
              {orderedOptions.map((opt) => {
                const Icon = opt.icon
                const isActive = value.includes(opt.id)
                const isPrimary = dim.mode === 'ranked' && toneOrder[0] === opt.id
                const locked = atLimit && !isActive

                return (
                  // 外壳是非交互 span：HTML 不允许 button 嵌套 button，
                  // 所以「选择按钮」与「主/辅徽标」做成兄弟节点。
                  <span
                    key={opt.id}
                    onMouseEnter={() => setPreview(opt.id)}
                    onMouseLeave={() => clearPreview(opt.id)}
                    onFocus={() => setPreview(opt.id)}
                    onBlur={() => clearPreview(opt.id)}
                    className={cn(
                      'inline-flex items-center overflow-hidden rounded-full border transition-colors duration-150',
                      'focus-within:ring-ring/50 focus-within:ring-[3px]',
                      isActive
                        ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                        : 'border-border bg-muted/40 text-muted-foreground hover:border-primary/40 hover:bg-accent hover:text-accent-foreground',
                      locked && 'cursor-not-allowed opacity-40 hover:border-border hover:bg-muted/40',
                    )}
                  >
                    <button
                      type="button"
                      aria-pressed={isActive}
                      aria-describedby={descId}
                      onClick={() => onChange(toggleStyleTag(value, opt.id))}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium whitespace-nowrap outline-none"
                    >
                      <Icon className="size-3.5 shrink-0" />
                      {opt.label}
                    </button>

                    {dim.mode === 'ranked' && isActive ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onChange(promoteToneTag(value, opt.id))
                        }}
                        aria-label={isPrimary ? `${opt.label}（当前主基调）` : `将 ${opt.label} 设为主基调`}
                        title={isPrimary ? '主基调：主导全片气质' : '点击与主基调互换'}
                        className={cn(
                          'mr-1 inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] leading-none outline-none',
                          isPrimary
                            ? 'bg-primary-foreground/40 font-semibold text-primary-foreground'
                            : 'bg-primary-foreground/10 font-normal text-primary-foreground/70 hover:bg-primary-foreground/25 hover:text-primary-foreground',
                        )}
                      >
                        {isPrimary ? '主' : '辅'}
                      </button>
                    ) : null}
                  </span>
                )
              })}
            </div>

            {/* 固定最小高度：切换说明时面板不跳动 */}
            <p id={descId} className="text-muted-foreground min-h-10 text-xs leading-relaxed">
              {shown ? <span className="text-foreground/70 font-medium">{shown.label}：</span> : null}
              {shown ? shown.desc : dim.hint}
            </p>
          </section>
        )
      })}
    </div>
  )
}
