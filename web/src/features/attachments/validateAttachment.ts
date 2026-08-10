/**
 * 附件客户端校验 — MIME 白名单 + 大小限制 + 文件数限制。
 *
 * 来源：spec § 5.3 / 5.4 .ai-runtime-artifacts/specs/2026-08-09-chat-composer-redesign-spec.md
 * 落地：plan § Step 1.2
 */

/** 客户端内存里的附件草稿（不上传，仅 UI state） */
export interface AttachmentDraft {
  /** 客户端唯一 ID（crypto.randomUUID） */
  id: string;
  /** 原始 File 对象引用（**仅在内存**，不持久化） */
  file: File;
  /** MIME 类型 */
  mimeType: string;
  /** 文件大小（字节） */
  size: number;
  /** 上传状态：'pending'（本期永远 pending；未来扩展 'uploading' / 'done' / 'error'） */
  uploadStatus: 'pending';
}

export const ATTACHMENT_LIMITS = {
  /** 单文件最大 10 MB */
  maxFileSize: 10 * 1024 * 1024,
  /** 单次提交最多 5 个文件 */
  maxFiles: 5,
  /** 总大小最大 30 MB */
  maxTotalSize: 30 * 1024 * 1024,
} as const;

/**
 * 客户端可接受的 MIME 白名单。
 *
 * 列出：图片 / PDF / 纯文本 / Markdown / CSV / JSON / JS / TS 源文件。
 * 不列：.exe / .zip / application/octet-stream（本期拒绝）。
 */
export const ATTACHMENT_MIME_ALLOWLIST: readonly string[] = [
  // 图片
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  // PDF
  'application/pdf',
  // 纯文本
  'text/plain',
  'text/markdown',
  'text/csv',
  // 数据
  'application/json',
  // 源码
  'application/javascript',
  'text/javascript',
  'text/typescript',
] as const;

export type ValidationFailureCode =
  | 'file_too_large'
  | 'invalid_mime'
  | 'too_many_files'
  | 'total_too_large';

export interface ValidationFailure {
  code: ValidationFailureCode;
  /** i18n 文案占位符；UI 层根据 code + 参数显示具体 Toast */
  message: string;
  /** 触发失败的文件（file_too_large / invalid_mime 时存在） */
  file?: File;
  /** 扩展名（invalid_mime 时存在，给 Toast 显示） */
  ext?: string;
}

export interface ExistingAttachmentSize {
  size: number;
}

/**
 * 校验新加入的 File 列表 + 当前已存在的附件。
 * 返回失败列表；空数组表示全部通过。
 *
 * 校验顺序（按 spec § 5.2 AF-3/AF-8/AF-9/AF-10）：
 *   1. MIME 白名单（逐个）
 *   2. 单文件大小（逐个）
 *   3. 总数量 = existing.length + newFiles.length ≤ maxFiles
 *   4. 总大小 = existing 总和 + newFiles 总和 ≤ maxTotalSize
 *
 * 注意：若同时存在多个失败，**全部**返回（UI 一次性提示；本期 spec § 5.2 倾向一次性 Toast）。
 */
export function validateAttachments(
  newFiles: readonly File[],
  existing: readonly ExistingAttachmentSize[],
): ValidationFailure[] {
  const failures: ValidationFailure[] = [];

  // 1) MIME 白名单
  for (const f of newFiles) {
    if (!ATTACHMENT_MIME_ALLOWLIST.includes(f.type)) {
      failures.push({
        code: 'invalid_mime',
        message: `不支持的文件类型：${extOf(f)}`,
        file: f,
        ext: extOf(f),
      });
    }
  }

  // 2) 单文件大小
  for (const f of newFiles) {
    if (f.size > ATTACHMENT_LIMITS.maxFileSize) {
      failures.push({
        code: 'file_too_large',
        message: '文件超过 10MB',
        file: f,
      });
    }
  }

  // 3) 数量
  const totalCount = existing.length + newFiles.length;
  if (totalCount > ATTACHMENT_LIMITS.maxFiles) {
    failures.push({
      code: 'too_many_files',
      message: '一次最多 5 个文件',
    });
  }

  // 4) 总大小
  const existingTotal = existing.reduce((sum, e) => sum + e.size, 0);
  const newTotal = newFiles.reduce((sum, f) => sum + f.size, 0);
  if (existingTotal + newTotal > ATTACHMENT_LIMITS.maxTotalSize) {
    failures.push({
      code: 'total_too_large',
      message: '总大小超过 30MB',
    });
  }

  return failures;
}

function extOf(file: File): string {
  const dot = file.name.lastIndexOf('.');
  return dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : '';
}