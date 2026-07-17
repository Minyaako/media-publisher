import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { MediaLock } from '../src/domain.js'
import { publishAssets, writePublishReport } from '../src/publish.js'
import type { ObjectStore, PutObjectInput, RemoteObject } from '../src/storage/types.js'
import { createFixture } from './fixtures.js'
import { buildLock } from '../src/lock.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())))

class MemoryStore implements ObjectStore {
  objects = new Map<string, RemoteObject>()
  puts: PutObjectInput[] = []
  async head(key: string) { return this.objects.get(key) }
  async put(input: PutObjectInput) { this.puts.push(input) }
}

async function setup() {
  const fixture = await createFixture()
  cleanups.push(fixture.cleanup)
  const lock = await buildLock(fixture.manifestPath)
  return { fixture, lock }
}

describe('publishAssets', () => {
  it('uploads a missing immutable object with required metadata', async () => {
    const { fixture, lock } = await setup()
    const store = new MemoryStore()
    const report = await publishAssets({ lock, manifestPath: fixture.manifestPath, store })
    expect(report).toEqual({ version: 1, uploaded: ['home-hero-01'], skipped: [] })
    expect(store.puts[0]).toMatchObject({
      key: lock.assets[0]!.objectKey,
      contentType: 'image/webp',
      cacheControl: 'public, max-age=31536000, immutable',
      metadata: { sha256: lock.assets[0]!.sha256 },
    })
  })

  it('skips only an exact existing object and refuses immutable conflicts', async () => {
    const { fixture, lock } = await setup()
    const asset = lock.assets[0]!
    const exact = new MemoryStore()
    exact.objects.set(asset.objectKey, {
      bytes: asset.bytes, contentType: asset.contentType, sha256: asset.sha256,
    })
    await expect(publishAssets({ lock, manifestPath: fixture.manifestPath, store: exact }))
      .resolves.toEqual({ version: 1, uploaded: [], skipped: [asset.id] })

    const conflict = new MemoryStore()
    conflict.objects.set(asset.objectKey, {
      bytes: asset.bytes, contentType: 'image/png', sha256: asset.sha256,
    })
    await expect(publishAssets({ lock, manifestPath: fixture.manifestPath, store: conflict }))
      .rejects.toThrow(/immutable object conflict/i)
    expect(conflict.puts).toHaveLength(0)
  })

  it('checks local size and hash before making cloud requests', async () => {
    const { fixture, lock } = await setup()
    const store = new MemoryStore()
    const path = join(dirname(fixture.manifestPath), lock.assets[0]!.file)
    await writeFile(path, Buffer.from('changed'))
    await expect(publishAssets({ lock, manifestPath: fixture.manifestPath, store }))
      .rejects.toThrow(/local derivative.*lock/i)
    expect(store.puts).toHaveLength(0)
  })

  it('rejects derivatives larger than 25 MiB before cloud access', async () => {
    const { fixture, lock } = await setup()
    const huge = Buffer.alloc(25 * 1024 * 1024 + 1)
    const path = join(dirname(fixture.manifestPath), lock.assets[0]!.file)
    await writeFile(path, huge)
    const sha256 = createHash('sha256').update(huge).digest('hex')
    const oversized: MediaLock = { ...lock, assets: [{ ...lock.assets[0]!, bytes: huge.length, sha256 }] }
    const store = new MemoryStore()
    await expect(publishAssets({ lock: oversized, manifestPath: fixture.manifestPath, store }))
      .rejects.toThrow(/25 MiB/i)
    expect(store.puts).toHaveLength(0)
  })
})

describe('writePublishReport', () => {
  it('writes inside the workspace and rejects traversal or absolute paths', async () => {
    const fixture = await createFixture()
    cleanups.push(fixture.cleanup)
    await mkdir(join(fixture.root, 'reports'))
    const report = { version: 1 as const, uploaded: ['a'], skipped: [] }
    await writePublishReport(fixture.root, 'reports/result.json', report)
    await expect(writePublishReport(fixture.root, '../escape.json', report)).rejects.toThrow(/report path/i)
    await expect(writePublishReport(fixture.root, 'C:\\escape.json', report)).rejects.toThrow(/report path/i)
  })
})
