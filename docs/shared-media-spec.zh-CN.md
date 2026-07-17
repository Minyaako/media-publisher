# Minyako 共享媒体上传规范

状态：已批准的目标规范
适用范围：所有使用共享 COS Bucket、`pic.minyako.top`、`media-publisher`、媒体上传 API 或服务器图片处理器的项目
规范所有者：服务器级共享媒体平台

## 1. 目标与边界

本规范为多个独立项目提供统一的图片存储、转换、发布、验证、备份和恢复约定。各项目保持独立仓库和权限，但共享一个 COS Bucket 与 EdgeOne 媒体域名。

核心原则：

- COS 是原图与发布图的权威存储，服务器只承担无状态中间处理。
- 本地服务器保存只读恢复副本，但本地删除不向 COS 传播。
- 普通发布流程只增不删，不能覆盖不可变对象。
- 所有生产身份使用临时凭证，不提供永久密钥降级路径。
- 应用通过逻辑媒体 ID 或带完整哈希的不可变 URL 引用图片。
- 原图、暂存对象和发布图必须有明确的路径与权限隔离。

本规范不定义具体应用 UI，也不授权任何项目管理整个 Bucket。

## 2. 项目注册与命名空间

每个消费者必须登记唯一的 `projectId`：

```text
^[a-z0-9][a-z0-9-]{1,31}$
```

示例：

```text
blog
wiki
game-library
media-manager
```

项目发布权限只能覆盖：

```text
<projectId>/*
```

项目身份不能依靠请求体中的 `projectId` 决定权限。服务端必须从已认证身份解析项目，再校验请求中的项目值。

项目注册至少记录：

```yaml
projectId: blog
owners: [Minyaako]
allowedPurposes: [site-asset, post-cover, article-image]
allowedPresets: [avatar-square, hero-wide, cover-card, article-default]
maxSourceBytes: 52428800
maxDerivativeBytes: 26214400
publishPrefixes:
  - blog/site/
  - blog/posts/
  - blog/content/
```

## 3. Bucket 布局

所有项目共享一个私有读写 COS Bucket：

```text
<bucket>/
├── _incoming/<projectId>/<uploadId>       # 动态上传暂存区
├── _source/<projectId>/<sha256>.<ext>     # 权威原图
└── <projectId>/                           # EdgeOne 发布区
    ├── site/
    ├── posts/
    └── content/
```

`_incoming`、`_source`、`_system`、`_probe` 和 `_tmp` 是平台保留前缀，普通项目不得自行构造或公开引用。

Bucket 必须保持私有读写。EdgeOne 只提供项目发布路径；对 `/_incoming/*` 和 `/_source/*` 必须返回 `403` 或 `404`，且不得缓存响应。上线检查必须包含无敏感内容的公网拒绝探针。

## 4. 对象键与发布格式

发布对象键格式：

```text
<projectId>/<scope>/<logicalPath>-<完整64位sha256>.<ext>
```

示例：

```text
blog/site/home/hero-01-<sha256>.webp
blog/posts/embodied-ai-reading/cover-<sha256>.webp
wiki/content/articles/attention-map-<sha256>.webp
```

逻辑路径只能包含小写 ASCII 字母、数字、短横线和 `/`。必须拒绝空路径段、`..`、反斜杠、编码后的路径分隔符和调用方直接指定的完整对象键。

原图对象键格式：

```text
_source/<projectId>/<sourceSha256>.<originalExt>
```

暂存对象键格式：

```text
_incoming/<projectId>/<serverGeneratedUploadId>
```

发布格式首选单帧 WebP；AVIF 作为兼容扩展保留。PNG、PSD、TIFF 等源格式默认只进入 `_source`。动态上传不得接受 SVG；经代码审查的仓库 SVG 不进入普通媒体上传 API。

单个发布衍生图最大 25 MiB。实际解码格式必须与扩展名及 MIME 一致。

不可变发布对象统一包含：

```http
Content-Type: image/webp
Cache-Control: public, max-age=31536000, immutable
x-cos-meta-sha256: <完整SHA-256>
```

公开 URL 固定为：

```text
https://pic.minyako.top/<objectKey>
```

## 5. 转换配方

版本化静态素材使用 `media.yaml` 与生成的 `media.lock.json`。每项素材必须有稳定逻辑 ID、权利信息和源引用。

导入模式验证已有衍生图但不重新编码：

```yaml
transform:
  mode: imported
```

配方模式从原图确定性生成：

```yaml
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

处理顺序固定为：

1. 解码并应用 EXIF 方向。
2. 执行显式的 `0/90/180/270` 度旋转。
3. 转换至统一 sRGB 色彩空间。
4. 按 `cover` 或 `inside` 缩放，默认禁止放大。
5. `cover` 使用归一化焦点决定裁剪中心。
6. 删除 EXIF、GPS、内嵌缩略图和其他非必要元数据。
7. 使用固定引擎版本、质量和格式编码。

动态上传只能选择平台登记的转换预设，例如：

```text
avatar-square
hero-wide
article-default
article-full
cover-card
thumbnail
original-webp
```

调用方可以提交焦点与四分之一圈旋转，但不能绕过预设的尺寸、质量和输出限制。

## 6. 身份与最小权限

GitHub 项目使用 GitHub Actions OIDC 交换腾讯云 STS 临时凭证。角色信任必须精确匹配 Issuer、Audience 与仓库生产 Subject。凭证剩余有效期不足五分钟时必须拒绝使用。

非 GitHub 应用通过服务器受控发布 API。主机发布器可以使用 CVM 实例角色；普通应用容器不得直接访问元数据服务。元数据请求必须使用固定地址、两秒超时并禁止重定向。

至少拆分以下角色：

- GitHub 发布角色：只允许 HEAD、PUT 和分块上传至 `<projectId>/*`。
- 上传接收角色：只管理 `_incoming/<projectId>/*`，可删除暂存对象。
- 图片处理角色：读取 `_source/<projectId>/*`，写入 `<projectId>/*`，不得删除权威或发布对象。
- 本地备份角色：只列举、HEAD 和读取 `_source/<projectId>/*`。

所有普通角色必须拒绝其他项目、ACL、Bucket 配置和发布对象删除。OIDC JWT、临时 SecretId、SecretKey、SecurityToken 和预签名 URL 不得进入日志、报告或磁盘。

## 7. 动态上传事务

动态上传流程：

```text
创建上传会话
→ 使用五分钟短期预签名 URL 直传 _incoming
→ 服务器验证真实格式、大小和完整 SHA-256
→ 提交到 _source 内容哈希键
→ 无状态处理器生成衍生图
→ 上传不可变发布对象
→ 通过 EdgeOne 重新下载并校验
→ 发布媒体记录
→ 清理暂存与本地工作目录
```

状态机：

```text
requested → uploaded → validated → source-committed
→ processing → published → verified
```

失败进入 `failed`，并保留稳定错误代码。只有 `verified` 状态可以向业务应用返回正式媒体引用。

发布前必须 HEAD：

- 对象不存在：上传。
- 大小、MIME 与 SHA 元数据完全一致：幂等跳过。
- 同一键存在但任一元数据冲突：停止并报告不可变对象冲突。
- 禁止通过 PUT 覆盖冲突对象。

网络失败、429 和 5xx 可按 `1s、2s、4s、8s` 重试。认证失败、MIME/哈希/大小错误、路径越权和不可变冲突不得自动重试。

## 8. 上传 API 与媒体记录

首版内部 API 边界：

```text
POST /v1/uploads
POST /v1/uploads/{uploadId}/complete
GET  /v1/uploads/{uploadId}
GET  /v1/media/{mediaId}
```

API 不代理正常图片访问，不提供普通媒体覆盖或删除接口，也不公开原图下载。

创建会话必须支持 `Idempotency-Key`，并记录项目、文件声明、权利类型、用途、预设、替代文本和调用身份。服务端不能信任客户端声明，必须从 COS 暂存对象重新验证。

成功媒体记录至少包含：

- 稳定 `mediaId` 与 `projectId`；
- 原图对象键、SHA、字节数和 MIME；
- 每个衍生图的格式、预设、尺寸、SHA、字节数、对象键和 URL；
- 权利、来源、替代文本与说明；
- 创建身份、时间、验证时间和状态。

媒体数据库只保存索引和元数据，并定期导出 JSON 快照。图片字节始终由 COS 管理。

## 9. 应用引用

Git/Markdown 项目优先通过逻辑 ID 与锁文件解析静态素材：

```text
media('home-hero-01')
```

动态内容优先保存稳定媒体 ID：

```text
media:med_01...
```

不支持媒体 ID 的系统可以保存带完整 SHA 的不可变 URL。禁止保存 COS 原始域名、短期签名 URL、保留前缀 URL 或不含哈希的可覆盖 URL。

更新图片必须产生新对象键并更新引用，不刷新或覆盖旧对象。

## 10. 本地恢复备份

COS 是权威来源。本地恢复副本位于：

```text
/srv/backups/media-source/<projectId>/
```

每日从 `_source/<projectId>/*` 增量拉取并验证 SHA。COS 删除不得传播成本地删除；本地冲突只报警，不覆盖。每日生成备份清单，每月抽样恢复，每季度执行完整恢复演练。

发布衍生图默认不重复备份，因为可以从原图、配方和媒体记录重新生成。Bucket 应启用版本控制；暂不为 `_source` 配置自动删除生命周期。

旧 `/srv/shared-assets/source-images` 只作为迁移兼容入口，迁移验收后不再是权威存储。

## 11. 监控与审计

至少监控上传、格式验证、处理耗时、COS 重试、不可变冲突、EdgeOne 哈希验证、保留前缀公网探针、暂存积压、备份延迟、备份哈希与 OIDC/STS 失败。

以下情况必须告警：

- `/_source/*` 或 `/_incoming/*` 探针返回 200；
- EdgeOne 内容哈希不一致；
- 不可变对象冲突；
- 备份超过 24 小时未完成；
- 暂存对象异常积压；
- 项目尝试跨命名空间访问。

审计日志只记录时间、项目、调用身份、uploadId/mediaId、对象键、配方、结果、请求 ID 和错误代码。

## 12. 删除与垃圾回收

普通上传与发布 API 永不删除权威原图或发布对象。

未来独立管理工具必须先汇总 Git 锁文件、媒体数据库和应用引用，生成无引用候选，等待至少 30 天并二次扫描。管理员确认删除计划后，使用独立维护角色执行。永久删除历史版本需要第二次确认。

`_incoming/*` 是唯一允许自动清理的例外：上传接收服务可以删除完成的暂存对象，并由 24 小时生命周期兜底。

## 13. 故障恢复

- 处理器故障不影响已发布图片；新处理器从 COS 与媒体记录继续任务。
- EdgeOne 故障不修改对象；恢复后重新进行公开下载验证。
- 原图误删优先从 COS 历史版本恢复，其次使用本地恢复副本。
- 发布错误通过关闭项目发布闸门并恢复旧媒体 ID 或锁文件回滚。
- 恢复后的任何对象必须重新验证完整 SHA-256。

## 14. 分阶段落地

1. 发布本规范并登记项目命名空间。
2. 配置共享 Bucket 保留前缀、EdgeOne 拒绝规则、泄露探针、版本控制和项目角色。
3. 将旧共享原图库按哈希迁入 `_source`，建立本地恢复备份并完成恢复演练。
4. 实现上传 API、无状态处理器、媒体数据库与公开验证。
5. 建设图形化媒体管理器，提供上传、裁剪、权利信息、引用查询、备份状态和垃圾回收审核。

现有 `media-publisher` 是版本化静态素材路径的基础实现。尚未实现的 API、数据库、备份和管理 UI 必须遵循本规范，而不能另建不兼容的对象键、身份或删除模型。
