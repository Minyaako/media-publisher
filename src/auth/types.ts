export type TemporaryCredentials = {
  secretId: string
  secretKey: string
  token: string
  expiresAt: Date
}

export interface CredentialProvider {
  getCredentials(): Promise<TemporaryCredentials>
}

export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>

export function assertUsableCredentials(
  credentials: TemporaryCredentials,
  now: Date = new Date(),
): TemporaryCredentials {
  if (
    !credentials.secretId.trim()
    || !credentials.secretKey.trim()
    || !credentials.token.trim()
  ) {
    throw new Error('Temporary credential response contains an empty field')
  }
  if (
    Number.isNaN(credentials.expiresAt.getTime())
    || credentials.expiresAt.getTime() <= now.getTime() + 5 * 60 * 1000
  ) {
    throw new Error('Temporary credentials expire within five minutes')
  }
  return credentials
}
