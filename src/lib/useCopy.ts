import { useCallback, useEffect, useRef, useState } from 'react'

/** 复制到剪贴板，带短暂的「已复制」反馈；key 用于区分同一组件内的多个复制按钮 */
export function useCopy(resetDelay = 1600) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const timer = useRef<number | null>(null)

  const copy = useCallback(
    async (key: string, text: string) => {
      if (!text) return
      try {
        await navigator.clipboard.writeText(text)
      } catch {
        // 非安全上下文（http）下 clipboard API 不可用，降级到 execCommand
        const ta = document.createElement('textarea')
        ta.value = text
        ta.setAttribute('readonly', '')
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      setCopiedKey(key)
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopiedKey(null), resetDelay)
    },
    [resetDelay],
  )

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])

  return { copiedKey, copy }
}

export function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
