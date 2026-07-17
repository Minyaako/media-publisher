# Tencent CAM least-privilege template

Collect deployment-specific values interactively; do not commit the resulting identifiers:

```powershell
$CosRegion = Read-Host 'COS region, for example ap-guangzhou'
$OwnerUin = Read-Host 'Tencent Cloud owner UIN'
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
      'name/cos:UploadPart'
      'name/cos:CompleteMultipartUpload'
      'name/cos:AbortMultipartUpload'
    )
    resource = @("qcs::cos:${CosRegion}:uid/${OwnerUin}:${CosBucket}/blog/*")
  })
}
$PolicyJson = $Policy | ConvertTo-Json -Depth 6
```
```

Do not grant bucket configuration, ACL mutation, object deletion, prefix-wide listing, or access outside `blog/*`. Configure the separate web-identity trust relationship using the exact issuer, audience, and production subject in `github-oidc.md`. Test both expected allows and explicit denies with the CAM policy simulator before enabling the workflow.
