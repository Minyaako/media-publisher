export const PUBLISHER_VERSION = '0.1.0'
export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable' as const

export type ImportedTransform = { mode: 'imported' }

export type RecipeTransform = {
  mode: 'recipe'
  engine: 'sharp'
  engineVersion: string
  width: number
  height: number
  fit: 'cover' | 'inside'
  focalPoint: readonly [number, number]
  rotate: 0 | 90 | 180 | 270
  quality: number
}

export type MediaAsset = {
  id: string
  file: string
  objectBase: string
  sourceRef: string
  rights: string
  transform: ImportedTransform | RecipeTransform
}

export type MediaManifest = {
  version: 1
  namespace: string
  cdnBaseUrl: string
  assets: MediaAsset[]
}

export type LockedAsset = {
  id: string
  file: string
  sha256: string
  bytes: number
  contentType: 'image/webp'
  width: number
  height: number
  objectKey: string
  url: string
  cacheControl: typeof IMMUTABLE_CACHE_CONTROL
  sourceRef: string
  rights: string
  sourceSha256?: string
  recipeSha256?: string
}

export type MediaLock = {
  version: 1
  publisherVersion: string
  namespace: string
  cdnBaseUrl: string
  assets: LockedAsset[]
}
