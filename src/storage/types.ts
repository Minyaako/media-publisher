export type RemoteObject = {
  bytes: number
  contentType: string
  sha256?: string
}

export type PutObjectInput = {
  key: string
  body: Buffer
  filePath?: string
  contentType: 'image/webp'
  cacheControl: string
  metadata: { sha256: string }
}

export interface ObjectStore {
  head(key: string): Promise<RemoteObject | undefined>
  put(input: PutObjectInput): Promise<void>
}
