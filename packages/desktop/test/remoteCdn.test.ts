import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  isChineseLocale,
  isUtcPlusEightTimeZone,
  normalizeBaseUrl,
  publishedRemoteCdnReleaseRoot,
  resolveRemoteCdnBaseUrls,
  resolveTimeZoneOffsetMinutes,
  shouldPreferDomesticRemoteCdn,
} from "../src/main/remoteCdn.ts";

const now = new Date("2020-06-15T12:00:00Z");
const domestic = "https://cdn.codegeex.cn/zcode/electron/releases";
const overseas = "https://cdn.zcode-ai.com/zcode/electron/releases";
const previousCdnBaseUrl = process.env.ZCODE_CDN_BASE_URL;

afterEach(() => {
  if (previousCdnBaseUrl === undefined) {
    delete process.env.ZCODE_CDN_BASE_URL;
  } else {
    process.env.ZCODE_CDN_BASE_URL = previousCdnBaseUrl;
  }
});

describe("remote CDN preference", () => {
  it("treats a trimmed zh locale and a +480 offset as domestic", () => {
    assert.equal(isChineseLocale("  ZH-cn "), true);
    assert.equal(isChineseLocale("en-US"), false);
    assert.equal(isChineseLocale(undefined), false);
    assert.equal(resolveTimeZoneOffsetMinutes("Asia/Shanghai", now), 480);
    assert.equal(resolveTimeZoneOffsetMinutes("UTC", now), 0);
    assert.equal(resolveTimeZoneOffsetMinutes("Not/AZone", now), null);
    assert.equal(isUtcPlusEightTimeZone(" Asia/Shanghai ", now), true);
    assert.equal(isUtcPlusEightTimeZone(" ", now), false);
    assert.equal(
      shouldPreferDomesticRemoteCdn({ locale: "zh-CN", timeZone: "Asia/Shanghai", now }),
      true,
    );
    assert.equal(shouldPreferDomesticRemoteCdn({ locale: "zh-CN", timeZone: "UTC", now }), false);
    assert.equal(
      shouldPreferDomesticRemoteCdn({ locale: "en-US", timeZone: "Asia/Shanghai", now }),
      false,
    );
  });

  it("returns an override without a version and without a protocol check", () => {
    assert.equal(normalizeBaseUrl("https://example.com/root///"), "https://example.com/root");
    assert.deepEqual(
      resolveRemoteCdnBaseUrls(
        {
          overrideBaseUrl: " https://example.com/root/// ",
          version: "9.9.9",
          locale: "zh-CN",
          timeZone: "Asia/Shanghai",
          now,
        },
        [],
      ),
      ["https://example.com/root"],
    );
  });

  it("uses the published injected release root ahead of locale order", () => {
    assert.deepEqual(
      resolveRemoteCdnBaseUrls(
        { version: "9.9.9", locale: "zh-CN", timeZone: "Asia/Shanghai", now, env: "test" },
        [publishedRemoteCdnReleaseRoot],
      ),
      [`${publishedRemoteCdnReleaseRoot}/9.9.9`],
    );
    assert.deepEqual(
      resolveRemoteCdnBaseUrls(
        { version: "9.9.9", locale: "en-US", timeZone: "UTC", now, env: "production" },
        ["https://cdn-zcode.z.ai/"],
      ),
      [`${publishedRemoteCdnReleaseRoot}/9.9.9`],
    );
  });

  it("orders domestic then overseas only when the injected list is empty", () => {
    assert.deepEqual(
      resolveRemoteCdnBaseUrls(
        { version: "9.9.9", locale: "zh-CN", timeZone: "Asia/Shanghai", now },
        [],
      ),
      [`${domestic}/9.9.9`, `${overseas}/9.9.9`],
    );
    assert.deepEqual(
      resolveRemoteCdnBaseUrls({ version: "9.9.9", locale: "en-US", timeZone: "UTC", now }, []),
      [`${overseas}/9.9.9`, `${domestic}/9.9.9`],
    );
  });

  it("lets the runtime CDN base replace the injected list", () => {
    process.env.ZCODE_CDN_BASE_URL = "https://cdn-zcode.z.ai";
    assert.deepEqual(resolveRemoteCdnBaseUrls({ version: "9.9.9", locale: "zh-CN", now }), [
      `${publishedRemoteCdnReleaseRoot}/9.9.9`,
    ]);
  });
});
