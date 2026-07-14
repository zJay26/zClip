import React from 'react'
import { describe, expect, test } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Badge, Button, Dialog, IconButton, Menu, ProgressBar, SegmentedControl } from '@renderer/components/ui'

describe('UI primitives visual baseline', () => {
  test('button variants render stable classes', () => {
    const { container } = render(
      <div>
        <Button variant="primary">Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="danger">Danger</Button>
      </div>
    )
    expect(container.firstChild).toMatchSnapshot()
  })

  test('badge tones render stable classes', () => {
    const { container } = render(
      <div>
        <Badge>Default</Badge>
        <Badge tone="accent">Accent</Badge>
        <Badge tone="danger">Danger</Badge>
      </div>
    )
    expect(container.firstChild).toMatchSnapshot()
  })

  test('progress bar width reflects percent', () => {
    const { container } = render(<ProgressBar value={62.5} />)
    expect(container.firstChild).toMatchSnapshot()
  })

  test('icon button exposes an accessible name', () => {
    render(<IconButton label="Save project" icon={<span aria-hidden>S</span>} />)
    expect(screen.getByRole('button', { name: 'Save project' })).toBeInTheDocument()
  })

  test('segmented control reports and changes the active tab', () => {
    let selected = 'clip'
    const { rerender } = render(
      <SegmentedControl label="Inspector" value={selected} options={[{ value: 'clip', label: 'Clip' }, { value: 'canvas', label: 'Canvas' }]} onChange={(value) => { selected = value }} />
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Canvas' }))
    rerender(<SegmentedControl label="Inspector" value={selected} options={[{ value: 'clip', label: 'Clip' }, { value: 'canvas', label: 'Canvas' }]} onChange={(value) => { selected = value }} />)
    expect(screen.getByRole('tab', { name: 'Canvas' })).toHaveAttribute('aria-selected', 'true')
  })

  test('menu opens and runs a selected action', () => {
    let selected = false
    render(<Menu label="Project" items={[{ id: 'open', label: 'Open', onSelect: () => { selected = true } }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Project' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open' }))
    expect(selected).toBe(true)
  })

  test('dialog closes with Escape and traps dialog semantics', () => {
    let closed = false
    render(<Dialog open title="Export" onClose={() => { closed = true }}><Button>Confirm</Button></Dialog>)
    expect(screen.getByRole('dialog', { name: 'Export' })).toHaveAttribute('aria-modal', 'true')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(closed).toBe(true)
  })
})
