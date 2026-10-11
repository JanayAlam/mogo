import { Play } from 'lucide-react'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Button } from '@/components/ui/button'

describe('Button loading', () => {
  it('shows a spinner, hides its own icon and is disabled', () => {
    const html = renderToStaticMarkup(h(Button, { loading: true }, h(Play), 'Check all'))
    expect(html).toContain('animate-spin')
    expect(html).toContain('data-spinner')
    expect(html).toContain('disabled=""')
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('[&amp;_svg:not([data-spinner])]:hidden')
  })
  it('renders normally when not loading', () => {
    const html = renderToStaticMarkup(h(Button, null, 'Save'))
    expect(html).not.toContain('animate-spin')
    expect(html).not.toContain('disabled=""')
    expect(html).not.toContain('aria-busy')
  })
  it('keeps an explicit disabled', () => {
    expect(renderToStaticMarkup(h(Button, { disabled: true }, 'x'))).toContain('disabled=""')
  })
})
