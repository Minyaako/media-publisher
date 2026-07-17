import { createHash } from 'node:crypto'
import { access, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { parse, stringify } from 'yaml'
import { prepareAssets } from '../src/prepare.js'
import { resolveSourceRef } from '../src/source-ref.js'
import { createFixture } from './fixtures.js'

const cleanups: Array<() => Promise<void>> = []
const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex')

async function createRecipeFixture(overrides: Record<string, unknown> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'media-prepare-'))
  const sourceRoot = join(root, 'source-images')
  const sourcePath = join(sourceRoot, 'minyako', 'blog', 'post-cover.jpg')
  const media = join(root, 'repo', 'media')
  const manifestPath = join(media, 'media.yaml')
  const lockPath = join(media, 'media.lock.json')
  const outputPath = join(media, 'assets', 'posts', 'post-cover.webp')
  await mkdir(join(sourceRoot, 'minyako', 'blog'), { recursive: true })
  await mkdir(media, { recursive: true })

  await sharp({
    create: {
      width: 1400,
      height: 900,
      channels: 3,
      background: { r: 180, g: 80, b: 30 },
    },
  })
    .jpeg({ quality: 95 })
    .withMetadata({ orientation: 6 })
    .toFile(sourcePath)

  const transform = {
    mode: 'recipe',
    engine: 'sharp',
    engineVersion: '0.1.0',
    width: 1200,
    height: 630,
    fit: 'cover',
    focalPoint: [0.7, 0.4],
    rotate: 90,
    quality: 84,
    ...overrides,
  }
  const manifest = {
    version: 1,
    namespace: 'blog',
    cdnBaseUrl: 'https://pic.minyako.top',
    assets: [{
      id: 'post-cover',
      file: 'assets/posts/post-cover.webp',
      objectBase: 'posts/example/cover',
      sourceRef: 'shared://minyako/blog/post-cover.jpg',
      rights: 'user-provided',
      transform,
    }],
  }
  await writeFile(manifestPath, stringify(manifest), 'utf8')

  return {
    root,
    sourceRoot,
    sourcePath,
    media,
    manifestPath,
    lockPath,
    outputPath,
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

describe('media preparation', () => {
  it('auto-orients, rotates, cover-crops, and writes the declared WebP size', async () => {
    const fixture = await createRecipeFixture()
    cleanups.push(fixture.cleanup)

    const result = await prepareAssets({
      manifestPath: fixture.manifestPath,
      sourceRoot: fixture.sourceRoot,
      lockPath: fixture.lockPath,
    })

    expect(result).toEqual({ generated: ['post-cover'], skipped: [] })
    const metadata = await sharp(await readFile(fixture.outputPath)).metadata()
    expect(metadata).toMatchObject({ format: 'webp', width: 1200, height: 630 })
    expect(metadata.orientation).toBeUndefined()

    const lock = JSON.parse(await readFile(fixture.lockPath, 'utf8')) as {
      assets: Array<{ sourceSha256?: string; recipeSha256?: string }>
    }
    expect(lock.assets[0]?.sourceSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(lock.assets[0]?.recipeSha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('refuses to enlarge a source for a cover recipe', async () => {
    const fixture = await createRecipeFixture({ width: 2400, height: 1260 })
    cleanups.push(fixture.cleanup)

    await expect(prepareAssets({
      manifestPath: fixture.manifestPath,
      sourceRoot: fixture.sourceRoot,
      lockPath: fixture.lockPath,
    })).rejects.toThrow('recipe would enlarge the source')
  })

  it('resolves only a regular supported file under the explicit source root', async () => {
    const fixture = await createRecipeFixture()
    cleanups.push(fixture.cleanup)

    await expect(resolveSourceRef(
      'shared://minyako/blog/post-cover.jpg',
      fixture.sourceRoot,
    )).resolves.toBe(fixture.sourcePath)

    await expect(resolveSourceRef(
      'shared://../private.png',
      fixture.sourceRoot,
    )).rejects.toThrow('source reference escapes source root')

    await expect(resolveSourceRef(
      'shared://minyako/blog',
      fixture.sourceRoot,
    )).rejects.toThrow('source reference must resolve to a regular file')

    const textPath = join(fixture.sourceRoot, 'minyako', 'blog', 'notes.txt')
    await writeFile(textPath, 'not an image', 'utf8')
    await expect(resolveSourceRef(
      'shared://minyako/blog/notes.txt',
      fixture.sourceRoot,
    )).rejects.toThrow('source reference must be PNG, JPEG, or WebP')
  })

  it('fits inside maximum bounds without enlargement', async () => {
    const fixture = await createRecipeFixture({
      width: 800,
      height: 800,
      fit: 'inside',
      rotate: 90,
    })
    cleanups.push(fixture.cleanup)

    await prepareAssets({
      manifestPath: fixture.manifestPath,
      sourceRoot: fixture.sourceRoot,
      lockPath: fixture.lockPath,
    })
    const metadata = await sharp(await readFile(fixture.outputPath)).metadata()

    expect(metadata.format).toBe('webp')
    expect(metadata.width).toBeLessThanOrEqual(800)
    expect(metadata.height).toBeLessThanOrEqual(800)
    expect(Math.max(metadata.width ?? 0, metadata.height ?? 0)).toBe(800)
  })

  it('rejects a derivative directory link before writing outside the manifest root', async () => {
    const fixture = await createRecipeFixture()
    cleanups.push(fixture.cleanup)
    const outside = join(fixture.root, 'outside')
    const linkedAssets = join(fixture.media, 'assets')
    const escapedOutput = join(outside, 'posts', 'post-cover.webp')
    await mkdir(outside)
    await symlink(outside, linkedAssets, process.platform === 'win32' ? 'junction' : 'dir')

    await expect(prepareAssets({
      manifestPath: fixture.manifestPath,
      sourceRoot: fixture.sourceRoot,
      lockPath: fixture.lockPath,
    })).rejects.toThrow('Derivative output escapes manifest directory')
    await expect(access(escapedOutput)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('skips an unchanged recipe when source, recipe, and output hashes match', async () => {
    const fixture = await createRecipeFixture()
    cleanups.push(fixture.cleanup)
    await prepareAssets({
      manifestPath: fixture.manifestPath,
      sourceRoot: fixture.sourceRoot,
      lockPath: fixture.lockPath,
    })

    const before = digest(await readFile(fixture.outputPath))
    const result = await prepareAssets({
      manifestPath: fixture.manifestPath,
      sourceRoot: fixture.sourceRoot,
      lockPath: fixture.lockPath,
    })

    expect(result).toEqual({ generated: [], skipped: ['post-cover'] })
    expect(digest(await readFile(fixture.outputPath))).toBe(before)
  })

  it('validates imported derivatives and creates a lock without a source root', async () => {
    const fixture = await createFixture()
    cleanups.push(fixture.cleanup)
    const before = digest(await readFile(fixture.webpPath))

    const result = await prepareAssets({
      manifestPath: fixture.manifestPath,
      lockPath: fixture.lockPath,
    })

    expect(result).toEqual({ generated: [], skipped: ['home-hero-01'] })
    expect(digest(await readFile(fixture.webpPath))).toBe(before)
    expect(parse(await readFile(fixture.lockPath, 'utf8')).assets).toHaveLength(1)
  })
})
