import {
  assertUsableCredentials,
  type CredentialProvider,
  type FetchLike,
  type TemporaryCredentials,
} from './types.js'

const DEFAULT_BASE_URL = 'http://metadata.tencentyun.com/latest/meta-data/cam/security-credentials/'
const ROLE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/

type CvmMetadataOptions = {
  baseUrl?: string
  fetch?: FetchLike
  now?: () => Date
}

export class CvmMetadataCredentialProvider implements CredentialProvider {
  readonly #baseUrl: URL
  readonly #fetch: FetchLike
  readonly #now: () => Date

  constructor(options: CvmMetadataOptions = {}) {
    const rawBase = options.baseUrl ?? DEFAULT_BASE_URL
    this.#baseUrl = validateBaseUrl(rawBase)
    this.#fetch = options.fetch ?? globalThis.fetch
    this.#now = options.now ?? (() => new Date())
  }

  async getCredentials(): Promise<TemporaryCredentials> {
    const roleResponse = await this.#request(this.#baseUrl)
    const rawRole = await roleResponse.text()
    const role = rawRole.trim()
    if (rawRole !== role || !ROLE_PATTERN.test(role)) {
      throw new Error('CVM metadata returned an unsafe role name')
    }

    const credentialsUrl = new URL(encodeURIComponent(role), this.#baseUrl)
    const response = await this.#request(credentialsUrl)
    let raw: unknown
    try {
      raw = await response.json()
    } catch {
      throw new Error('CVM metadata credential response is malformed')
    }
    if (!isRecord(raw) || raw.Code !== 'Success') {
      throw new Error('CVM metadata credential request did not succeed')
    }
    const credentials: TemporaryCredentials = {
      secretId: requiredString(raw.TmpSecretId, 'TmpSecretId'),
      secretKey: requiredString(raw.TmpSecretKey, 'TmpSecretKey'),
      token: requiredString(raw.Token, 'Token'),
      expiresAt: unixDate(raw.ExpiredTime),
    }
    return assertUsableCredentials(credentials, this.#now())
  }

  async #request(url: URL): Promise<Response> {
    const response = await this.#fetch(url.toString(), {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(2_000),
    })
    if (response.status >= 300 && response.status < 400) {
      throw new Error(`CVM metadata returned forbidden redirect (${response.status})`)
    }
    if (!response.ok) {
      throw new Error(`CVM metadata request failed (${response.status})`)
    }
    return response
  }
}

function validateBaseUrl(raw: string): URL {
  const url = new URL(raw)
  const isTencentMetadata = url.protocol === 'http:' && url.hostname === 'metadata.tencentyun.com'
  const isLoopbackTest = url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
  if (!isTencentMetadata && !isLoopbackTest) {
    throw new Error('CVM metadata base host is not allowed')
  }
  if (url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/')) {
    throw new Error('CVM metadata base URL is malformed')
  }
  if (isTencentMetadata && url.toString() !== DEFAULT_BASE_URL) {
    throw new Error('CVM metadata path must use the fixed Tencent endpoint')
  }
  return url
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`CVM metadata credential ${label} is malformed`)
  }
  return value
}

function unixDate(value: unknown): Date {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error('CVM metadata credential ExpiredTime is malformed')
  }
  return new Date(value * 1000)
}
