import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const root = join(import.meta.dirname, '..')

describe('package and CI contract', () => {
  it('ships a CLI without cloud write permission in its own CI', async () => {
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    const workflowText = await readFile(join(root, '.github', 'workflows', 'ci.yml'), 'utf8')
    const workflow = parse(workflowText)

    expect(pkg.bin).toEqual({ 'media-publisher': 'dist/cli.js' })
    expect(pkg.files).toEqual(['dist', 'docs', 'README.md'])
    expect(pkg.scripts.prepare).toBe('pnpm build')
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(workflowText).not.toMatch(/id-token|SecretId|SecretKey/i)
  })
})
