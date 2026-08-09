import type { ContentBlockCodec } from "./types.js";
import type { ApiProtocol } from "../types.js";

/**
 * 全局 codec 注册表（按 api 协议名索引）。
 *
 * Provider 初始化时调用 registerCodec() 注册其协议对应的 codec，
 * 运行时通过 codecForApi() 按 ApiProtocol 查找。
 */
const codecs = new Map<ApiProtocol, ContentBlockCodec>();

/**
 * 注册一个 ContentBlockCodec 实例。
 *
 * 调用时机：provider 构造函数中，或在应用启动时集中注册。
 * 同一 api 后注册的会覆盖先前的。
 */
export function registerCodec(codec: ContentBlockCodec): void {
  codecs.set(codec.api, codec);
}

/**
 * 按 ApiProtocol 查找对应的 ContentBlockCodec。
 *
 * 返回值可能为 undefined，调用方应处理 codec 不存在的情况。
 */
export function codecForApi(
  api: ApiProtocol,
): ContentBlockCodec | undefined {
  return codecs.get(api);
}

/**
 * 返回当前已注册的所有 api 协议名。
 */
export function listCodecApis(): string[] {
  return [...codecs.keys()];
}
