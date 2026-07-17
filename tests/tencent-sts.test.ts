import { describe, expect, it, vi } from 'vitest'
import { TencentWebIdentityCredentialProvider } from '../src/auth/tencent-sts.js'

const now = new Date('2026-07-17T07:00:00.000Z')
const expiry = Math.floor(new Date('2026-07-17T08:00:00.000Z').getTime() / 1000)

function successResponse(expiredTime = expiry) {
  return new Response(JSON.stringify({
    Response: {
      Credentials: {
        TmpSecretId: 'temporary-id',
        TmpSecretKey: 'temporary-key',
        Token: 'temporary-token',
      },
      ExpiredTime: expiredTime,
      RequestId: 'request-123',
    },
  }), { status: 200 })
}

describe('Tencent web identity credential provider', () => {
  it('exchanges an OIDC token using the documented STS request', async () => {
    const fetch = vi.fn(async () => successResponse())
    const provider = new TencentWebIdentityCredentialProvider({
      providerId: 'oidc-provider-id',
      roleArn: 'qcs::cam::uin/100000000001:roleName/media-publisher',
      region: 'ap-guangzhou',
      roleSessionName: 'media-123-456-1',
      webIdentityToken: async () => 'fixture-jwt',
      fetch,
      now: () => now,
    })

    await expect(provider.getCredentials()).resolves.toEqual({
      secretId: 'temporary-id',
      secretKey: 'temporary-key',
      token: 'temporary-token',
      expiresAt: new Date('2026-07-17T08:00:00.000Z'),
    })
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('https://sts.tencentcloudapi.com')
    expect(init).toMatchObject({
      method: 'POST',
      redirect: 'manual',
      headers: {
        Authorization: 'SKIP',
        'Content-Type': 'application/json',
        'X-TC-Action': 'AssumeRoleWithWebIdentity',
        'X-TC-Version': '2018-08-13',
        'X-TC-Region': 'ap-guangzhou',
        'X-TC-Timestamp': String(Math.floor(now.getTime() / 1000)),
      },
    })
    expect(JSON.parse(String(init?.body))).toEqual({
      ProviderId: 'oidc-provider-id',
      RoleArn: 'qcs::cam::uin/100000000001:roleName/media-publisher',
      RoleSessionName: 'media-123-456-1',
      WebIdentityToken: 'fixture-jwt',
      DurationSeconds: 3600,
    })
  })

  it('rejects credentials with less than five minutes remaining', async () => {
    const provider = new TencentWebIdentityCredentialProvider({
      providerId: 'provider', roleArn: 'role', region: 'ap-guangzhou',
      roleSessionName: 'media-1-2-1', webIdentityToken: async () => 'jwt',
      fetch: vi.fn(async () => successResponse(Math.floor(now.getTime() / 1000) + 299)),
      now: () => now,
    })
    await expect(provider.getCredentials()).rejects.toThrow(/expir/i)
  })

  it('redacts STS errors while retaining the error code and request id', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      Response: {
        Error: { Code: 'AuthFailure.InvalidAuthorization', Message: 'leaked fixture-jwt' },
        RequestId: 'request-safe',
      },
    }), { status: 200 }))
    const provider = new TencentWebIdentityCredentialProvider({
      providerId: 'provider', roleArn: 'role', region: 'ap-guangzhou',
      roleSessionName: 'media-1-2-1', webIdentityToken: async () => 'fixture-jwt',
      fetch, now: () => now,
    })

    const error = await provider.getCredentials().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(Error)
    expect(String(error)).toContain('AuthFailure.InvalidAuthorization')
    expect(String(error)).toContain('request-safe')
    expect(String(error)).not.toContain('fixture-jwt')
  })

  it('rejects malformed successful responses', async () => {
    const provider = new TencentWebIdentityCredentialProvider({
      providerId: 'provider', roleArn: 'role', region: 'ap-guangzhou',
      roleSessionName: 'media-1-2-1', webIdentityToken: async () => 'jwt',
      fetch: vi.fn(async () => new Response('{"Response":{}}', { status: 200 })),
      now: () => now,
    })
    await expect(provider.getCredentials()).rejects.toThrow(/credential|response/i)
  })
})
