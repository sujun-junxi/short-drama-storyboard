import { Moon, Sun } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useTheme } from '@/lib/theme'

export function ThemeToggle() {
  const { theme, toggle } = useTheme()
  return (
    <Button variant="outline" size="icon" onClick={toggle} aria-label="切换深色模式" title="切换深色模式">
      {theme === 'dark' ? <Moon className="size-4" /> : <Sun className="size-4" />}
    </Button>
  )
}
