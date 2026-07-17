# Manifest, lock, and CLI contract

The consumer owns `media/media.yaml`, reviewed WebP derivatives below the same directory, and the generated `media.lock.json`. IDs are stable application-facing names; URLs and object keys are generated values.

## Imported derivative

```yaml
version: 1
namespace: blog
cdnBaseUrl: https://pic.minyako.top
assets:
  - id: profile-avatar
    file: assets/profile/avatar.webp
    objectBase: site/profile/avatar
    sourceRef: shared://blog/profile/head.png
    rights: private-use
    transform:
      mode: imported
```

Imported mode checks the existing derivative and does not need the private source library.

## Recipe derivative

```yaml
- id: home-hero-01
  file: assets/home/hero-01.webp
  objectBase: site/home/hero-01
  sourceRef: shared://blog/home/1.png
  rights: private-use
  transform:
    mode: recipe
    engine: sharp
    engineVersion: 0.35.3
    width: 1920
    height: 720
    fit: cover
    focalPoint: [0.5, 0.5]
    rotate: 0
    quality: 84
```

Recipe mode requires `--source-root`. It applies EXIF orientation, the declared quarter-turn, focal crop or inside fit, sRGB normalization, metadata removal, and WebP encoding. Source references and resolved paths may not escape the source root.

## Lock

Each sorted lock entry records the logical ID, derivative path, byte length, dimensions, SHA-256, `image/webp`, immutable cache control, provenance, hash-addressed object key, and public URL. Recipe entries also record source and recipe hashes. Commit the lock and derivative together; never hand-edit the lock.

## Commands

- `prepare` creates derivatives where needed and rewrites the deterministic lock.
- `validate` reconstructs the lock from the manifest and local files and requires byte-identical JSON.
- `publish` validates first, recomputes every local hash before COS access, then uploads or exact-metadata skips. The report contains IDs only.
- `verify --report` verifies IDs from one publish report; `verify --all` verifies every lock entry through its public HTTPS URL.

All report paths are workspace-relative. Automatic deletion, garbage collection, and rollback mutation are intentionally absent. Roll back a consumer by restoring its previous immutable lock/URL; retain the old COS object.
