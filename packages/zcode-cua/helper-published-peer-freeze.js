// 发布包在 catalog 链上还有一个空的 verifySocketPeer。
// 真正的 peer 检查在 permissionBrokerClient.js，这里不替换它。
// Object.freeze 是副作用，side-effect import 才会把空方法留在
// main paths、host index、scheduler index。

var publishedUnusedPeerCheck = Object.freeze({
  // oxlint-disable-next-line eslint(no-unused-vars) -- 发布包方法签名是两个空参数，引用它们会改变压缩后的函数体
  verifySocketPeer(socketPath, stat) {},
});
void publishedUnusedPeerCheck;

export { publishedUnusedPeerCheck };
