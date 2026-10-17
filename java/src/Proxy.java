package com.github.catvod.spider;

import com.github.catvod.crawler.Spider;

import java.util.Map;

/** 兼容壳：FongMi 的 JAR 加载器会查找该类；本源不使用本机代理。 */
public class Proxy extends Spider {
    public static Object[] proxy(Map<String, String> params) throws Exception {
        return null;
    }

    public static String getHostPort() {
        return "";
    }

    public static String getProxyUrl() {
        return "";
    }
}
