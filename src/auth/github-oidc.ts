import type { FetchLike } from './types.js'

type Environment = Record<string, string | undefined>

type GitHubOidcOptions = {
  audience: string
  env?: Environment
  fetch?: FetchLike
}

export class GitHubOidcTokenProvider {
  readonly #audience: string
  readonly #env: Environment
  readonly #fetch: FetchLike

  constructor(options: GitHubOidcOptions) {
    if (!options.audience.trim()) throw new Error('GitHub OIDC audience is required')
    this.#audience = options.audience
    this.#env = options.env ?? process.env
    this.#fetch = options.fetch ?? globalThis.fetch
  }

  async getToken(): Promise<string> {
    const requestUrl = required(this.#env, 'ACTIONS_ID_TOKEN_REQUEST_URL')
    const requestToken = required(this.#env, 'ACTIONS_ID_TOKEN_REQUEST_TOKEN')
    const url = new URL(requestUrl)
    if (url.protocol !== 'https:') {
      throw new Error('GitHub OIDC request URL must use HTTPS')
    }
    url.searchParams.set('audience', this.#audience)

    const response = await this.#fetch(url, {
      method: 'GET',
      redirect: 'manual',
      headers: { Authorization: `Bearer ${requestToken}` },
    })
    if (response.status >= 300 && response.status < 400) {
      throw new Error(`GitHub OIDC endpoint returned forbidden redirect (${response.status})`)
    }
    if (!response.ok) {
      throw new Error(`GitHub OIDC token request failed (${response.status})`)
    }
    const body: unknown = await response.json()
    if (!isRecord(body) || typeof body.value !== 'string' || !body.value.trim()) {
      throw new Error('GitHub OIDC response did not contain a token')
    }
    return body.value
  }
}

export function buildGitHubRoleSessionName(env: Environment = process.env): string {
  const parts = [
    required(env, 'GITHUB_REPOSITORY_ID'),
    required(env, 'GITHUB_RUN_ID'),
    required(env, 'GITHUB_RUN_ATTEMPT'),
  ]
  if (parts.some((part) => !/^\d+$/.test(part))) {
    throw new Error('GitHub role session identifiers must be numeric')
  }
  const name = `media-${parts.join('-')}`
  if (name.length > 64) throw new Error('GitHub role session name exceeds 64 characters')
  return name
}

function required(env: Environment, name: string): string {
  const value = env[name]
  if (!value?.trim()) throw new Error(`${name} is required`)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
