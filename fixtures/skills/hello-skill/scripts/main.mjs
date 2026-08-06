// 入口函数签名：async (ctx) => ...
// ctx = { args: string[], skillId: string, skillDir: string }
// 返回 undefined → 脚本已自写 stdout；返回值 → run-skill 会 JSON.stringify 到 stdout
export default async function (ctx) {
  return { ok: true, hello: "world", skillId: ctx.skillId };
}
