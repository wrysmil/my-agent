import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MessageBubble } from '../../src/components/chat/MessageBubble';

describe('MessageBubble copy', () => {
  it('copies text to clipboard on click', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: write } });
    render(<MessageBubble role="assistant" text="hello world" />);
    fireEvent.click(screen.getByRole('button', { name: /复制/ }));
    expect(write).toHaveBeenCalledWith('hello world');
  });
});
