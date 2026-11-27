// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import SmoothOverlay from '@/components/SmoothOverlay'

function renderOverlay(onClose: () => void) {
  return React.createElement(
    SmoothOverlay,
    { open: true, onClose },
    React.createElement('input', { 'aria-label': 'Metin' }),
  )
}

describe('SmoothOverlay', () => {
  it('keeps the input focused while its parent rerenders from typing', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => {
      root.render(renderOverlay(() => {}))
    })

    const input = container.querySelector('input')
    expect(input).not.toBeNull()

    input?.focus()
    act(() => {
      root.render(renderOverlay(() => {}))
    })

    expect(document.activeElement).toBe(input)

    root.unmount()
    container.remove()
  })
})
