import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CAPTCHA_NETWORK_URL_FILTER,
  classifyCaptchaNetworkResource,
  installCaptchaNetworkDiagnostics,
  type CaptchaNetworkRequestDetails,
  type CaptchaNetworkWebRequest,
} from "../src/main/captchaNetworkDiagnostics.ts";

function harness() {
  const logs: unknown[][] = [];
  let before: (
    details: CaptchaNetworkRequestDetails,
    callback: (response: Record<string, never>) => void,
  ) => void = () => {};
  let completed: (details: CaptchaNetworkRequestDetails) => void = () => {};
  let failed: (details: CaptchaNetworkRequestDetails) => void = () => {};
  const filters: unknown[] = [];
  const webRequest: CaptchaNetworkWebRequest = {
    onBeforeRequest(filter, listener) {
      filters.push(filter);
      before = listener;
    },
    onCompleted(filter, listener) {
      filters.push(filter);
      completed = listener;
    },
    onErrorOccurred(filter, listener) {
      filters.push(filter);
      failed = listener;
    },
  };
  installCaptchaNetworkDiagnostics(webRequest, {
    info: (...args) => {
      logs.push(args);
    },
  });
  return { logs, filters, before, completed, failed };
}

describe("classifyCaptchaNetworkResource", () => {
  it("classifies device, init, image, and captcha frontend resources", () => {
    assert.deepEqual(
      classifyCaptchaNetworkResource("https://cn-shanghai.device.saf.aliyuncs.com/collect"),
      { kind: "device_api", host: "cn-shanghai.device.saf.aliyuncs.com", path: "/" },
    );
    assert.deepEqual(classifyCaptchaNetworkResource("https://captcha-open.aliyuncs.com/init"), {
      kind: "init_api",
      host: "captcha-open.aliyuncs.com",
      path: "/",
    });
    assert.deepEqual(
      classifyCaptchaNetworkResource("https://upload.captcha-pro-open.aliyuncs.com/log"),
      {
        kind: "sdk_log",
        host: "[prefix].captcha-pro-open.aliyuncs.com",
        path: "/",
      },
    );
    assert.deepEqual(
      classifyCaptchaNetworkResource("https://static-captcha.aliyuncs.com/a.png?x=1"),
      { kind: "image", host: "static-captcha.aliyuncs.com", path: "/[image]" },
    );
    assert.deepEqual(
      classifyCaptchaNetworkResource(
        "https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js",
      ),
      {
        kind: "sdk_script",
        host: "o.alicdn.com",
        path: "/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js",
      },
    );
    assert.deepEqual(
      classifyCaptchaNetworkResource("https://g.alicdn.com/captcha-frontend/dynamicJS/app.js"),
      { kind: "dynamic_js", host: "g.alicdn.com", path: "/captcha-frontend/[dynamic_js]" },
    );
    assert.deepEqual(
      classifyCaptchaNetworkResource("https://x.alicdn.com/captcha-frontend/dynamicJS/app.css"),
      { kind: "dynamic_css", host: "x.alicdn.com", path: "/captcha-frontend/[dynamic_css]" },
    );
    assert.deepEqual(
      classifyCaptchaNetworkResource("https://o.alicdn.com/captcha-frontend/device.js"),
      { kind: "device_script", host: "o.alicdn.com", path: "/captcha-frontend/[device_script]" },
    );
    assert.equal(classifyCaptchaNetworkResource("https://o.alicdn.com/other.js"), undefined);
    assert.equal(classifyCaptchaNetworkResource("not a url"), undefined);
  });
});

describe("installCaptchaNetworkDiagnostics", () => {
  it("logs classified requests and lets every filtered request continue", () => {
    const { logs, filters, before, completed, failed } = harness();
    assert.deepEqual(filters, [
      CAPTCHA_NETWORK_URL_FILTER,
      CAPTCHA_NETWORK_URL_FILTER,
      CAPTCHA_NETWORK_URL_FILTER,
    ]);
    const continued: unknown[] = [];
    before({ id: 1, url: "https://o.alicdn.com/other.js", webContentsId: 4 }, (response) =>
      continued.push(response),
    );
    assert.deepEqual(continued, [{}]);
    assert.equal(logs.length, 0);

    before(
      {
        id: 2,
        url: "https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js",
        webContentsId: 4,
      },
      (response) => continued.push(response),
    );
    assert.deepEqual(logs[0], [
      "[captcha-network]",
      {
        event: "resource.start",
        networkRequestId: 2,
        webContentsId: 4,
        kind: "sdk_script",
        host: "o.alicdn.com",
        path: "/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js",
      },
    ]);
    completed({
      id: 2,
      url: "https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js",
      webContentsId: 4,
      statusCode: 200,
    });
    const completedFields = logs[1]?.[1] as {
      event: string;
      elapsedMs: number;
      statusCode: number;
    };
    assert.equal(completedFields.event, "resource.completed");
    assert.equal(completedFields.statusCode, 200);
    assert.equal(typeof completedFields.elapsedMs, "number");

    failed({
      id: 9,
      url: "https://static-captcha.aliyuncs.com/a.png",
      error: "boom",
    });
    assert.deepEqual(logs[2]?.[1], {
      event: "resource.failed",
      networkRequestId: 9,
      webContentsId: undefined,
      kind: "image",
      host: "static-captcha.aliyuncs.com",
      path: "/[image]",
      elapsedMs: null,
      statusCode: null,
      errorCode: null,
    });
    failed({
      id: 10,
      url: "https://static-captcha.aliyuncs.com/a.png",
      error: "net::ERR_CONNECTION_RESET",
    });
    const resetFields = logs[3]?.[1] as { errorCode?: string } | undefined;
    assert.equal(resetFields?.errorCode, "net::ERR_CONNECTION_RESET");
  });

  it("drops the oldest in-flight request once 128 starts are recorded", () => {
    const { logs, before, completed } = harness();
    for (let id = 1; id <= 129; id += 1) {
      before({ id, url: "https://captcha-open.aliyuncs.com/init" }, () => {});
    }
    completed({ id: 1, url: "https://captcha-open.aliyuncs.com/init", statusCode: 204 });
    const evicted = logs.at(-1)?.[1] as { networkRequestId: number; elapsedMs: number | null };
    assert.equal(evicted.networkRequestId, 1);
    assert.equal(evicted.elapsedMs, null);
    // 完成回调在分类成功后仍会 prune；map 仍有 128 条时会再丢掉最旧的 2。
    completed({ id: 2, url: "https://captcha-open.aliyuncs.com/init", statusCode: 204 });
    const prunedByFinish = logs.at(-1)?.[1] as { elapsedMs: number | null };
    assert.equal(prunedByFinish.elapsedMs, null);
    completed({ id: 3, url: "https://captcha-open.aliyuncs.com/init", statusCode: 204 });
    const kept = logs.at(-1)?.[1] as { networkRequestId: number; elapsedMs: number | null };
    assert.equal(kept.networkRequestId, 3);
    assert.equal(typeof kept.elapsedMs, "number");
  });
});
