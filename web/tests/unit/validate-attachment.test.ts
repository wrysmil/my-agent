/**
 * 附件客户端校验 — MIME / size / count / 总大小。
 * 来源：plan § Step 1.2
 */
import { describe, it, expect } from 'vitest';
import {
  validateAttachments,
  ATTACHMENT_LIMITS,
  ATTACHMENT_MIME_ALLOWLIST,
} from '../../src/features/attachments/validateAttachment';

function makeFile(name: string, type: string, sizeBytes: number): File {
  // jsdom 不真正分配字节；用一个真实 blob 满足 size 字段
  const blob = new Blob([new Uint8Array(sizeBytes)], { type });
  const file = new File([blob], name, { type });
  return file;
}

describe('validateAttachments', () => {
  describe('MIME 白名单', () => {
    it('通过白名单内的 image/png', () => {
      const failures = validateAttachments([makeFile('a.png', 'image/png', 100)], []);
      expect(failures.filter((f) => f.code === 'invalid_mime')).toEqual([]);
    });

    it('拒绝 application/octet-stream', () => {
      const failures = validateAttachments([makeFile('a.bin', 'application/octet-stream', 100)], []);
      const f = failures.find((x) => x.code === 'invalid_mime');
      expect(f).toBeDefined();
      expect(f?.ext).toBe('bin');
      expect(f?.file?.name).toBe('a.bin');
    });

    it('拒绝 .exe', () => {
      const failures = validateAttachments([makeFile('hack.exe', 'application/x-msdownload', 100)], []);
      expect(failures.find((f) => f.code === 'invalid_mime')).toBeDefined();
    });

    it('通过 text/markdown', () => {
      const failures = validateAttachments([makeFile('a.md', 'text/markdown', 100)], []);
      expect(failures.filter((f) => f.code === 'invalid_mime')).toEqual([]);
    });

    it('白名单常量包含所有 spec 列出的类型', () => {
      expect(ATTACHMENT_MIME_ALLOWLIST).toContain('image/png');
      expect(ATTACHMENT_MIME_ALLOWLIST).toContain('image/jpeg');
      expect(ATTACHMENT_MIME_ALLOWLIST).toContain('image/gif');
      expect(ATTACHMENT_MIME_ALLOWLIST).toContain('image/webp');
      expect(ATTACHMENT_MIME_ALLOWLIST).toContain('image/svg+xml');
      expect(ATTACHMENT_MIME_ALLOWLIST).toContain('application/pdf');
      expect(ATTACHMENT_MIME_ALLOWLIST).toContain('text/plain');
      expect(ATTACHMENT_MIME_ALLOWLIST).toContain('text/markdown');
      expect(ATTACHMENT_MIME_ALLOWLIST).toContain('text/csv');
      expect(ATTACHMENT_MIME_ALLOWLIST).toContain('application/json');
      expect(ATTACHMENT_MIME_ALLOWLIST).toContain('application/javascript');
      expect(ATTACHMENT_MIME_ALLOWLIST).toContain('text/javascript');
      expect(ATTACHMENT_MIME_ALLOWLIST).toContain('text/typescript');
    });
  });

  describe('单文件大小', () => {
    it('通过 10MB 整（含）', () => {
      const failures = validateAttachments(
        [makeFile('a.png', 'image/png', ATTACHMENT_LIMITS.maxFileSize)],
        [],
      );
      expect(failures.filter((f) => f.code === 'file_too_large')).toEqual([]);
    });

    it('拒绝 10MB+1B', () => {
      const failures = validateAttachments(
        [makeFile('a.png', 'image/png', ATTACHMENT_LIMITS.maxFileSize + 1)],
        [],
      );
      expect(failures.find((f) => f.code === 'file_too_large')).toBeDefined();
    });

    it('拒绝 11MB', () => {
      const failures = validateAttachments(
        [makeFile('big.png', 'image/png', 11 * 1024 * 1024)],
        [],
      );
      const f = failures.find((x) => x.code === 'file_too_large');
      expect(f).toBeDefined();
      expect(f?.file?.name).toBe('big.png');
    });
  });

  describe('文件数量', () => {
    it('existing + newFiles === 5 时通过', () => {
      const existing = Array.from({ length: 3 }, (_, i) => ({ size: 100 }));
      const newFiles = Array.from({ length: 2 }, (_, i) =>
        makeFile(`n${i}.png`, 'image/png', 100),
      );
      const failures = validateAttachments(newFiles, existing);
      expect(failures.filter((f) => f.code === 'too_many_files')).toEqual([]);
    });

    it('existing + newFiles === 6 时失败', () => {
      const existing = Array.from({ length: 3 }, (_, i) => ({ size: 100 }));
      const newFiles = Array.from({ length: 3 }, (_, i) =>
        makeFile(`n${i}.png`, 'image/png', 100),
      );
      const failures = validateAttachments(newFiles, existing);
      expect(failures.find((f) => f.code === 'too_many_files')).toBeDefined();
    });

    it('newFiles === 6 时失败', () => {
      const newFiles = Array.from({ length: 6 }, (_, i) =>
        makeFile(`n${i}.png`, 'image/png', 100),
      );
      const failures = validateAttachments(newFiles, []);
      expect(failures.find((f) => f.code === 'too_many_files')).toBeDefined();
    });
  });

  describe('总大小', () => {
    it('总大小 === 30MB 整（含）通过', () => {
      const existing = [{ size: 20 * 1024 * 1024 }];
      const newFiles = [makeFile('a.png', 'image/png', 10 * 1024 * 1024)];
      const failures = validateAttachments(newFiles, existing);
      expect(failures.filter((f) => f.code === 'total_too_large')).toEqual([]);
    });

    it('总大小 === 30MB+1B 失败', () => {
      const existing = [{ size: 20 * 1024 * 1024 }];
      const newFiles = [makeFile('a.png', 'image/png', 10 * 1024 * 1024 + 1)];
      const failures = validateAttachments(newFiles, existing);
      expect(failures.find((f) => f.code === 'total_too_large')).toBeDefined();
    });
  });

  describe('多失败同时返回', () => {
    it('MIME 错 + size 大 同时存在时两条 failure 都返回', () => {
      const newFiles = [
        makeFile('big.exe', 'application/x-msdownload', 11 * 1024 * 1024),
        makeFile('ok.png', 'image/png', 100),
      ];
      const failures = validateAttachments(newFiles, []);
      const codes = failures.map((f) => f.code).sort();
      expect(codes).toContain('file_too_large');
      expect(codes).toContain('invalid_mime');
    });
  });

  describe('通过场景', () => {
    it('单个白名单 + size 内 + count 内 → failures 为空数组', () => {
      const failures = validateAttachments(
        [makeFile('ok.png', 'image/png', 1024)],
        [],
      );
      expect(failures).toEqual([]);
    });
  });
});