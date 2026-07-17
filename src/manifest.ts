import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'
import { z } from 'zod'
import type { MediaManifest } from './domain.js'

const idSchema = z.string().regex(
  /^[a-z0-9][a-z0-9-]*$/,
  'Expected a lowercase stable id',
)

const relativePathSchema = z.string().superRefine((value, context) => {
  const segments = value.split('/')
  const invalid =
    value.length === 0
    || value.startsWith('/')
    || /^[A-Za-z]:/.test(value)
    || value.includes('\\')
    || value.includes('?')
    || value.includes('#')
    || segments.some((segment) => segment === '' || segment === '.' || segment === '..')

  if (invalid) {
    context.addIssue({ code: 'custom', message: 'Expected a normalized relative path' })
  }
})

const fileSchema = relativePathSchema.refine(
  (value) => value.endsWith('.webp'),
  'Derivative file must use the .webp extension',
)

const objectBaseSchema = relativePathSchema.refine(
  (value) => /^[a-z0-9][a-z0-9/_-]*[a-z0-9]$/.test(value),
  'Expected a lowercase object base',
)

const sourceRefSchema = z.string().superRefine((value, context) => {
  if (!value.startsWith('shared://')) {
    context.addIssue({ code: 'custom', message: 'Expected a shared:// source reference' })
    return
  }

  const relative = value.slice('shared://'.length)
  const segments = relative.split('/')
  if (
    relative.length === 0
    || relative.includes('\\')
    || relative.includes('?')
    || relative.includes('#')
    || segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    context.addIssue({ code: 'custom', message: 'Expected a normalized shared source reference' })
  }
})

const importedTransformSchema = z.object({
  mode: z.literal('imported'),
}).strict()

const recipeTransformSchema = z.object({
  mode: z.literal('recipe'),
  engine: z.literal('sharp'),
  engineVersion: z.string().min(1),
  width: z.int().positive(),
  height: z.int().positive(),
  fit: z.enum(['cover', 'inside']),
  focalPoint: z.tuple([
    z.number().min(0).max(1),
    z.number().min(0).max(1),
  ]),
  rotate: z.union([
    z.literal(0),
    z.literal(90),
    z.literal(180),
    z.literal(270),
  ]),
  quality: z.int().min(1).max(100),
}).strict()

const assetSchema = z.object({
  id: idSchema,
  file: fileSchema,
  objectBase: objectBaseSchema,
  sourceRef: sourceRefSchema,
  rights: z.string().trim().min(1),
  transform: z.discriminatedUnion('mode', [
    importedTransformSchema,
    recipeTransformSchema,
  ]),
}).strict()

const manifestSchema = z.object({
  version: z.literal(1),
  namespace: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  cdnBaseUrl: z.url().superRefine((value, context) => {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.search || url.hash || url.pathname !== '/') {
      context.addIssue({
        code: 'custom',
        message: 'CDN base URL must be an HTTPS origin without a path, query, or fragment',
      })
    }
  }).transform((value) => value.replace(/\/$/, '')),
  assets: z.array(assetSchema).min(1),
}).strict().superRefine((manifest, context) => {
  const uniqueFields = ['id', 'file', 'objectBase'] as const

  for (const field of uniqueFields) {
    const seen = new Set<string>()
    manifest.assets.forEach((asset, index) => {
      if (seen.has(asset[field])) {
        context.addIssue({
          code: 'custom',
          path: ['assets', index, field],
          message: `Duplicate asset ${field}: ${asset[field]}`,
        })
      }
      seen.add(asset[field])
    })
  }
})

export async function loadManifest(path: string): Promise<MediaManifest> {
  const source = await readFile(path, 'utf8')
  const parsed: unknown = parse(source)
  return manifestSchema.parse(parsed) as MediaManifest
}
