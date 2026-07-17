import { createHash } from 'node:crypto'
import type { MediaLock } from './domain.js'
import type { FetchLike } from './auth/types.js'

const MAX_BYTES = 25 * 1024 * 1024
const RETRY_DELAYS = [1_000, 2_000, 4_000, 8_000] as const

export type VerifyReport = { version: 1; verified: string[] }

type VerifyOptions = {
  lock: MediaLock
  fetch?: FetchLike
  sleep?: (milliseconds: number) => Promise<void>
  ids?: ReadonlySet<string>
}

class RetryableHttpError extends Error {}

export async function verifyPublishedAssets(options: VerifyOptions): Promise<VerifyReport> {
  const fetcher = options.fetch ?? globalThis.fetch
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  const verified: string[] = []
  const assets = [...options.lock.assets]
    .filter((asset) => !options.ids || options.ids.has(asset.id))
    .sort((a, b) => a.id.localeCompare(b.id))

  for (const asset of assets) {
    const url = new URL(asset.url)
    if (url.protocol !== 'https:') throw new Error(`Verification URL must use HTTPS: ${asset.id}`)

    let complete = false
    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt += 1) {
      try {
        const response = await fetcher(url, { method: 'GET', redirect: 'manual' })
        if (response.status >= 300 && response.status < 400) {
          throw new Error(`Verification redirect is forbidden (${response.status}): ${asset.id}`)
        }
        if (response.status === 429 || response.status >= 500) {
          throw new RetryableHttpError(`Verification failed (${response.status}): ${asset.id}`)
        }
        if (!response.ok) throw new Error(`Verification failed (${response.status}): ${asset.id}`)
        const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
        if (contentType !== 'image/webp') throw new Error(`Verification MIME mismatch: ${asset.id}`)
        const declared = parseContentLength(response.headers.get('content-length'))
        if (declared !== undefined && declared > MAX_BYTES) {
          throw new Error(`Verification response exceeds 25 MiB: ${asset.id}`)
        }
        if (declared !== undefined && declared !== asset.bytes) {
          throw new Error(`Verification content length mismatch: ${asset.id}`)
        }
        const body = await readCappedBody(response, asset.id)
        if (body.length !== asset.bytes) throw new Error(`Verification size mismatch: ${asset.id}`)
        const digest = createHash('sha256').update(body).digest('hex')
        if (digest !== asset.sha256) throw new Error(`Verification hash mismatch: ${asset.id}`)
        complete = true
        break
      } catch (error) {
        const retryable = error instanceof RetryableHttpError || isNetworkError(error)
        if (!retryable || attempt === RETRY_DELAYS.length) throw error
        await sleep(RETRY_DELAYS[attempt]!)
      }
    }
    if (!complete) throw new Error(`Verification did not complete: ${asset.id}`)
    verified.push(asset.id)
  }
  return { version: 1, verified }
}

async function readCappedBody(response: Response, id: string): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_BYTES) {
        await reader.cancel()
        throw new Error(`Verification response exceeds 25 MiB: ${id}`)
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, bytes)
}

function parseContentLength(value: string | null): number | undefined {
  if (value === null) return undefined
  if (!/^\d+$/.test(value)) throw new Error('Verification content length is malformed')
  return Number(value)
}

function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof Error && error.message === 'network')
}
