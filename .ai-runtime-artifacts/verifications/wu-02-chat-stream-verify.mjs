// WU-02 自检：在纯 Node 下验证 runChatStream 事件协议与 abort 语义（electron 用 stub）。
import { runChatStream, registerChatIpc } from "../../dist/src/ipc/chat.js";

let failures = 0;
const check = (name, cond, detail) => {
  console.log((cond ? "PASS" : "FAIL") + " " + name + (cond ? "" : "  -> " + detail));
  if (!cond) failures++;
};

// 1) 正常流：text 'hi' → 逐字 text_delta → done(sessionId)，channel = stream:{requestId}
const events = [];
const fakeEvent = { sender: { send: (ch, ev) => events.push({ ch, ev }) } };
const { abort } = runChatStream(fakeEvent, "req-1", { text: "hi", sessionId: "s1" }, null);
await new Promise((r) => setTimeout(r, 600));
abort(); // 流已完成，abort 应为 no-op

const deltas = events.filter((e) => e.ev.type === "text_delta");
const done = events.filter((e) => e.ev.type === "done");
check("channel 使用 stream:{requestId}", events.length > 0 && events.every((e) => e.ch === "stream:req-1"), JSON.stringify(events.slice(0, 2)));
check("text_delta 逐字数 = Echo 长度", deltas.length === "Echo: hi".length, "got " + deltas.length + " expected " + "Echo: hi".length);
check("拼接文本 = Echo: hi", deltas.map((e) => e.ev.text).join("") === "Echo: hi", deltas.map((e) => e.ev.text).join(""));
check("done 恰好 1 次", done.length === 1, "got " + done.length);
check("done.payload.sessionId = s1", done[0] && done[0].ev.payload.sessionId === "s1", JSON.stringify(done[0] && done[0].ev.payload));

// 2) 空 payload 兜底：不抛错，最终发 done
const events2 = [];
const fake2 = { sender: { send: (c, e) => events2.push(e) } };
runChatStream(fake2, "req-2", null, null);
await new Promise((r) => setTimeout(r, 600));
const last2 = events2[events2.length - 1];
check("空 payload 最终 done 且 sessionId=placeholder", last2 && last2.type === "done" && last2.payload.sessionId === "placeholder", JSON.stringify(last2));

// 3) 取消语义：长文本 + 主动 abort → 不再发事件、不发 done
const events3 = [];
const fake3 = { sender: { send: (c, e) => events3.push(e) } };
const s3 = runChatStream(fake3, "req-3", { text: "x".repeat(1000) }, null);
await new Promise((r) => setTimeout(r, 90));
s3.abort();
const before = events3.length;
await new Promise((r) => setTimeout(r, 250));
check("abort 后不再发事件", events3.length === before, "before " + before + " after " + events3.length);
check("abort 后无 done", !events3.some((e) => e.type === "done"), "has done");

// 4) registerChatIpc 向后兼容：注册 chat:cancel handle 不抛错
let ok4 = false;
try {
  registerChatIpc({});
  ok4 = true;
} catch (_) {}
check("registerChatIpc 可调用（chat:cancel 兼容）", ok4, "threw");

console.log(failures === 0 ? "RESULT: ALL PASS" : "RESULT: " + failures + " FAILURE(S)");
process.exit(failures === 0 ? 0 : 1);
