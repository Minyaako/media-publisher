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

export async function buildLock(manifestPath: string): Promise<MediaLock> {
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

export async function validateLock(manifestPath: string, lockPath: string): Promise<void> {
  const [actual, expected] = await Promise.all([
    readFile(lockPath, 'utf8'),
    buildLock(manifestPath).then(serializeLock),
  ])

  if (actual !== expected) {
    throw new Error('media lock is stale; regenerate it from the current manifest and derivatives')
  }
}
