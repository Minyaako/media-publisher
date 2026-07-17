import { describe, expect, it } from 'vitest'
import { redactError } from '../src/redact.js'

describe('redactError', () => {
  it('removes credential, authorization, token, and secret values recursively', () => {
    const redacted = redactError({
      message: 'upload failed',
      Authorization: 'Bearer fixture-jwt',
      SecretId: 'id',
      nested: { SecurityToken: 'token', safe: 'request-123' },
    })
    expect(JSON.stringify(redacted)).toBe(
      '{"message":"upload failed","Authorization":"[REDACTED]","SecretId":"[REDACTED]","nested":{"SecurityToken":"[REDACTED]","safe":"request-123"}}',
    )
  })

  it('produces a safe Error and never echoes its original secret-bearing message', () => {
    const error = redactError(new Error('Bearer fixture-jwt'))
    expect(error).toEqual({ name: 'Error', message: 'Operation failed; sensitive details were redacted' })
    expect(JSON.stringify(error)).not.toContain('fixture-jwt')
  })
})
