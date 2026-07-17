#!/usr/bin/env node

import { Command } from 'commander'
import { readFile } from 'node:fs/promises'
import { CvmMetadataCredentialProvider } from './auth/cvm.js'
import { GitHubOidcTokenProvider, buildGitHubRoleSessionName } from './auth/github-oidc.js'
import { TencentWebIdentityCredentialProvider } from './auth/tencent-sts.js'
import type { CredentialProvider } from './auth/types.js'
import { loadLock, validateLock } from './lock.js'
import { prepareAssets } from './prepare.js'
import { publishAssets, resolveReportPath, writePublishReport, type PublishReport } from './publish.js'
import { CosObjectStore } from './storage/cos.js'
import { verifyPublishedAssets } from './verify.js'

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
  .command('publish')
  .requiredOption('--manifest <path>', 'media manifest path')
  .requiredOption('--lock <path>', 'committed media lock path')
  .requiredOption('--credentials <provider>', 'github-oidc or cvm')
  .requiredOption('--bucket <bucket>', 'COS bucket including APPID')
  .requiredOption('--region <region>', 'COS region')
  .requiredOption('--report <path>', 'workspace-relative report path')
  .action(async (options: {
    manifest: string; lock: string; credentials: string
    bucket: string; region: string; report: string
  }) => {
    await validateLock(options.manifest, options.lock)
    const lock = await loadLock(options.lock)
    const credentials = await credentialProvider(options.credentials, options.region).getCredentials()
    const store = new CosObjectStore({ bucket: options.bucket, region: options.region, credentials })
    const report = await publishAssets({ lock, manifestPath: options.manifest, store })
    await writePublishReport(process.cwd(), options.report, report)
    process.stdout.write(`uploaded ${report.uploaded.length}; skipped ${report.skipped.length}\n`)
  })

program
  .command('verify')
  .requiredOption('--lock <path>', 'committed media lock path')
  .option('--report <path>', 'publish report whose IDs should be verified')
  .option('--all', 'verify all lock entries')
  .action(async (options: { lock: string; report?: string; all?: boolean }) => {
    if (Boolean(options.report) === Boolean(options.all)) {
      throw new Error('Choose exactly one of --report or --all')
    }
    const lock = await loadLock(options.lock)
    let ids: ReadonlySet<string> | undefined
    if (options.report) {
      const path = resolveReportPath(process.cwd(), options.report)
      const report = parsePublishReport(JSON.parse(await readFile(path, 'utf8')))
      ids = new Set([...report.uploaded, ...report.skipped])
    }
    const result = await verifyPublishedAssets({ lock, ...(ids ? { ids } : {}) })
    process.stdout.write(`verified ${result.verified.length}\n`)
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

function credentialProvider(name: string, region: string): CredentialProvider {
  if (name === 'cvm') return new CvmMetadataCredentialProvider()
  if (name !== 'github-oidc') throw new Error('Unknown credential provider; use github-oidc or cvm')
  const audience = requiredEnv('MEDIA_OIDC_AUDIENCE')
  const oidc = new GitHubOidcTokenProvider({ audience })
  return new TencentWebIdentityCredentialProvider({
    providerId: requiredEnv('MEDIA_TENCENT_PROVIDER_ID'),
    roleArn: requiredEnv('MEDIA_TENCENT_ROLE_ARN'),
    region: process.env.MEDIA_TENCENT_REGION ?? region,
    roleSessionName: buildGitHubRoleSessionName(),
    webIdentityToken: () => oidc.getToken(),
  })
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value?.trim()) throw new Error(`${name} is required`)
  return value
}

function parsePublishReport(value: unknown): PublishReport {
  if (typeof value !== 'object' || value === null) throw new Error('publish report is malformed')
  const report = value as Partial<PublishReport>
  if (report.version !== 1 || !stringArray(report.uploaded) || !stringArray(report.skipped)) {
    throw new Error('publish report is malformed')
  }
  return report as PublishReport
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}
