import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MessageBubble } from '../../src/components/chat/MessageBubble';
import type { ChatMessage } from '../../src/features/chat/types';

function makeMsg(text: string): ChatMessage {
  return {
    id: 'test-1',
    role: 'assistant',
    blocks: [{ id: 'blk-1', type: 'text', status: 'done', text }],
  };
}

describe('MessageBubble copy', () => {
  it('copies text to clipboard on click', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: write } });
    render(<MessageBubble message={makeMsg('hello world')} isStreaming={false} />);
    fireEvent.click(screen.getByRole('button', { name: /复制/ }));
    expect(write).toHaveBeenCalledWith('hello world');
  });
});
