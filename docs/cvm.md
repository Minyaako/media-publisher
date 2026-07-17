# CVM temporary credentials

The CVM adapter is for a future controlled host-side publisher. It reads the attached CAM role name and temporary credentials from the fixed Tencent metadata endpoint:

```text
http://metadata.tencentyun.com/latest/meta-data/cam/security-credentials/
```

Requests have a two-second timeout, do not follow redirects, and accept only a conservative ASCII role name. Credentials with five minutes or less remaining are rejected. No static secret environment variables are read.

Metadata access is powerful: any process able to reach it may obtain the instance role. Ordinary application containers must not call metadata directly. Run a narrowly controlled host publisher instead, with network and process boundaries that prevent unrelated containers from reaching metadata. Attach only the same `blog/*` write role described in the CAM template.

The host path uses the same manifest, lock, immutable conflict rules, and public verification as GitHub OIDC. This keeps the publishing workflow portable if an application later stops using GitHub while avoiding a permanent-key migration.
