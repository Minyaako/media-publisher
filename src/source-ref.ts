import { realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve } from 'node:path'

const supportedExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp'])

const assertInside = (root: string, candidate: string) => {
  const fromRoot = relative(root, candidate)
  if (fromRoot === '' || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new Error('source reference escapes source root')
  }
}

export async function resolveSourceRef(sourceRef: string, sourceRoot: string) {
  if (!sourceRef.startsWith('shared://')) {
    throw new Error('source reference must use shared://')
  }

  const relativeSource = sourceRef.slice('shared://'.length)
  if (
    relativeSource.length === 0
    || relativeSource.includes('\\')
    || relativeSource.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error('source reference escapes source root')
  }

  const root = await realpath(sourceRoot)
  const unresolved = resolve(root, relativeSource)
  assertInside(root, unresolved)
  const candidate = await realpath(unresolved)
  assertInside(root, candidate)

  const info = await stat(candidate)
  if (!info.isFile()) {
    throw new Error('source reference must resolve to a regular file')
  }
  if (!supportedExtensions.has(extname(candidate).toLowerCase())) {
    throw new Error('source reference must be PNG, JPEG, or WebP')
  }

  return candidate
}
