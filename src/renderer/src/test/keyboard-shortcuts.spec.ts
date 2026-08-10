import { describe, expect, test } from 'vitest'
import {
  hasBlockingKeyboardLayer,
  isTextEditingTarget,
  shouldPreserveDeleteKeys,
  shouldPreserveDirectionalKeys,
  shouldPreserveNativeSpace
} from '@renderer/lib/keyboard-shortcuts'

describe('editor keyboard shortcut routing', () => {
  test('preserves native typing and Space behavior for interactive controls', () => {
    const input = document.createElement('input')
    const button = document.createElement('button')
    const roleButton = document.createElement('div')
    roleButton.setAttribute('role', 'button')
    const clip = document.createElement('div')
    clip.setAttribute('role', 'button')
    clip.dataset.editorShortcutSurface = ''
    const nestedButton = document.createElement('button')
    clip.append(nestedButton)

    expect(isTextEditingTarget(input)).toBe(true)
    expect(shouldPreserveNativeSpace(input)).toBe(true)
    expect(shouldPreserveNativeSpace(button)).toBe(true)
    expect(shouldPreserveNativeSpace(roleButton)).toBe(true)
    expect(shouldPreserveNativeSpace(clip)).toBe(false)
    expect(shouldPreserveNativeSpace(nestedButton)).toBe(true)
    expect(shouldPreserveNativeSpace(document.body)).toBe(false)
  })

  test('lets sliders, separators, and transform handles own arrow keys', () => {
    const slider = document.createElement('div')
    slider.setAttribute('role', 'slider')
    const separator = document.createElement('div')
    separator.setAttribute('role', 'separator')
    const transform = document.createElement('div')
    transform.dataset.previewTransformHandle = ''

    expect(shouldPreserveDirectionalKeys(slider)).toBe(true)
    expect(shouldPreserveDirectionalKeys(separator)).toBe(true)
    expect(shouldPreserveDirectionalKeys(transform)).toBe(true)
    expect(shouldPreserveDirectionalKeys(document.body)).toBe(false)
  })

  test('lets focused timeline effects own Delete', () => {
    const effect = document.createElement('div')
    effect.dataset.localDelete = ''
    expect(shouldPreserveDeleteKeys(effect)).toBe(true)
    expect(shouldPreserveDeleteKeys(document.body)).toBe(false)
  })

  test('blocks editor shortcuts while a modal or menu owns the keyboard', () => {
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    document.body.append(dialog)
    expect(hasBlockingKeyboardLayer()).toBe(true)
    dialog.remove()

    const menu = document.createElement('div')
    menu.setAttribute('role', 'menu')
    document.body.append(menu)
    expect(hasBlockingKeyboardLayer()).toBe(true)
    menu.remove()
    expect(hasBlockingKeyboardLayer()).toBe(false)
  })
})
