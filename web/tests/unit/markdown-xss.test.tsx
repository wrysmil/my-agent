import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Markdown } from '../../src/components/chat/Markdown';

const vectors = [
  '<img src=x onerror=alert(1)>',
  '[click](javascript:alert(1))',
  '<script>alert(1)</script>',
  '![x](data:text/html,<script>alert(1)</script>)',
  '<iframe src="javascript:alert(1)"></iframe>',
];

describe('Markdown XSS', () => {
  for (const v of vectors) {
    it(`blocks: ${v.slice(0, 40)}`, () => {
      const { container } = render(<Markdown text={v} />);
      expect(container.innerHTML).not.toMatch(/onerror|javascript:|<script|<iframe/i);
    });
  }
});
