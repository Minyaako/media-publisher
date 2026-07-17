import {
  assertUsableCredentials,
  type CredentialProvider,
  type FetchLike,
  type TemporaryCredentials,
} from './types.js'

const STS_ENDPOINT = 'https://sts.tencentcloudapi.com'

type TencentWebIdentityOptions = {
  providerId: string
  roleArn: string
  region: string
  roleSessionName: string
  webIdentityToken: () => Promise<string>
  fetch?: FetchLike
  now?: () => Date
}

export class TencentWebIdentityCredentialProvider implements CredentialProvider {
  readonly #options: TencentWebIdentityOptions
  readonly #fetch: FetchLike
  readonly #now: () => Date

  constructor(options: TencentWebIdentityOptions) {
    this.#options = options
    this.#fetch = options.fetch ?? globalThis.fetch
    this.#now = options.now ?? (() => new Date())
  }

  async getCredentials(): Promise<TemporaryCredentials> {
    const webIdentityToken = await this.#options.webIdentityToken()
    if (!webIdentityToken.trim()) throw new Error('Web identity token is empty')

    const response = await this.#fetch(STS_ENDPOINT, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        Authorization: 'SKIP',
        'Content-Type': 'application/json',
        'X-TC-Action': 'AssumeRoleWithWebIdentity',
        'X-TC-Version': '2018-08-13',
        'X-TC-Region': this.#options.region,
      },
      body: JSON.stringify({
        ProviderId: this.#options.providerId,
        RoleArn: this.#options.roleArn,
        RoleSessionName: this.#options.roleSessionName,
        WebIdentityToken: webIdentityToken,
        DurationSeconds: 3600,
      }),
    })
    if (response.status >= 300 && response.status < 400) {
      throw new Error(`Tencent STS returned forbidden redirect (${response.status})`)
    }

    const body = await readJson(response)
    const root = record(body, 'Tencent STS response')
    const result = record(root.Response, 'Tencent STS Response')
    if (isRecord(result.Error)) {
      const code = stringValue(result.Error.Code) ?? 'UnknownError'
      const requestId = stringValue(result.RequestId) ?? 'unknown'
      throw new Error(`Tencent STS failed: ${code} (RequestId: ${requestId})`)
    }
    if (!response.ok) {
      throw new Error(`Tencent STS request failed (${response.status})`)
    }

    const raw = record(result.Credentials, 'Tencent STS credentials')
    const credentials: TemporaryCredentials = {
      secretId: requiredString(raw.TmpSecretId, 'TmpSecretId'),
      secretKey: requiredString(raw.TmpSecretKey, 'TmpSecretKey'),
      token: requiredString(raw.Token, 'Token'),
      expiresAt: unixDate(result.ExpiredTime, 'ExpiredTime'),
    }
    return assertUsableCredentials(credentials, this.#now())
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new Error(`Tencent STS returned an invalid response (${response.status})`)
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} is malformed`)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function requiredString(value: unknown, label: string): string {
  const parsed = stringValue(value)
  if (!parsed) throw new Error(`Tencent STS credential ${label} is malformed`)
  return parsed
}

function unixDate(value: unknown, label: string): Date {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`Tencent STS ${label} is malformed`)
  }
  return new Date(value * 1000)
}
