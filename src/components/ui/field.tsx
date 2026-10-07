import * as React from 'react'

import { cn } from '@/lib/utils'

const baseField =
  'flex w-full min-w-0 rounded-md border border-input bg-transparent text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground/70 selection:bg-primary/20 selection:text-primary disabled:cursor-not-allowed disabled:opacity-50 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:border-destructive aria-invalid:ring-destructive/20'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return <input type={type} data-slot="input" className={cn(baseField, 'h-9 px-3 py-1', className)} {...props} />
}

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(baseField, 'field-sizing-content min-h-24 resize-y px-3 py-2 leading-relaxed', className)}
      {...props}
    />
  )
}

export { Input, Textarea }
