# -*- coding: utf-8 -*-
"""python/kanju.py 的 mock 用例（SRC-01 / SRC-05）。

运行：python3 tests/python/test_kanju.py（仓库根目录）。
本文件不联网：self.net 用桩替换，重定向只调用处理器本身。
浏览器内无法运行，本轮未执行，待有 Python 环境时验证。
"""

import importlib.util
import sys
import types
import unittest
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def load_kanju():
    # python/kanju.py 首行是 from base.spider import Spider as BaseSpider，
    # 宿主（FongMi / Chaquopy）才提供 base.spider；测试里先用空基类桩上。
    base = types.ModuleType("base")
    spider_mod = types.ModuleType("base.spider")

    class BaseSpider:
        pass

    spider_mod.Spider = BaseSpider
    base.spider = spider_mod
    sys.modules["base"] = base
    sys.modules["base.spider"] = spider_mod
    spec = importlib.util.spec_from_file_location("kanju", ROOT / "python" / "kanju.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


kanju = load_kanju()


class FakeNet:
    """桩 self.net：req(url, options) 返回固定 dict。"""

    def __init__(self, res):
        self.res = res

    def req(self, url, options):
        return self.res


def make_spider(net=None):
    sp = kanju.Spider()
    sp.init("")
    if net is not None:
        sp.net = net
    return sp


class TestRedactPath(unittest.TestCase):
    def test_detail_path(self):
        self.assertEqual(
            kanju._redact_path("/v1/catalog/abc123/detail"),
            "/v1/catalog/[id]/detail",
        )

    def test_full_url_detail(self):
        self.assertEqual(
            kanju._redact_path("https://kanju.ai/v1/catalog/abc123/detail?x=1"),
            "/v1/catalog/[id]/detail",
        )

    def test_episodes_path(self):
        self.assertEqual(
            kanju._redact_path("/v1/catalog/abc123/episodes"),
            "/v1/catalog/[id]/episodes",
        )

    def test_resolve_path(self):
        # SRC-01 验收：线路列表路径的非固定段必须折叠。
        self.assertEqual(
            kanju._redact_path("/v1/playback/resolve/abc123"),
            "/v1/playback/resolve/[id]",
        )

    def test_full_url_resolve(self):
        self.assertEqual(
            kanju._redact_path(
                "https://kanju.ai/v1/playback/resolve/abc123?view=compact"
            ),
            "/v1/playback/resolve/[id]",
        )

    def test_query_dropped(self):
        self.assertEqual(
            kanju._redact_path("/v1/browse/catalog?page=1&limit=20"),
            "/v1/browse/catalog",
        )


class TestHttpBridgeError(unittest.TestCase):
    def test_boom_error_keeps_short_word_but_redacts_url(self):
        sp = make_spider(FakeNet({"error": "boom"}))
        url = "https://kanju.ai/v1/catalog/VID999/detail?x=1"
        with self.assertRaises(RuntimeError) as ctx:
            sp._http(url)
        msg = str(ctx.exception)
        self.assertIn("boom", msg)
        self.assertIn("/v1/catalog/[id]/detail", msg)
        self.assertNotIn("VID999", msg)
        self.assertNotIn("?", msg)

    def test_error_text_with_url_and_token_is_cleaned(self):
        token = "TOKENABCDEF1234567890"
        sp = make_spider(
            FakeNet(
                {
                    "error": "fail at https://kanju.ai/v1/playback/resolve/"
                    + token
                    + "?view=compact"
                }
            )
        )
        with self.assertRaises(RuntimeError) as ctx:
            sp._http("https://kanju.ai/v1/playback/resolve/" + token)
        msg = str(ctx.exception)
        self.assertIn("/v1/playback/resolve/[id]", msg)
        self.assertNotIn(token, msg)
        self.assertNotIn("?", msg)

    def test_success_path_returns_code_and_content(self):
        sp = make_spider(FakeNet({"code": 200, "content": "{}"}))
        self.assertEqual(sp._http("https://kanju.ai/v1/feed/home"), (200, "{}"))


class TestRedirectTriple(unittest.TestCase):
    """重定向三元组（scheme, hostname, port）校验。

    方法语义矩阵（源码注释口径，urllib 自身行为，本测试不硬断言跨版本差异）：
    303 转 GET；301 / 302 / 307 保持方法与 body；308 随 CPython 版本而异。
    跨站 / 降级 / 跨端口一律由本处理器返回 None（即不进入父类逻辑），
    因此被拒绝情形的桩参数无关紧要；同源情形断言返回请求对象。
    """

    def setUp(self):
        self.handler = kanju._SameHostRedirectHandler()
        self.origin = "https://kanju.ai/v1/catalog/abc/detail"

    def _redirect(self, newurl, code=302):
        req = urllib.request.Request(self.origin)
        return self.handler.redirect_request(req, None, code, "Found", {}, newurl)

    def test_same_origin_allowed(self):
        result = self._redirect("https://kanju.ai/v1/other")
        self.assertIsNotNone(result)
        self.assertIn("kanju.ai", result.full_url)

    def test_relative_allowed(self):
        self.assertIsNotNone(self._redirect("/v1/other"))

    def test_default_port_normalized(self):
        # https 缺省 443：显式 :443 与缺省端口属同一三元组，应放行。
        self.assertIsNotNone(self._redirect("https://kanju.ai:443/v1/other"))

    def test_downgrade_rejected(self):
        self.assertIsNone(self._redirect("http://kanju.ai/v1/other"))

    def test_cross_site_rejected(self):
        self.assertIsNone(self._redirect("https://evil.example/v1/other"))

    def test_cross_port_rejected(self):
        self.assertIsNone(self._redirect("https://kanju.ai:8443/v1/other"))

    def test_cross_site_308_rejected_regardless_of_version(self):
        # 308 的同站方法语义随版本而异，但跨站拒绝由本处理器先行短路，与版本无关。
        self.assertIsNone(self._redirect("https://evil.example/v1/other", code=308))

    def test_same_origin_308_recorded_only(self):
        # 记录性用例：同站 308 在不同 CPython 版本下可能放行或抛错，
        # 本测试只记录不硬断言放行与否，跨版本差异不得使 CI 变红。
        try:
            result = self._redirect("https://kanju.ai/v1/other", code=308)
        except urllib.error.HTTPError:
            return
        self.assertTrue(result is None or isinstance(result, urllib.request.Request))


if __name__ == "__main__":
    unittest.main()
