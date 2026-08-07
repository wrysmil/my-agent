// WU-02 临时验证 loader：把 'electron' import 映射到内存 stub，
// 使 dist/src/ipc/chat.js 能在纯 Node 下加载（npm electron 包未安装）。
const STUB = `export const ipcMain = { on() {}, handle() {} };`;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "electron") {
    return { url: "data:text/javascript," + encodeURIComponent(STUB), shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
