import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import sharp from 'sharp'
import {
  IMMUTABLE_CACHE_CONTROL,
  PUBLISHER_VERSION,
  type LockedAsset,
  type MediaLock,
} from './domain.js'
import { loadManifest } from './manifest.js'

const sha256 = (value: Buffer | string) =>
  createHash('sha256').update(value).digest('hex')

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

async function resolveDerivative(manifestPath: string, file: string) {
  const root = await realpath(dirname(manifestPath))
  const candidate = await realpath(resolve(root, file))
  const fromRoot = relative(root, candidate)

  if (fromRoot === '' || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new Error(`Derivative escapes manifest directory: ${file}`)
  }

  const info = await stat(candidate)
  if (!info.isFile()) {
    throw new Error(`Derivative is not a regular file: ${file}`)
  }

  return candidate
}

export async function buildLock(
  manifestPath: string,
  sourceHashes: ReadonlyMap<string, string> = new Map(),
): Promise<MediaLock> {
  const manifest = await loadManifest(manifestPath)
  const assets: LockedAsset[] = []

  for (const asset of [...manifest.assets].sort((left, right) => left.id.localeCompare(right.id))) {
    const path = await resolveDerivative(manifestPath, asset.file)
    const body = await readFile(path)
    const metadata = await sharp(body).metadata()

    if (metadata.format !== 'webp') {
      throw new Error(`Expected WebP derivative: ${asset.file}`)
    }
    if (!metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1) {
      throw new Error(`Expected one decodable WebP frame: ${asset.file}`)
    }

    const digest = sha256(body)
    const objectKey = `${manifest.namespace}/${asset.objectBase}-${digest}.webp`

    const provenance = asset.transform.mode === 'recipe'
      ? {
          ...(sourceHashes.get(asset.id)
            ? { sourceSha256: sourceHashes.get(asset.id) }
            : {}),
          recipeSha256: sha256(canonicalJson(asset.transform)),
        }
      : {}

    assets.push({
      id: asset.id,
      file: asset.file,
      sha256: digest,
      bytes: body.byteLength,
      contentType: 'image/webp',
      width: metadata.width,
      height: metadata.height,
      objectKey,
      url: new URL(objectKey, `${manifest.cdnBaseUrl}/`).toString(),
      cacheControl: IMMUTABLE_CACHE_CONTROL,
      sourceRef: asset.sourceRef,
      rights: asset.rights,
      ...provenance,
    })
  }

  return {
    version: 1,
    publisherVersion: PUBLISHER_VERSION,
    namespace: manifest.namespace,
    cdnBaseUrl: manifest.cdnBaseUrl,
    assets,
  }
}

export function serializeLock(lock: MediaLock) {
  return `${JSON.stringify(lock, null, 2)}\n`
}

export async function loadLock(lockPath: string): Promise<MediaLock> {
  const parsed: unknown = JSON.parse(await readFile(lockPath, 'utf8'))
  if (!isMediaLock(parsed)) throw new Error('media lock is malformed')
  return parsed
}

export async function validateLock(manifestPath: string, lockPath: string): Promise<void> {
  const actual = await readFile(lockPath, 'utf8')
  const parsed = JSON.parse(actual) as Partial<MediaLock>
  const sourceHashes = new Map(
    (parsed.assets ?? [])
      .filter((asset): asset is LockedAsset & { sourceSha256: string } =>
        typeof asset.sourceSha256 === 'string',
      )
      .map((asset) => [asset.id, asset.sourceSha256]),
  )
  const expected = serializeLock(await buildLock(manifestPath, sourceHashes))

  if (actual !== expected) {
    throw new Error('media lock is stale; regenerate it from the current manifest and derivatives')
  }
}

function isMediaLock(value: unknown): value is MediaLock {
  if (typeof value !== 'object' || value === null) return false
  const lock = value as Partial<MediaLock>
  return lock.version === 1
    && typeof lock.publisherVersion === 'string'
    && typeof lock.namespace === 'string'
    && typeof lock.cdnBaseUrl === 'string'
    && Array.isArray(lock.assets)
    && lock.assets.every((asset) =>
      typeof asset === 'object' && asset !== null
      && typeof asset.id === 'string'
      && typeof asset.file === 'string'
      && typeof asset.sha256 === 'string' && /^[a-f0-9]{64}$/.test(asset.sha256)
      && typeof asset.bytes === 'number' && Number.isSafeInteger(asset.bytes) && asset.bytes >= 0
      && asset.contentType === 'image/webp'
      && typeof asset.objectKey === 'string'
      && typeof asset.url === 'string'
      && typeof asset.cacheControl === 'string'
      && typeof asset.width === 'number'
      && typeof asset.height === 'number'
      && typeof asset.sourceRef === 'string'
      && typeof asset.rights === 'string',
    )
}
