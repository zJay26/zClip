function closestElement(target: EventTarget | null): HTMLElement | null {
  return target instanceof HTMLElement ? target : null
}

export function isTextEditingTarget(target: EventTarget | null): boolean {
  const element = closestElement(target)
  if (!element) return false
  return Boolean(
    element.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')
  )
}

export function shouldPreserveNativeSpace(target: EventTarget | null): boolean {
  const element = closestElement(target)
  if (!element) return false
  const interactive = element.closest(
    'button, a[href], input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="button"], [role="menuitem"], [role="slider"], [role="separator"]'
  )
  const editorSurface = element.closest('[data-editor-shortcut-surface]')
  if (editorSurface && interactive === editorSurface) return false
  return Boolean(interactive)
}

export function shouldPreserveDirectionalKeys(target: EventTarget | null): boolean {
  const element = closestElement(target)
  if (!element) return false
  return Boolean(
    element.closest(
      'input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="menu"], [role="slider"], [role="separator"], [data-preview-transform-handle]'
    )
  )
}

export function shouldPreserveDeleteKeys(target: EventTarget | null): boolean {
  const element = closestElement(target)
  if (!element) return false
  return isTextEditingTarget(element) || Boolean(element.closest('[data-local-delete]'))
}

export function hasBlockingKeyboardLayer(documentRef: Document = document): boolean {
  return Boolean(
    documentRef.querySelector('[role="dialog"][aria-modal="true"], [role="menu"]')
  )
}
