# Media Publisher Agent Guide

- Keep this repository generic: business images and consumer-specific live configuration belong in consumer repositories.
- Never commit permanent cloud keys, OIDC tokens, temporary credentials, or complete environment dumps.
- Add behavior through a failing test first and run the focused test before the full verification suite.
- Media objects are immutable. Do not add automatic overwrite, deletion, or garbage collection behavior.
- Keep consumer-specific manifests, Bucket names, role identifiers, and deployment policy in the consumer repository.
