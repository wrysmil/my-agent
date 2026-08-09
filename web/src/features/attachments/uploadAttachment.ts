/**
 * 附件上传 — 本期 stub + 接口约定。
 *
 * 来源：spec § 5.6 .ai-runtime-artifacts/specs/2026-08-09-chat-composer-redesign-spec.md
 * 落地：plan § Step 1.3
 *
 * 本期不实装真实上传；返回 blob URL 让 UI 可显示。
 * 未来替换：把内部 fetch 换成 POST /api/uploads（multipart/form-data），
 * AttachmentUploadResult 字段不变，零 diff。
 */

export interface AttachmentUploadResult {
  /** 上传成功后的服务端 ID（本期 stub 永远 undefined） */
  remoteId?: string;
  /** 上传后的 URL（本期 stub 返回 blob URL；未来返回后端返回的 cdn url） */
  url: string;
}

/**
 * 上传单个附件。
 *
 * 本期 stub 行为：
 *   1. console.warn 标记开发中
 *   2. 模拟 1.5s 延迟（可被 signal 取消）
 *   3. 返回 { url: blob URL }
 *
 * @throws DOMException('AbortError') 当 signal 被触发时
 */
export async function uploadAttachment(
  file: File,
  signal: AbortSignal,
): Promise<AttachmentUploadResult> {
  console.warn(
    '[uploadAttachment] stub：本期未实装真实上传',
    file.name,
    `${(file.size / 1024).toFixed(1)} KB`,
  );

  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, 1500);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });

  return { url: URL.createObjectURL(file) };
}