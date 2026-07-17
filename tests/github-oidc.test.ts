import { describe, expect, it, vi } from 'vitest'
import {
  GitHubOidcTokenProvider,
  buildGitHubRoleSessionName,
} from '../src/auth/github-oidc.js'

const validEnv = {
  ACTIONS_ID_TOKEN_REQUEST_URL: 'https://pipelines.actions.githubusercontent.com/token?api-version=2.0',
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-secret',
  GITHUB_REPOSITORY_ID: '123456',
  GITHUB_RUN_ID: '789012',
  GITHUB_RUN_ATTEMPT: '3',
}

describe('GitHub OIDC token provider', () => {
  it('requests the fixed audience without following redirects', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ value: 'fixture-jwt' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    const provider = new GitHubOidcTokenProvider({
      audience: 'sts.tencentcloudapi.com',
      env: validEnv,
      fetch,
    })

    await expect(provider.getToken()).resolves.toBe('fixture-jwt')
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0]!
    expect(new URL(String(url)).searchParams.get('audience')).toBe('sts.tencentcloudapi.com')
    expect(init).toMatchObject({
      method: 'GET',
      redirect: 'manual',
      headers: { Authorization: 'Bearer request-secret' },
    })
  })

  it.each([
    ['missing request URL', { ...validEnv, ACTIONS_ID_TOKEN_REQUEST_URL: '' }],
    ['missing request token', { ...validEnv, ACTIONS_ID_TOKEN_REQUEST_TOKEN: '' }],
    ['insecure request URL', { ...validEnv, ACTIONS_ID_TOKEN_REQUEST_URL: 'http://example.com/token' }],
  ])('rejects %s', async (_name, env) => {
    const provider = new GitHubOidcTokenProvider({
      audience: 'sts.tencentcloudapi.com',
      env,
      fetch: vi.fn(),
    })
    await expect(provider.getToken()).rejects.toThrow()
  })

  it('rejects redirects and malformed token responses', async () => {
    const redirecting = new GitHubOidcTokenProvider({
      audience: 'sts.tencentcloudapi.com',
      env: validEnv,
      fetch: vi.fn(async () => new Response(null, { status: 302 })),
    })
    const malformed = new GitHubOidcTokenProvider({
      audience: 'sts.tencentcloudapi.com',
      env: validEnv,
      fetch: vi.fn(async () => new Response('{}', { status: 200 })),
    })

    await expect(redirecting.getToken()).rejects.toThrow(/redirect|302/i)
    await expect(malformed.getToken()).rejects.toThrow(/token/i)
  })
})

describe('GitHub role session name', () => {
  it('is deterministic and contains only numeric GitHub identifiers', () => {
    expect(buildGitHubRoleSessionName(validEnv)).toBe('media-123456-789012-3')
  })

  it('rejects non-numeric identifiers and names over 64 characters', () => {
    expect(() => buildGitHubRoleSessionName({ ...validEnv, GITHUB_RUN_ID: 'run-1' })).toThrow()
    expect(() => buildGitHubRoleSessionName({
      ...validEnv,
      GITHUB_REPOSITORY_ID: '1'.repeat(30),
      GITHUB_RUN_ID: '2'.repeat(30),
      GITHUB_RUN_ATTEMPT: '333',
    })).toThrow(/64/)
  })
})
