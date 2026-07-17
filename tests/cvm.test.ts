import { describe, expect, it, vi } from 'vitest'
import { CvmMetadataCredentialProvider } from '../src/auth/cvm.js'

const now = new Date('2026-07-17T07:00:00.000Z')
const baseUrl = 'http://127.0.0.1/latest/meta-data/cam/security-credentials/'

function metadataCredentials(expiredTime = Math.floor(now.getTime() / 1000) + 3600) {
  return JSON.stringify({
    Code: 'Success',
    TmpSecretId: 'cvm-id',
    TmpSecretKey: 'cvm-key',
    Token: 'cvm-token',
    ExpiredTime: expiredTime,
  })
}

describe('CVM metadata credential provider', () => {
  it('discovers the role and obtains temporary credentials from fixed metadata paths', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('media-publisher-role', { status: 200 }))
      .mockResolvedValueOnce(new Response(metadataCredentials(), { status: 200 }))
    const provider = new CvmMetadataCredentialProvider({ baseUrl, fetch, now: () => now })

    await expect(provider.getCredentials()).resolves.toEqual({
      secretId: 'cvm-id',
      secretKey: 'cvm-key',
      token: 'cvm-token',
      expiresAt: new Date('2026-07-17T08:00:00.000Z'),
    })
    expect(fetch).toHaveBeenNthCalledWith(1, baseUrl, expect.objectContaining({
      method: 'GET', redirect: 'manual', signal: expect.any(AbortSignal),
    }))
    expect(fetch).toHaveBeenNthCalledWith(2, `${baseUrl}media-publisher-role`, expect.objectContaining({
      method: 'GET', redirect: 'manual', signal: expect.any(AbortSignal),
    }))
  })

  it('rejects arbitrary metadata base hosts', () => {
    expect(() => new CvmMetadataCredentialProvider({
      baseUrl: 'http://evil.example/latest/meta-data/cam/security-credentials/',
      fetch: vi.fn(), now: () => now,
    })).toThrow(/host|metadata/i)
  })

  it.each(['../admin', 'role/name', ' role', '角色'])('rejects unsafe role name %s', async (role) => {
    const provider = new CvmMetadataCredentialProvider({
      baseUrl,
      fetch: vi.fn(async () => new Response(role, { status: 200 })),
      now: () => now,
    })
    await expect(provider.getCredentials()).rejects.toThrow(/role/i)
  })

  it('rejects redirects and near-expiry credentials', async () => {
    const redirecting = new CvmMetadataCredentialProvider({
      baseUrl,
      fetch: vi.fn(async () => new Response(null, { status: 302 })),
      now: () => now,
    })
    await expect(redirecting.getCredentials()).rejects.toThrow(/redirect|302/i)

    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('role', { status: 200 }))
      .mockResolvedValueOnce(new Response(metadataCredentials(Math.floor(now.getTime() / 1000) + 299), { status: 200 }))
    const expiring = new CvmMetadataCredentialProvider({ baseUrl, fetch, now: () => now })
    await expect(expiring.getCredentials()).rejects.toThrow(/expir/i)
  })
})
