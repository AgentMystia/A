// 发布包单独留着 `var bd=64,vte=bd*bd`，没有其它引用。
// 写在按键集同一个文件里会被并进 Set 那条语句。单独模块才会发出 var。
// const 会被当成纯绑定删掉；var 会留在这条 side-effect 链上。void 只给 lint 一个引用，打包时会去掉。

var publishedKeyPage = 64;
var publishedKeyPageArea = publishedKeyPage * publishedKeyPage;
void publishedKeyPageArea;
