import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom 不实现 URL.createObjectURL / revokeObjectURL，补充最小桩。
// 真实场景：浏览器为文件生成 blob: URL；测试只需要 URL.createObjectURL 返回 string 即可。
const urlRef = URL as unknown as {
  createObjectURL?: (obj: Blob | MediaSource) => string;
  revokeObjectURL?: (url: string) => void;
};
if (typeof urlRef.createObjectURL !== 'function') {
  let counter = 0;
  urlRef.createObjectURL = (_obj: Blob | MediaSource) => {
    counter += 1;
    return `blob:test://${counter}`;
  };
  urlRef.revokeObjectURL = () => {};
}

afterEach(() => {
  cleanup();
});
