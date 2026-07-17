# Minyako Media Publisher

Generic media processing and object-storage publishing tools for Minyako applications.

This public repository contains no business images, production identifiers, or credentials. Consumer applications own their manifests and media derivatives and pin this package by a full Git commit SHA.

## What it does

`media-publisher` turns private source images into deterministic WebP derivatives, creates a content-addressed lock, publishes missing immutable objects to Tencent COS with temporary credentials, and verifies the public EdgeOne response byte-for-byte.

```text
media-publisher prepare  --manifest media/media.yaml --lock media/media.lock.json [--source-root <private-root>]
media-publisher validate --manifest media/media.yaml --lock media/media.lock.json
media-publisher publish  --manifest media/media.yaml --lock media/media.lock.json --credentials github-oidc|cvm --bucket <bucket> --region <region> --report .media-publish-report.json
media-publisher verify   --lock media/media.lock.json --report .media-publish-report.json
media-publisher verify   --lock media/media.lock.json --all
```

Consumers should pin a reviewed full 40-character commit SHA. GitHub Actions consumers grant `id-token: write` in their own production job; this repository's CI intentionally cannot request an identity token.

## Safety model

- Only WebP derivatives up to 25 MiB are accepted.
- Object keys contain the complete SHA-256 and are never overwritten or deleted automatically.
- Existing objects are skipped only when size, MIME, and SHA-256 metadata match exactly.
- EdgeOne verification forbids redirects and validates HTTPS, MIME, length, and full SHA-256.
- GitHub OIDC and CVM metadata yield temporary credentials; permanent key providers do not exist.
- Source images and delivery derivatives share one private COS bucket under isolated prefixes. Local server copies are recovery backups, not the authority.

See the [shared media platform specification](docs/shared-media-spec.zh-CN.md), [manifest and CLI contracts](docs/manifest.md), [GitHub OIDC](docs/github-oidc.md), [CVM usage](docs/cvm.md), and the [CAM policy template](docs/tencent-cam-policy.md).
