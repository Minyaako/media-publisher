# Tencent CAM least-privilege template

Collect deployment-specific values interactively; do not commit the resulting identifiers:

```powershell
$CosRegion = Read-Host 'COS region, for example ap-guangzhou'
$CosAppId = Read-Host 'COS APPID, also present as the Bucket name suffix'
$CosBucket = Read-Host 'COS bucket name including APPID'
```

Generate the policy from those named inputs. The interpolated object resource remains bounded to `blog/*`:

```powershell
$Policy = @{
  version = '2.0'
  statement = @(@{
    effect = 'allow'
    action = @(
      'name/cos:HeadObject'
      'name/cos:PutObject'
      'name/cos:InitiateMultipartUpload'
      'name/cos:ListMultipartUploads'
      'name/cos:ListParts'
      'name/cos:UploadPart'
      'name/cos:CompleteMultipartUpload'
      'name/cos:AbortMultipartUpload'
    )
    resource = @("qcs::cos:${CosRegion}:uid/${CosAppId}:${CosBucket}/blog/*")
  })
}
$PolicyJson = $Policy | ConvertTo-Json -Depth 6
```

For COS resources, `uid/` contains the account APPID, not the account UIN.
For example, Bucket `minyako-media-1451980311` uses `uid/1451980311`.
The role ARN is a separate CAM identifier and continues to use the account UIN.

Do not grant bucket configuration, ACL mutation, object deletion, prefix-wide listing, or access outside `blog/*`. Configure the separate web-identity trust relationship using the exact issuer, audience, and production subject in `github-oidc.md`. Test both expected allows and explicit denies with the CAM policy simulator before enabling the workflow.
