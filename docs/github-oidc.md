# GitHub Actions OIDC

The production consumer requests a GitHub OIDC token and exchanges it directly with Tencent STS. There are no repository credential secrets.

Identity contract:

- issuer: `https://token.actions.githubusercontent.com`
- audience: `sts.tencentcloudapi.com`
- production subject: `repo:Minyaako/blog:environment:production`
- role session: `media-<repository-id>-<run-id>-<attempt>`

The production job needs `permissions: { contents: read, id-token: write }` and must use the protected `production` environment. Configure these non-secret repository variables:

- `MEDIA_COS_BUCKET`
- `MEDIA_TENCENT_REGION`
- `MEDIA_TENCENT_PROVIDER_ID`
- `MEDIA_TENCENT_ROLE_ARN`
- `MEDIA_OIDC_AUDIENCE` (`sts.tencentcloudapi.com`)

The provider accepts only GitHub's HTTPS request URL, forbids redirects, and requests the configured audience explicitly. STS credentials must have more than five minutes remaining. Logs and reports must never print the OIDC JWT or temporary credential fields.

Keep the trust policy limited to the issuer, exact audience, exact production subject, and the intended repository identity claims. Pull requests and arbitrary branches must not satisfy the production subject.
