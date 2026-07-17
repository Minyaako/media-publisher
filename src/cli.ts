#!/usr/bin/env node

import { Command } from 'commander'
import { validateLock } from './lock.js'
import { prepareAssets } from './prepare.js'

const program = new Command()
  .name('media-publisher')
  .description('Validate, prepare, and publish immutable media assets')
  .showHelpAfterError()

program
  .command('prepare')
  .requiredOption('--manifest <path>', 'media manifest path')
  .requiredOption('--lock <path>', 'output media lock path')
  .option('--source-root <path>', 'private shared source-image root')
  .action(async (options: { manifest: string; lock: string; sourceRoot?: string }) => {
    const result = await prepareAssets({
      manifestPath: options.manifest,
      lockPath: options.lock,
      ...(options.sourceRoot ? { sourceRoot: options.sourceRoot } : {}),
    })
    process.stdout.write(
      `prepared ${result.generated.length}; skipped ${result.skipped.length}\n`,
    )
  })

program
  .command('validate')
  .requiredOption('--manifest <path>', 'media manifest path')
  .requiredOption('--lock <path>', 'committed media lock path')
  .action(async (options: { manifest: string; lock: string }) => {
    await validateLock(options.manifest, options.lock)
    process.stdout.write('media manifest and lock are valid\n')
  })

try {
  await program.parseAsync(process.argv)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  if (process.env.MEDIA_PUBLISHER_DEBUG === 'true' && error instanceof Error) {
    process.stderr.write(`${error.stack ?? ''}\n`)
  }
  process.exitCode = 1
}
