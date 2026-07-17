import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import sharp from 'sharp'
import type { MediaLock, RecipeTransform } from './domain.js'
import { buildLock, serializeLock } from './lock.js'
import { loadManifest } from './manifest.js'
import { resolveSourceRef } from './source-ref.js'

export type PrepareResult = {
  generated: string[]
  skipped: string[]
}

export type PrepareOptions = {
  manifestPath: string
  lockPath: string
  sourceRoot?: string
}

const sha256 = (value: Buffer | string) =>
  createHash('sha256').update(value).digest('hex')

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), maximum)

async function readPreviousLock(lockPath: string): Promise<MediaLock | undefined> {
  try {
    return JSON.parse(await readFile(lockPath, 'utf8')) as MediaLock
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function resolveOutput(manifestPath: string, file: string) {
  const root = await realpath(dirname(manifestPath))
  const output = resolve(root, file)
  const fromRoot = relative(root, output)
  if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new Error(`Derivative output escapes manifest directory: ${file}`)
  }

  const parent = dirname(output)
  let existing = parent
  while (true) {
    try {
      const resolvedExisting = await realpath(existing)
      const existingFromRoot = relative(root, resolvedExisting)
      if (existingFromRoot.startsWith('..') || isAbsolute(existingFromRoot)) {
        throw new Error(`Derivative output escapes manifest directory: ${file}`)
      }
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const ancestor = dirname(existing)
      if (ancestor === existing) throw error
      existing = ancestor
    }
  }

  await mkdir(parent, { recursive: true })
  const resolvedParent = await realpath(parent)
  const parentFromRoot = relative(root, resolvedParent)
  if (parentFromRoot.startsWith('..') || isAbsolute(parentFromRoot)) {
    throw new Error(`Derivative output escapes manifest directory: ${file}`)
  }
  return output
}

async function unchangedOutput(
  outputPath: string,
  previous: MediaLock['assets'][number] | undefined,
  sourceSha256: string,
  recipeSha256: string,
) {
  if (
    previous?.sourceSha256 !== sourceSha256
    || previous.recipeSha256 !== recipeSha256
  ) return false

  try {
    return sha256(await readFile(outputPath)) === previous.sha256
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function encodeRecipe(sourcePath: string, recipe: RecipeTransform) {
  const oriented = await sharp(sourcePath, { limitInputPixels: 100_000_000 })
    .autoOrient()
    .rotate(recipe.rotate)
    .toColourspace('srgb')
    .toBuffer({ resolveWithObject: true })

  const sourceWidth = oriented.info.width
  const sourceHeight = oriented.info.height
  let pipeline = sharp(oriented.data, { limitInputPixels: 100_000_000 })

  if (recipe.fit === 'cover') {
    const scale = Math.max(recipe.width / sourceWidth, recipe.height / sourceHeight)
    if (scale > 1) throw new Error('recipe would enlarge the source')

    const resizedWidth = Math.max(recipe.width, Math.ceil(sourceWidth * scale))
    const resizedHeight = Math.max(recipe.height, Math.ceil(sourceHeight * scale))
    const [focalX, focalY] = recipe.focalPoint
    const left = clamp(
      Math.round(focalX * resizedWidth - recipe.width / 2),
      0,
      resizedWidth - recipe.width,
    )
    const top = clamp(
      Math.round(focalY * resizedHeight - recipe.height / 2),
      0,
      resizedHeight - recipe.height,
    )
    pipeline = pipeline
      .resize(resizedWidth, resizedHeight, { fit: 'fill' })
      .extract({ left, top, width: recipe.width, height: recipe.height })
  } else {
    pipeline = pipeline.resize(recipe.width, recipe.height, {
      fit: 'inside',
      withoutEnlargement: true,
    })
  }

  return pipeline
    .webp({ quality: recipe.quality, effort: 6, smartSubsample: true })
    .toBuffer()
}

async function writeAtomic(path: string, body: Buffer | string) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, body)
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}

export async function prepareAssets(options: PrepareOptions): Promise<PrepareResult> {
  const manifest = await loadManifest(options.manifestPath)
  const previousLock = await readPreviousLock(options.lockPath)
  const previousAssets = new Map(
    (previousLock?.assets ?? []).map((asset) => [asset.id, asset]),
  )
  const sourceHashes = new Map<string, string>()
  const result: PrepareResult = { generated: [], skipped: [] }

  for (const asset of [...manifest.assets].sort((left, right) => left.id.localeCompare(right.id))) {
    if (asset.transform.mode === 'imported') {
      result.skipped.push(asset.id)
      continue
    }
    if (!options.sourceRoot) {
      throw new Error(`--source-root is required for recipe asset: ${asset.id}`)
    }

    const sourcePath = await resolveSourceRef(asset.sourceRef, options.sourceRoot)
    const sourceSha256 = sha256(await readFile(sourcePath))
    const recipeSha256 = sha256(canonicalJson(asset.transform))
    const outputPath = await resolveOutput(options.manifestPath, asset.file)
    sourceHashes.set(asset.id, sourceSha256)

    if (await unchangedOutput(
      outputPath,
      previousAssets.get(asset.id),
      sourceSha256,
      recipeSha256,
    )) {
      result.skipped.push(asset.id)
      continue
    }

    const output = await encodeRecipe(sourcePath, asset.transform)
    const metadata = await sharp(output).metadata()
    if (
      metadata.format !== 'webp'
      || !metadata.width
      || !metadata.height
      || (metadata.pages ?? 1) !== 1
      || (asset.transform.fit === 'cover'
        && (metadata.width !== asset.transform.width || metadata.height !== asset.transform.height))
      || (asset.transform.fit === 'inside'
        && (metadata.width > asset.transform.width || metadata.height > asset.transform.height))
    ) {
      throw new Error(`Generated derivative failed verification: ${asset.id}`)
    }

    await writeAtomic(outputPath, output)
    result.generated.push(asset.id)
  }

  for (const previous of previousLock?.assets ?? []) {
    if (previous.sourceSha256 && !sourceHashes.has(previous.id)) {
      sourceHashes.set(previous.id, previous.sourceSha256)
    }
  }

  const lock = await buildLock(options.manifestPath, sourceHashes)
  await writeAtomic(options.lockPath, serializeLock(lock))
  return result
}
