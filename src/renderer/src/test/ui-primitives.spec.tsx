import React from 'react'
import { describe, expect, test } from 'vitest'
import { render } from '@testing-library/react'
import { Badge, Button, ProgressBar } from '@renderer/components/ui'

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
})
