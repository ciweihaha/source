# -*- coding: utf-8 -*-
"""影视TV(FongMi/TV) 源 · 看剧AI (kanju.ai)

形态：type 3 · Python (Chaquopy)
接口：https://kanju.ai/v1/*（客户端 HMAC 签名）
签名：HMAC-SHA256(key, "{METHOD}\n{path?query}\n{timestamp}\n{nonce}")
      头：x-ai-movie-timestamp / -nonce / -signature + x-ai-movie-client-*

三条工程约束：
  1) 密钥不硬编码：运行时从站点 JS bundle 提取（进程内缓存）；
  2) 传输层双通道：优先 App 注入的 self.net，缺失时降级到标准库 urllib；
  3) 播放线路多级回退：线路逐个试，401 会话失效自动建匿名会话重试一次。

接口：
  GET  /v1/browse/catalog?page=&limit=&kind=&year=&area=&q=   分类 / 搜索
  GET  /v1/catalog/{id}/detail                               详情
  GET  /v1/catalog/{id}/episodes?limit=&offset=              剧集（分页）
  GET  /v1/playback/resolve/{episode_token}?view=compact     线路列表
  POST /v1/playback/resolve-line?view=compact {"ticket": id} 最终播放地址
"""

import hashlib
import hmac
import http.cookiejar
import json
import re
import secrets
import time
import urllib.error
import urllib.request
import uuid
from urllib.parse import urlencode

from base.spider import Spider as BaseSpider

DEFAULT_HOST = "https://kanju.ai"
UA = ("Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36")
PAGE_LIMIT = 20
SIGN_TTL_MS = 6 * 60 * 60 * 1000
SIGN_CACHE_KEY = "kanju_signing_v1"
HTTP_TIMEOUT = 15
MAX_LINE_TRIES = 5

KINDS = [
    ("", "全部"),
    ("movie", "电影"),
    ("series", "剧集"),
    ("short_drama", "短剧"),
    ("anime", "动漫"),
    ("variety", "综艺"),
    ("documentary", "纪录片"),
    ("sports", "体育"),
]
AREAS = ["大陆", "香港", "台湾", "日本", "韩国", "欧美"]


class Spider(BaseSpider):
    def init(self, extend=""):
        options = {}
        if isinstance(extend, dict):
            options = extend
        elif extend:
            try:
                options = json.loads(extend)
            except Exception:
                options = {}
        self.host = str(options.get("host") or DEFAULT_HOST).rstrip("/")
        self.line_pref = str(options.get("line") or "").strip()
        self._sign = None
        self._jar = http.cookiejar.CookieJar()
        self._opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self._jar)
        )
        self._session_ready = False

    def getName(self):
        return "看剧AI"

    # ───────────────────────────────── 传输层

    def _cookie_header(self):
        pairs = []
        try:
            for cookie in self._jar:
                pairs.append("%s=%s" % (cookie.name, cookie.value))
        except Exception:
            pass
        return "; ".join(pairs)

    def _http(self, url, headers=None, method="GET", body=None,
              timeout=HTTP_TIMEOUT, force_stdlib=False):
        """返回 (code, text)。有 self.net 用它；否则用 urllib（带 CookieJar）。"""
        headers = dict(headers or {})
        if not any(k.lower() == "user-agent" for k in headers):
            headers["User-Agent"] = UA
        cookie = self._cookie_header()
        if cookie:
            headers["Cookie"] = cookie

        net = getattr(self, "net", None)
        if net is not None and hasattr(net, "req") and not force_stdlib:
            options = {"headers": headers, "timeout": timeout * 1000}
            if body is not None:
                options["method"] = method
                options["body"] = body
            res = net.req(url, options)
            if res.get("error"):
                raise RuntimeError("网络错误 %s: %s" % (url, res["error"]))
            return int(res.get("code") or 0), str(res.get("content") or "")

        data = body.encode("utf-8") if isinstance(body, str) else body
        req = urllib.request.Request(url, data=data, method=method)
        for key, value in headers.items():
            req.add_header(key, value)
        try:
            with self._opener.open(req, timeout=timeout) as resp:
                return resp.status, resp.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as exc:
            return exc.code, exc.read().decode("utf-8", "replace")

    # ───────────────────────────────── 签名

    def _signing(self):
        if self._sign:
            return self._sign
        net = getattr(self, "net", None)
        if net is not None and hasattr(net, "cached"):
            try:
                value = net.cached(
                    SIGN_CACHE_KEY,
                    {"ttl": SIGN_TTL_MS, "stale": True, "persist": True},
                    self._fetch_signing,
                )
                if value:
                    self._sign = value
                    return value
            except Exception:
                self._sign = None
        self._sign = self._fetch_signing()
        return self._sign

    def _fetch_signing(self):
        """从站点 bundle 提取密钥与客户端头，避免把密钥写进源码。"""
        _code, html = self._http(self.host + "/")
        js = ""
        m = re.search(r"/assets/movie-card-runtime-[A-Za-z0-9_\-]+\.js", html)
        if m:
            _code, js = self._http(self.host + m.group(0))
        if not js:
            for candidate in re.findall(r"/assets/[A-Za-z0-9_\-]+\.js", html):
                _code, body = self._http(self.host + candidate)
                if "x-ai-movie-signature" in body:
                    js = body
                    break
        if not js:
            raise RuntimeError("取不到站点脚本，无法初始化签名")

        match = re.search(r'x-ai-movie-signature",[^;]{0,200}?"([0-9a-f]{64})"', js)
        key = match.group(1) if match else ""
        if not key:
            hexes = re.findall(r'"([0-9a-f]{64})"', js)
            key = hexes[0] if hexes else ""
        if not key:
            raise RuntimeError("未找到签名密钥（站点可能改版）")

        build = re.search(r"dianyingtiantang-v[0-9][A-Za-z0-9._\-]*-web", js)
        proto = re.search(r"\d{4}-\d{2}-\d{2}\.[a-z0-9.\-]*playback-v\d+", js)
        version = re.search(r'x-ai-movie-client-version",\s*"([^"]+)"', js)
        return {
            "key": key,
            "client_name": "dianyingtiantang-frontend",
            "client_version": version.group(1) if version else "1.0.0",
            "build_version": build.group(0) if build else "",
            "protocol_version": proto.group(0) if proto else "",
        }

    def _signed_headers(self, target, method):
        sign = self._signing()
        ts = str(int(time.time() * 1000))
        nonce = secrets.token_hex(16)
        canonical = "%s\n%s\n%s\n%s" % (method, target, ts, nonce)
        signature = hmac.new(
            sign["key"].encode("utf-8"), canonical.encode("utf-8"), hashlib.sha256
        ).hexdigest()
        headers = {
            "User-Agent": UA,
            "Accept": "application/json",
            "Referer": self.host + "/",
            "Origin": self.host,
            "x-ai-movie-timestamp": ts,
            "x-ai-movie-nonce": nonce,
            "x-ai-movie-signature": signature,
            "x-ai-movie-client-name": sign["client_name"],
            "x-ai-movie-client-version": sign["client_version"],
        }
        if sign["build_version"]:
            headers["x-ai-movie-build-version"] = sign["build_version"]
        if sign["protocol_version"]:
            headers["x-ai-movie-protocol-version"] = sign["protocol_version"]
        return headers

    def _ensure_session(self):
        """建匿名会话（播放接口在部分片源上要求 session）。失败不抛，交给上层报错。"""
        if self._session_ready:
            return True
        target = "/v1/users/anonymous"
        body = json.dumps({"anonymous_id": "web_" + str(uuid.uuid4())}, ensure_ascii=False)
        headers = self._signed_headers(target, "POST")
        headers["Content-Type"] = "application/json"
        try:
            code, _text = self._http(
                self.host + target, headers, "POST", body, force_stdlib=True
            )
            self._session_ready = 200 <= code < 300
        except Exception:
            self._session_ready = False
        return self._session_ready

    def _api(self, path, params=None, method="GET", payload=None):
        """签名请求；返回解析后的 JSON。失败抛异常（绝不装成空成功）。"""
        query = ""
        if params:
            pairs = [(k, v) for k, v in params.items() if v is not None and str(v) != ""]
            query = urlencode(pairs)
        target = path + (("?" + query) if query else "")

        body = None
        if payload is not None:
            body = json.dumps(payload, ensure_ascii=False)

        headers = self._signed_headers(target, method)
        if body is not None:
            headers["Content-Type"] = "application/json"
        code, content = self._http(self.host + target, headers, method, body)

        if code == 401 and not self._session_ready and (
            "session" in content or "login_required" in content
        ):
            if self._ensure_session():
                headers = self._signed_headers(target, method)
                if body is not None:
                    headers["Content-Type"] = "application/json"
                code, content = self._http(self.host + target, headers, method, body)

        if not 200 <= code < 300:
            raise RuntimeError("HTTP %s @ %s %s" % (code, target, str(content)[:120]))
        try:
            return json.loads(content)
        except Exception:
            raise RuntimeError("响应不是 JSON @ %s" % target)

    # ───────────────────────────────── 分类

    def homeContent(self, filter):
        classes = [{"type_id": k or "all", "type_name": name} for k, name in KINDS]
        result = {"class": classes}
        if filter:
            this_year = time.gmtime().tm_year
            years = [{"n": "全部", "v": ""}] + [
                {"n": "%d" % y, "v": str(y)} for y in range(this_year, 2014, -1)
            ]
            areas = [{"n": "全部", "v": ""}] + [{"n": a, "v": a} for a in AREAS]
            rows = [
                {"key": "year", "name": "年份", "init": "", "value": years},
                {"key": "area", "name": "地区", "init": "", "value": areas},
            ]
            result["filters"] = {c["type_id"]: rows for c in classes}
        return result

    def homeVideoContent(self):
        """首页推荐：取「全部」第一页，避免首屏空。"""
        try:
            data = self._api("/v1/browse/catalog", {"page": 1, "limit": PAGE_LIMIT})
            return {"list": self._cards(data.get("cards"))}
        except Exception:
            return {"list": []}

    def categoryContent(self, tid, pg, filter, extend):
        e = extend if isinstance(extend, dict) else {}
        params = {"page": int(pg or 1), "limit": PAGE_LIMIT}
        if tid and tid != "all":
            params["kind"] = tid
        if e.get("year"):
            params["year"] = e["year"]
        if e.get("area"):
            params["area"] = e["area"]
        data = self._api("/v1/browse/catalog", params)
        return {
            "list": self._cards(data.get("cards")),
            "page": int(params["page"]),
            "pagecount": self._pagecount(data, params["page"]),
            "limit": PAGE_LIMIT,
        }

    def searchContent(self, key, quick, pg="1"):
        word = str(key or "").strip()
        page = int(pg or 1)
        if not word:
            return {"list": [], "page": 1, "pagecount": 1, "limit": PAGE_LIMIT}
        data = self._api("/v1/browse/catalog", {"page": page, "limit": PAGE_LIMIT, "q": word})
        return {
            "list": self._cards(data.get("cards")),
            "page": page,
            "pagecount": self._pagecount(data, page),
            "limit": PAGE_LIMIT,
        }

    @staticmethod
    def _pagecount(data, page):
        pg = data.get("pagination") or {}
        total = pg.get("total")
        limit = pg.get("limit") or PAGE_LIMIT
        try:
            if total and int(total) > 0:
                pages = (int(total) + int(limit) - 1) // int(limit)
                return max(page, min(pages, 50))
        except Exception:
            pass
        return page + 1 if pg.get("has_more") else max(1, page)

    def _cards(self, cards):
        out = []
        for c in cards or []:
            if not isinstance(c, dict):
                continue
            vid = c.get("id")
            if not vid:
                continue
            out.append({
                "vod_id": str(vid),
                "vod_name": c.get("title") or "",
                "vod_pic": c.get("poster_url") or c.get("backdrop_url") or "",
                "vod_remarks": c.get("remarks") or "",
                "vod_year": str(c.get("year") or ""),
                "vod_area": c.get("area") or "",
                "type_name": c.get("content_kind") or "",
            })
        return out

    # ───────────────────────────────── 详情

    def detailContent(self, ids):
        vid = str(ids[0]).strip()
        detail = self._api("/v1/catalog/%s/detail" % vid)
        episodes = self._episodes(vid)
        if not episodes:
            raise RuntimeError("该片暂无可用集数（可能未上线或需更高权限）")

        lines = []
        for ep in episodes:
            token = ep.get("token")
            if not token:
                continue
            num = ep.get("number")
            name = ep.get("title") or ("第%s集" % num if num else "正片")
            lines.append("%s$%s" % (self._safe(name), token))
        if not lines:
            raise RuntimeError("剧集缺少播放 token")

        item = {
            "vod_id": vid,
            "vod_name": detail.get("title") or "",
            "vod_pic": detail.get("poster_url") or detail.get("backdrop_url") or "",
            "vod_remarks": detail.get("remarks") or detail.get("episode_progress_text") or "",
            "vod_year": str(detail.get("year") or ""),
            "vod_area": detail.get("area") or "",
            "type_name": ", ".join((detail.get("genres") or [])[:3]),
            "vod_director": ", ".join(detail.get("directors") or []),
            "vod_actor": ", ".join((detail.get("actors") or [])[:8]),
            "vod_content": detail.get("description") or "",
            "vod_play_from": "看剧AI",
            "vod_play_url": "#".join(lines),
        }
        return {"list": [item]}

    def _episodes(self, vid):
        out, offset = [], 0
        while True:
            data = self._api("/v1/catalog/%s/episodes" % vid, {"limit": 48, "offset": offset})
            batch = data.get("episodes") or []
            out.extend(batch)
            pg = data.get("episode_pagination") or {}
            if not pg.get("has_more") or not batch:
                break
            offset = int(pg.get("offset") or offset) + int(pg.get("returned_count") or len(batch))
            if offset >= int(data.get("episode_count") or 0) + 1:
                break
        return out

    # ───────────────────────────────── 播放

    def playerContent(self, flag, id, vipFlags):
        ticket = str(id or "").strip()
        if not ticket:
            return {"parse": 0, "msg": "缺少播放标识"}

        resolved = self._api("/v1/playback/resolve/%s" % ticket, {"view": "compact"})
        options = self._ordered_lines(resolved.get("line_options") or [])
        if not options:
            return {"parse": 0, "msg": "该集暂无可用线路"}

        last_error = ""
        for option in options[:MAX_LINE_TRIES]:
            try:
                media = self._resolve_line(option.get("url") or "")
            except Exception as exc:
                last_error = str(exc)[:80]
                continue
            if not media:
                continue
            result = {
                "parse": 0,
                "url": media,
                "header": {"User-Agent": UA, "Referer": self.host + "/"},
            }
            if ".m3u8" in media.split("?")[0].lower():
                result["format"] = "application/x-mpegURL"
            return result

        return {"parse": 0, "msg": "线路暂不可用%s" % (("：" + last_error) if last_error else "")}

    def _ordered_lines(self, options):
        """可用线路排序：直链优先（少一次请求），再 resolve://；指定 label 最优先。"""
        usable = [
            o for o in options
            if o.get("url") and int(o.get("minimum_user_level") or 0) == 0
        ]
        if not usable:
            return []

        def rank(o):
            score = 0
            if not str(o.get("url", "")).startswith("resolve://"):
                score -= 10
            if o.get("selected"):
                score -= 3
            if self.line_pref:
                label = "%s %s" % (o.get("label") or "", o.get("provider_id") or "")
                if self.line_pref.lower() in label.lower():
                    score -= 100
            return score

        return sorted(usable, key=rank)

    def _resolve_line(self, ref, depth=0):
        """resolve://<id> → 最终媒体地址（最多两跳）；直链原样返回。"""
        if not ref:
            return ""
        if ref.startswith("resolve://"):
            if depth >= 2:
                return ""
            public_id = ref.replace("resolve://", "", 1)
            data = self._api(
                "/v1/playback/resolve-line",
                {"view": "compact"},
                method="POST",
                payload={"ticket": public_id},
            )
            line = data.get("line") or {}
            return self._resolve_line(line.get("url") or "", depth + 1)
        return ref

    def isVideoFormat(self, url):
        low = str(url or "").lower().split("?")[0]
        return low.endswith(".m3u8") or low.endswith(".mp4")

    def manualVideoCheck(self):
        return False

    @staticmethod
    def _safe(text):
        return str(text or "").replace("$", "＄").replace("#", "＃").strip() or "正片"
