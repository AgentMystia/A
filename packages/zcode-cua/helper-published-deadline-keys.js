// 发布包把刷新标记的字段名冻成一个没有读取的 Set。
// 真正写入 deadlineEpochMs 的标记在 helper-refresh-marker.js，这里不是第二份写入。

var publishedUnusedDeadlineKeys = Object.freeze(new Set(["schema", "kind", "deadlineEpochMs"]));
void publishedUnusedDeadlineKeys;

export { publishedUnusedDeadlineKeys };
