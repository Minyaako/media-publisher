import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { stringify } from 'yaml'

export type FixtureManifest = {
  version: 1
  namespace: string
  cdnBaseUrl: string
  assets: Array<Record<string, unknown>>
}

export const importedAsset = (overrides: Record<string, unknown> = {}) => ({
  id: 'home-hero-01',
  file: 'assets/home/hero-01.webp',
  objectBase: 'site/home/hero-01',
  sourceRef: 'shared://minyako/blog/2026-initial/home/hero-01.png',
  rights: 'user-provided',
  transform: { mode: 'imported' },
  ...overrides,
})

export const validManifest = (
  assets: Array<Record<string, unknown>> = [importedAsset()],
): FixtureManifest => ({
  version: 1,
  namespace: 'blog',
  cdnBaseUrl: 'https://pic.minyako.top',
  assets,
})

export async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'media-publisher-'))
  const media = join(root, 'media')
  const assets = join(media, 'assets', 'home')
  await mkdir(assets, { recursive: true })

  const manifestPath = join(media, 'media.yaml')
  const lockPath = join(media, 'media.lock.json')
  const webpPath = join(assets, 'hero-01.webp')

  await sharp({
    create: {
      width: 64,
      height: 32,
      channels: 4,
      background: { r: 20, g: 40, b: 60, alpha: 1 },
    },
  }).webp({ lossless: true }).toFile(webpPath)

  const writeManifest = async (manifest: FixtureManifest) => {
    await writeFile(manifestPath, stringify(manifest), 'utf8')
    return manifestPath
  }

  await writeManifest(validManifest())

  return {
    root,
    media,
    manifestPath,
    lockPath,
    webpPath,
    writeManifest,
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}
