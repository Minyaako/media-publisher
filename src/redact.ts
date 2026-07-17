const SENSITIVE_KEY = /authorization|secret|token|credential|password|cookie/i

export function redactError(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: 'Operation failed; sensitive details were redacted' }
  }
  if (Array.isArray(value)) return value.map(redactError)
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactError(item),
    ]))
  }
  return value
}
