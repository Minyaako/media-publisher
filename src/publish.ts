import { createHash } from 'node:crypto'
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import sharp from 'sharp'
import type { MediaLock } from './domain.js'
import type { ObjectStore } from './storage/types.js'

const MAX_DERIVATIVE_BYTES = 25 * 1024 * 1024

export type PublishReport = {
  version: 1
  uploaded: string[]
  skipped: string[]
}

type PublishOptions = {
  lock: MediaLock
  manifestPath: string
  store: ObjectStore
}

export async function publishAssets(options: PublishOptions): Promise<PublishReport> {
  const report: PublishReport = { version: 1, uploaded: [], skipped: [] }
  const manifestRoot = await realpath(dirname(options.manifestPath))

  for (const asset of [...options.lock.assets].sort((a, b) => a.id.localeCompare(b.id))) {
    const path = await safeAssetPath(manifestRoot, asset.file)
    const info = await stat(path)
    if (info.size > MAX_DERIVATIVE_BYTES || asset.bytes > MAX_DERIVATIVE_BYTES) {
      throw new Error(`Derivative exceeds 25 MiB: ${asset.id}`)
    }
    const body = await readFile(path)
    const digest = createHash('sha256').update(body).digest('hex')
    if (body.length !== asset.bytes || digest !== asset.sha256) {
      throw new Error(`Local derivative does not match lock: ${asset.id}`)
    }
    const metadata = await sharp(body).metadata()
    if (metadata.format !== 'webp') {
      throw new Error(`Local derivative MIME is not image/webp: ${asset.id}`)
    }

    const remote = await options.store.head(asset.objectKey)
    if (remote) {
      if (
        remote.bytes !== asset.bytes
        || remote.contentType.toLowerCase() !== asset.contentType
        || remote.sha256 !== asset.sha256
      ) {
        throw new Error(`Immutable object conflict: ${asset.objectKey}`)
      }
      report.skipped.push(asset.id)
      continue
    }
    await options.store.put({
      key: asset.objectKey,
      body,
      filePath: path,
      contentType: asset.contentType,
      cacheControl: asset.cacheControl,
      metadata: { sha256: asset.sha256 },
    })
    report.uploaded.push(asset.id)
  }
  return report
}

export async function writePublishReport(
  workspaceRoot: string,
  reportPath: string,
  report: PublishReport,
): Promise<void> {
  const target = resolveReportPath(workspaceRoot, reportPath)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'w' })
}

export function resolveReportPath(workspaceRoot: string, reportPath: string): string {
  if (!reportPath || isAbsolute(reportPath)) throw new Error('Report path must be workspace-relative')
  const root = resolve(workspaceRoot)
  const target = resolve(root, reportPath)
  const fromRoot = relative(root, target)
  if (!fromRoot || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new Error('Report path escapes workspace')
  }
  return target
}

async function safeAssetPath(root: string, file: string): Promise<string> {
  const candidate = await realpath(resolve(root, file))
  const fromRoot = relative(root, candidate)
  if (!fromRoot || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new Error(`Derivative escapes manifest directory: ${file}`)
  }
  const info = await stat(candidate)
  if (!info.isFile()) throw new Error(`Derivative is not a regular file: ${file}`)
  return candidate
}
