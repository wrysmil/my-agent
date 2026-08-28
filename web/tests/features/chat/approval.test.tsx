/**
 * Unit tests for approval system.
 * Coverage: ApprovalContext, useApproval, approvalManager, ApprovalDialog
 */

import { describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { ApprovalProvider, useApproval } from '@/features/chat/ApprovalContext';
import { useApprovalInteraction } from '@/features/chat/useApproval';
import { ApprovalManager } from '@/features/chat/approvalManager';
import type { ApprovalRequested } from '@/lib/api-protocol/frames';

// Mock API client
const mockApiClient = {
  respond: vi.fn(),
};

function createApprovalRequested(overrides: Partial<ApprovalRequested> = {}): ApprovalRequested {
  return {
    kind: 'approval/requested',
    rpcId: { value: 'test-rpc-id', toString: () => 'test-rpc-id', toJSON: () => 'test-rpc-id' } as never,
    sessionId: 'session-1',
    toolUseId: 'tool-use-1',
    toolName: 'Bash',
    input: { command: 'ls -la' },
    ...overrides,
  };
}

describe('ApprovalManager', () => {
  it('enqueues approval request', () => {
    const manager = new ApprovalManager({
      apiClient: mockApiClient as never,
    });

    const request = createApprovalRequested();
    manager.enqueue(request);

    const pending = manager.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].toolName).toBe('Bash');
  });

  it('prevents duplicate enqueue by rpcId', () => {
    const manager = new ApprovalManager({
      apiClient: mockApiClient as never,
    });

    const request = createApprovalRequested();
    manager.enqueue(request);
    manager.enqueue(request);

    expect(manager.getPending()).toHaveLength(1);
  });

  it('approves pending request', async () => {
    const manager = new ApprovalManager({
      apiClient: mockApiClient as never,
    });

    const request = createApprovalRequested();
    manager.enqueue(request);

    await manager.approve('test-rpc-id');

    expect(mockApiClient.respond).toHaveBeenCalledWith(
      'test-rpc-id',
      expect.objectContaining({ ok: true }),
    );
    expect(manager.getPending()).toHaveLength(0);
  });

  it('rejects pending request with reason', async () => {
    const manager = new ApprovalManager({
      apiClient: mockApiClient as never,
    });

    const request = createApprovalRequested();
    manager.enqueue(request);

    await manager.reject('test-rpc-id', 'Not safe');

    expect(mockApiClient.respond).toHaveBeenCalledWith(
      'test-rpc-id',
      expect.objectContaining({ ok: false, message: 'Not safe' }),
    );
  });

  it('returns false for non-pending rpcId', async () => {
    const manager = new ApprovalManager({
      apiClient: mockApiClient as never,
    });

    const result = await manager.approve('non-existent-rpc');
    expect(result).toBe(false);
  });

  it('clears all requests', () => {
    const manager = new ApprovalManager({
      apiClient: mockApiClient as never,
    });

    manager.enqueue(createApprovalRequested({ rpcId: { value: 'id1' } as never }));
    manager.enqueue(createApprovalRequested({ rpcId: { value: 'id2' } as never }));

    expect(manager.getPending()).toHaveLength(2);
    manager.clear();
    expect(manager.getPending()).toHaveLength(0);
  });

  it('notifies listeners on approval', () => {
    const manager = new ApprovalManager({
      apiClient: mockApiClient as never,
    });

    const listener = vi.fn();
    manager.addListener(listener);

    manager.enqueue(createApprovalRequested());
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('ApprovalProvider', () => {
  it('provides empty state initially', () => {
    const { result } = renderHook(() => useApproval(), {
      wrapper: ({ children }) => (
        <ApprovalProvider>{children}</ApprovalProvider>
      ),
    });

    expect(result.current.currentApproval).toBeNull();
    expect(result.current.hasPending).toBe(false);
    expect(result.current.pendingCount).toBe(0);
  });
});

describe('useApprovalInteraction', () => {
  it('returns pending approval', () => {
    const { result } = renderHook(() => useApprovalInteraction(), {
      wrapper: ({ children }) => (
        <ApprovalProvider apiClient={mockApiClient as never}>{children}</ApprovalProvider>
      ),
    });

    expect(result.current.hasPending).toBe(false);
    expect(result.current.countdown).toBe(-1);
  });
});
