import React, { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, ChevronDown } from 'lucide-react'
import { cx } from '../../lib/utils'
import Button from './Button'

export interface MenuItem {
  id: string
  label: React.ReactNode
  onSelect: () => void
  icon?: React.ReactNode
  shortcut?: string
  disabled?: boolean
  checked?: boolean
  dividerBefore?: boolean
}

interface MenuProps {
  label: React.ReactNode
  items: MenuItem[]
  leadingIcon?: React.ReactNode
  className?: string
  align?: 'start' | 'end'
}

const Menu: React.FC<MenuProps> = ({ label, items, leadingIcon, className, align = 'start' }) => {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const keydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', keydown)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', keydown)
    }
  }, [open])

  const focusRelative = (index: number, direction: 1 | -1): void => {
    let next = index
    for (let count = 0; count < items.length; count += 1) {
      next = (next + direction + items.length) % items.length
      if (!items[next]?.disabled) {
        itemRefs.current[next]?.focus()
        return
      }
    }
  }

  return (
    <div ref={rootRef} className={cx('relative', className)}>
      <Button
        ref={triggerRef}
        variant="ghost"
        leadingIcon={leadingIcon}
        trailingIcon={<ChevronDown aria-hidden size={13} strokeWidth={1.75} />}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setOpen(true)
            requestAnimationFrame(() => focusRelative(-1, 1))
          }
        }}
      >
        {label}
      </Button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, scale: 0.97, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -2 }}
            transition={{ type: 'spring', bounce: 0, duration: 0.28 }}
            className={cx(
              'ui-material absolute top-[calc(100%+7px)] z-[80] min-w-56 overflow-hidden rounded-md p-1.5',
              align === 'end' ? 'right-0 origin-top-right' : 'left-0 origin-top-left'
            )}
          >
            {items.map((item, index) => (
              <React.Fragment key={item.id}>
                {item.dividerBefore && <div role="separator" className="mx-2 my-1 h-px bg-border-subtle" />}
                <button
                  ref={(element) => { itemRefs.current[index] = element }}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  className="flex min-h-8 w-full items-center gap-2 rounded-sm px-2.5 text-left text-xs text-text-secondary outline-none hover:bg-panel-hover hover:text-text-primary focus-visible:bg-panel-hover focus-visible:text-text-primary disabled:opacity-40"
                  onClick={() => {
                    item.onSelect()
                    setOpen(false)
                    triggerRef.current?.focus()
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                      event.preventDefault()
                      focusRelative(index, event.key === 'ArrowDown' ? 1 : -1)
                    }
                    if (event.key === 'Home' || event.key === 'End') {
                      event.preventDefault()
                      focusRelative(event.key === 'Home' ? -1 : 0, event.key === 'Home' ? 1 : -1)
                    }
                  }}
                >
                  <span className="flex w-4 shrink-0 items-center justify-center">
                    {item.checked ? <Check aria-hidden size={14} /> : item.icon}
                  </span>
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.shortcut && <span className="font-mono text-[10px] text-text-muted">{item.shortcut}</span>}
                </button>
              </React.Fragment>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default Menu
