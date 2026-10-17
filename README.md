# 看剧AI 视频源（TVBox / FongMi / 影视TV）

面向 [kanju.ai](https://kanju.ai)（同源域名 `kanju3.com`）的多实现视频源仓库，提供 **Python / JS / Java** 三个版本，
按客户端能力任选其一。三个版本共用同一套接口与签名方案，功能对齐：分类、筛选、搜索、详情、多线路播放。

> 本仓库只包含客户端源代码与配置，不存储、不转码、不分发任何媒体文件。

## 目录结构

```
source/
├─ README.md
├─ python/                 FongMi / 影视TV（type 3 · Python，Chaquopy）
│  ├─ kanju3.py            源本体：分类/筛选/搜索/详情/剧集/多线路
│  └─ kanju3.json          配置（api 为 ./kanju3.py）
├─ js/                     drpy2（TVBox 系，JS spider）
│  ├─ kanju.js             源本体（rule 对象）
│  └─ kanju.json           配置（ext 指向 ./js/kanju.js）
└─ java/                   CatVodSpider（TVBox，JAR）
   ├─ spider.jar           包含 csp_Kanju
   ├─ spider.jar.md5       与 jar 对齐的校验值
   └─ kanju_jar.json       配置（spider 指向 ./java/spider.jar）
```

## 快速开始

三个配置都是「填进 App 的配置地址」即可，二选一镜像：GitHub Raw / jsDelivr。

### 1. Python 版（推荐：影视TV / FongMi TV / OKTV）

适用：带 **Chaquopy（Python）** 运行时的 FongMi 内核客户端。

```
https://raw.githubusercontent.com/z2004y/source/main/python/kanju3.json
https://cdn.jsdelivr.net/gh/z2004y/source@main/python/kanju3.json
```

- 安装：`设置 → 点播 → 粘贴地址 → 确定 → 回首页选「看剧AI(kanju3)」`
- 特性：签名密钥**运行时从站点 bundle 提取**（不写死）；有 `self.net` 走 App 网络，没有则降级标准库；
  播放直链优先、`resolve://` 二次解析、最多回退 5 条线路；401 自动建匿名会话重试。

可选参数（改配置里的 `ext`）：

| 字段 | 说明 |
|---|---|
| `host` | 站点根地址，默认 `https://kanju3.com`；可换镜像 `kanju1.com` / `kanju4.com` / `kanju9.com` |
| `line` | 强制线路名片段（如 `1080P`、`无水印`）；留空 = 站点默认线路 |

### 2. JS 版（TVBox 系，drpy2）

适用：支持 **drpy2** 的 TVBox 衍生客户端（影视仓 / OK影视 / 部分 TVBoxOS）。

```
https://raw.githubusercontent.com/z2004y/source/main/js/kanju.json
https://cdn.jsdelivr.net/gh/z2004y/source@main/js/kanju.json
```

- 依赖外部 drpy2 运行时（配置里的 `spider` 指向公开 drpy2，已走 gh-proxy 加速）；
- 若你的 App 已内置 drpy2，可删除配置中的 `spider` 字段。

### 3. Java 版（TVBox，JAR）

适用：原生 TVBox / CatVodSpider 兼容客户端（不需要 drpy2、不需要 Python）。

```
https://raw.githubusercontent.com/z2004y/source/main/java/kanju_jar.json
https://cdn.jsdelivr.net/gh/z2004y/source@main/java/kanju_jar.json
```

- 入口类 `com.github.catvod.spider.Kanju`，配置 `api` 为 `csp_Kanju`；
- `spider.jar.md5` 与 jar 对齐，便于客户端做版本校验。

## 三版对比

| 维度 | Python | JS（drpy2） | Java（JAR） |
|---|---|---|---|
| 适用客户端 | FongMi 内核（影视TV / OKTV 等） | TVBox + drpy2 | TVBox / CatVodSpider |
| 额外依赖 | Chaquopy 运行时 | drpy2.js | 无（jar 自带） |
| 签名密钥 | 运行时提取（自动跟随站点） | 内置常量（需随站点更新） | 内置常量（需随站点更新） |
| 热更新 | 改服务器文件即生效 | 改服务器文件即生效 | 需替换 jar |
| 配置 | `python/kanju3.json` | `js/kanju.json` | `java/kanju_jar.json` |

## 接口与签名

```
分类/搜索  GET  /v1/browse/catalog?page=&limit=&kind=&year=&area=&q=
详情       GET  /v1/catalog/{id}/detail
剧集       GET  /v1/catalog/{id}/episodes?limit=48&offset=0
线路       GET  /v1/playback/resolve/{episode_token}?view=compact
最终地址   POST /v1/playback/resolve-line  {"ticket":"<public_id>"}
```

站点强制客户端签名（三个版本实现一致）：

```
canonical = "{METHOD}\n{path?query}\n{timestamp_ms}\n{nonce_hex32}"
signature = HMAC-SHA256(key, canonical).hex()
```

必需请求头：`x-ai-movie-timestamp` / `-nonce` / `-signature` / `-client-name` / `-client-version` / `-build-version` / `-protocol-version`。

## 验证记录

| 项 | 方法 | 结果 |
|---|---|---|
| 三个配置可访问 | HTTP GET | 200 |
| Python 源码 | 静态校验 + 真实响应回放 + 真实网络跑通 | 通过（分类/详情/剧集/播放地址） |
| Python 真机 | Android 14 + OKTV 5.2.1，`/media` 判定 | `state=3`，进度正常前进 |
| JS 源码 | `node --check` + 签名与 Node crypto 对照 + 真实 API 请求 | 通过（`/v1/browse/catalog` 200，返回 3 条） |
| Java 包 | zip 完整性 + 入口类 + 继承关系 + md5 对齐 | 通过（`csp_Kanju` 存在，继承 `crawler.Spider`） |
| Java 运行 | 需 Android 运行时（okhttp 等），未在桌面 JVM 验证 | 待 App 内验证 |

## 维护

- 站点更换签名协议时：Python 版改 `python/kanju3.py` 的 `_api()`（canonical）与 `_fetch_signing()`（密钥正则）；
  JS/Java 版需同步更新 `SIGN_KEY` 与 `x-ai-movie-build-version` 等常量。
- 新增/替换 jar 后务必更新 `java/spider.jar.md5`。
- 本地自测：把配置里的地址换成本机 `http://<IP>:8000/...`，或直接用 `python tools/record_responses.py` 录响应回放。

## 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 站点不出现 | 配置地址打不开 / JSON 错 | 用手机浏览器直接访问配置地址 |
| 分类空白 | 客户端不支持该版本（如无 Python 运行时） | 换对应版本（Java/JS）或换客户端 |
| 分类有、列表空 | 站点网络不通 / 镜像失效 | 换 `ext.host` 镜像；或换网络测试 |
| 选集黑屏 | 线路失效 / 播放地址过期 | 源已做线路回退；仍失败可指定 `ext.line` |
| Java 版不生效 | jar 与配置路径不一致 | 确认 `spider` 指向 `java/spider.jar` |

## 免责

代码仅用于个人学习与自建源调试。内容版权归原站点与权利人所有，本仓库不存储、不转码、不分发任何媒体文件。
