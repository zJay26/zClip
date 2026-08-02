// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import { createRendererAssetResponse, resolveRendererAssetPath } from './renderer-asset-response'

describe('renderer asset protocol', () => {
  it('only resolves the fixed app host and flat generated asset paths', () => {
    const root = path.resolve('renderer')
    expect(resolveRendererAssetPath(root, 'zclip-app://app/')).toBe(path.join(root, 'index.html'))
    expect(resolveRendererAssetPath(root, 'zclip-app://app/assets/index-Ab12.js')).toBe(path.join(root, 'assets', 'index-Ab12.js'))
    expect(resolveRendererAssetPath(root, 'zclip-app://other/index.html')).toBeNull()
    expect(resolveRendererAssetPath(root, 'zclip-app://app/%2e%2e/secret.txt')).toBeNull()
    expect(resolveRendererAssetPath(root, 'zclip-app://app/assets/nested/file.js')).toBeNull()
  })

  it('serves packaged assets with CSP, immutable caching and no sniffing', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'zclip-renderer-assets-'))
    await mkdir(path.join(root, 'assets'))
    await writeFile(path.join(root, 'index.html'), '<!doctype html>')
    await writeFile(path.join(root, 'assets', 'index-test.js'), 'export {}')
    try {
      const html = await createRendererAssetResponse(root, new Request('zclip-app://app/index.html'))
      expect(html.status).toBe(200)
      expect(html.headers.get('cache-control')).toBe('no-store')
      expect(html.headers.get('content-security-policy')).toContain("script-src 'self'")
      expect(html.headers.get('x-content-type-options')).toBe('nosniff')
      expect(await html.text()).toBe('<!doctype html>')

      const asset = await createRendererAssetResponse(root, new Request('zclip-app://app/assets/index-test.js', { method: 'HEAD' }))
      expect(asset.status).toBe(200)
      expect(asset.headers.get('content-type')).toContain('text/javascript')
      expect(asset.headers.get('cache-control')).toContain('immutable')
      expect(await asset.text()).toBe('')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
