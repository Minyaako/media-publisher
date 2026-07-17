import { afterEach, describe, expect, it } from 'vitest'
import { loadManifest } from '../src/manifest.js'
import { createFixture, importedAsset, validManifest } from './fixtures.js'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

describe('media manifest', () => {
  it('loads one imported WebP declaration', async () => {
    const fixture = await createFixture()
    cleanups.push(fixture.cleanup)

    const manifest = await loadManifest(fixture.manifestPath)

    expect(manifest).toEqual(validManifest())
  })

  it.each([
    [
      'duplicate ids',
      validManifest([
        importedAsset(),
        importedAsset({ file: 'assets/home/hero-02.webp', objectBase: 'site/home/hero-02' }),
      ]),
    ],
    [
      'duplicate files',
      validManifest([
        importedAsset(),
        importedAsset({ id: 'home-hero-02', objectBase: 'site/home/hero-02' }),
      ]),
    ],
    [
      'duplicate object bases',
      validManifest([
        importedAsset(),
        importedAsset({ id: 'home-hero-02', file: 'assets/home/hero-02.webp' }),
      ]),
    ],
    ['path traversal', validManifest([importedAsset({ file: '../private.webp' })])],
    ['backslashes', validManifest([importedAsset({ file: 'assets\\home\\hero.webp' })])],
    ['non-https CDN', { ...validManifest(), cdnBaseUrl: 'http://pic.minyako.top' }],
    ['network source', validManifest([importedAsset({ sourceRef: 'https://example.com/a.png' })])],
  ])('rejects %s', async (_name, manifest) => {
    const fixture = await createFixture()
    cleanups.push(fixture.cleanup)
    await fixture.writeManifest(manifest as ReturnType<typeof validManifest>)

    await expect(loadManifest(fixture.manifestPath)).rejects.toThrow()
  })

  it('rejects recipe dimensions, focus, rotation, and quality outside their bounds', async () => {
    const fixture = await createFixture()
    cleanups.push(fixture.cleanup)
    await fixture.writeManifest(validManifest([
      importedAsset({
        transform: {
          mode: 'recipe',
          engine: 'sharp',
          engineVersion: '0.1.0',
          width: 0,
          height: 720,
          fit: 'cover',
          focalPoint: [1.1, 0.5],
          rotate: 45,
          quality: 101,
        },
      }),
    ]))

    await expect(loadManifest(fixture.manifestPath)).rejects.toThrow()
  })
})
