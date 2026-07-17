import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { LockedAsset, MediaLock } from '../src/domain.js'
import { verifyPublishedAssets } from '../src/verify.js'

const body = Buffer.from('RIFF fixture webp bytes')
const asset: LockedAsset = {
  id: 'home-hero-01', file: 'assets/hero.webp',
  sha256: createHash('sha256').update(body).digest('hex'), bytes: body.length,
  contentType: 'image/webp', width: 1, height: 1,
  objectKey: 'blog/site/hero-hash.webp',
  url: 'https://pic.minyako.top/blog/site/hero-hash.webp',
  cacheControl: 'public, max-age=31536000, immutable',
  sourceRef: 'shared://hero.png', rights: 'private',
}
const lock: MediaLock = {
  version: 1, publisherVersion: '0.1.0', namespace: 'blog',
  cdnBaseUrl: 'https://pic.minyako.top', assets: [asset],
}

const response = (value = body, init: ResponseInit = {}) => new Response(value, {
  status: 200,
  headers: { 'content-type': 'image/webp', 'content-length': String(value.length) },
  ...init,
})

describe('verifyPublishedAssets', () => {
  it('retries retryable failures and verifies the complete downloaded hash', async () => {
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(response())
    const sleep = vi.fn(async () => {})
    await expect(verifyPublishedAssets({ lock, fetch, sleep })).resolves.toEqual({
      version: 1, verified: ['home-hero-01'],
    })
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([1000, 2000])
    expect(fetch.mock.calls[0]![1]).toMatchObject({ redirect: 'manual' })
  })

  it.each([
    ['insecure URL', { ...asset, url: 'http://pic.minyako.top/a.webp' }, /HTTPS/i],
    ['redirect', asset, /redirect/i, new Response(null, { status: 302 })],
    ['MIME mismatch', asset, /MIME/i, response(body, { headers: { 'content-type': 'image/png', 'content-length': String(body.length) } })],
    ['length mismatch', asset, /length|size/i, response(body, { headers: { 'content-type': 'image/webp', 'content-length': '999' } })],
    ['hash mismatch', asset, /hash/i, response(Buffer.alloc(body.length, 7))],
  ])('rejects %s without retrying', async (_name, testAsset, pattern, custom = response()) => {
    const fetch = vi.fn(async () => custom)
    const sleep = vi.fn(async () => {})
    await expect(verifyPublishedAssets({ lock: { ...lock, assets: [testAsset] }, fetch, sleep }))
      .rejects.toThrow(pattern)
    expect(fetch).toHaveBeenCalledTimes(testAsset.url.startsWith('https:') ? 1 : 0)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('uses all four bounded retry delays', async () => {
    const fetch = vi.fn(async () => new Response('busy', { status: 429 }))
    const sleep = vi.fn(async () => {})
    await expect(verifyPublishedAssets({ lock, fetch, sleep })).rejects.toThrow(/429/)
    expect(fetch).toHaveBeenCalledTimes(5)
    expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([1000, 2000, 4000, 8000])
  })

  it('rejects a declared response above 25 MiB', async () => {
    const fetch = vi.fn(async () => response(body, {
      headers: { 'content-type': 'image/webp', 'content-length': String(25 * 1024 * 1024 + 1) },
    }))
    await expect(verifyPublishedAssets({ lock, fetch, sleep: async () => {} })).rejects.toThrow(/25 MiB/i)
  })
})
