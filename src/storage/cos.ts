import COS from 'cos-nodejs-sdk-v5'
import type { TemporaryCredentials } from '../auth/types.js'
import type { ObjectStore, PutObjectInput, RemoteObject } from './types.js'

const MULTIPART_THRESHOLD = 20 * 1024 * 1024

type CosObjectStoreOptions = {
  bucket: string
  region: string
  credentials: TemporaryCredentials
}

export class CosObjectStore implements ObjectStore {
  readonly #bucket: string
  readonly #region: string
  readonly #client: COS

  constructor(options: CosObjectStoreOptions) {
    this.#bucket = options.bucket
    this.#region = options.region
    this.#client = new COS({
      SecretId: options.credentials.secretId,
      SecretKey: options.credentials.secretKey,
      SecurityToken: options.credentials.token,
    })
  }

  async head(key: string): Promise<RemoteObject | undefined> {
    try {
      const result = await this.#client.headObject({
        Bucket: this.#bucket, Region: this.#region, Key: key,
      })
      const headers = lowerCaseHeaders(result.headers ?? {})
      const bytes = Number(headers['content-length'])
      if (!Number.isSafeInteger(bytes) || bytes < 0) {
        throw new Error(`COS HEAD returned malformed content length (RequestId: ${result.RequestId ?? 'unknown'})`)
      }
      return {
        bytes,
        contentType: headers['content-type'] ?? '',
        ...(headers['x-cos-meta-sha256'] ? { sha256: headers['x-cos-meta-sha256'] } : {}),
      }
    } catch (error) {
      if (statusCode(error) === 404) return undefined
      throw safeCosError('COS HEAD failed', error)
    }
  }

  async put(input: PutObjectInput): Promise<void> {
    const common = {
      Bucket: this.#bucket,
      Region: this.#region,
      Key: input.key,
      ContentType: input.contentType,
      CacheControl: input.cacheControl,
      'x-cos-meta-sha256': input.metadata.sha256,
    }
    try {
      if (input.body.length > MULTIPART_THRESHOLD) {
        if (!input.filePath) throw new Error('Multipart COS upload requires a verified local file path')
        await this.#client.sliceUploadFile({ ...common, FilePath: input.filePath })
      } else {
        await this.#client.putObject({ ...common, Body: input.body, ContentLength: input.body.length })
      }
    } catch (error) {
      throw safeCosError('COS PUT failed', error)
    }
  }
}

function lowerCaseHeaders(headers: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).flatMap(([key, value]) =>
    typeof value === 'string' || typeof value === 'number'
      ? [[key.toLowerCase(), String(value)]]
      : [],
  ))
}

function statusCode(error: unknown): number | undefined {
  return isRecord(error) && typeof error.statusCode === 'number' ? error.statusCode : undefined
}

function safeCosError(prefix: string, error: unknown): Error {
  const requestId = isRecord(error) && typeof error.RequestId === 'string' ? error.RequestId : 'unknown'
  const code = isRecord(error) && typeof error.code === 'string' ? error.code : 'UnknownError'
  return new Error(`${prefix}: ${code} (RequestId: ${requestId})`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
