import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { SessionsPage } from '../../src/pages/SessionsPage';

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('SessionsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders sessions list', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            sessions: [
              { id: 's1', name: 'Test Session', messageCount: 5, lastTs: 100, archived: false },
            ],
            total: 1,
            limit: 50,
            offset: 0,
          },
        }),
        { status: 200 }
      )
    );
    render(<SessionsPage />, { wrapper });
    await waitFor(() => {
      expect(screen.getByText('Test Session')).toBeInTheDocument();
    });
  });

  it('shows empty state when no sessions', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          data: { sessions: [], total: 0, limit: 50, offset: 0 },
        }),
        { status: 200 }
      )
    );
    render(<SessionsPage />, { wrapper });
    await waitFor(() => {
      expect(screen.getByTestId('page-sessions')).toBeInTheDocument();
    });
    expect(screen.queryByRole('listitem')).toBeNull();
  });

  it('filters sessions by search input', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            sessions: [
              { id: 's1', name: 'Alpha Session', messageCount: 1, lastTs: 100, archived: false },
              { id: 's2', name: 'Beta Chat', messageCount: 2, lastTs: 200, archived: false },
            ],
            total: 2,
            limit: 50,
            offset: 0,
          },
        }),
        { status: 200 }
      )
    );
    render(<SessionsPage />, { wrapper });
    await waitFor(() => {
      expect(screen.getByText('Alpha Session')).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(/search/i);
    await userEvent.type(input, 'Beta');

    expect(screen.queryByText('Alpha Session')).toBeNull();
    expect(screen.getByText('Beta Chat')).toBeInTheDocument();
  });

  it('toggles between active and archived sessions', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    // First call: active sessions (archived=false)
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            sessions: [
              { id: 's1', name: 'Active Session', messageCount: 3, lastTs: 300, archived: false },
            ],
            total: 1,
            limit: 50,
            offset: 0,
          },
        }),
        { status: 200 }
      )
    );
    // Second call: archived sessions (archived=true)
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            sessions: [
              { id: 's2', name: 'Archived Session', messageCount: 0, lastTs: 100, archived: true },
            ],
            total: 1,
            limit: 50,
            offset: 0,
          },
        }),
        { status: 200 }
      )
    );

    render(<SessionsPage />, { wrapper });
    await waitFor(() => {
      expect(screen.getByText('Active Session')).toBeInTheDocument();
    });

    const archiveTab = screen.getByText(/archived/i);
    await userEvent.click(archiveTab);

    await waitFor(() => {
      expect(screen.getByText('Archived Session')).toBeInTheDocument();
    });
  });

  it('has data-testid page-sessions', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          data: { sessions: [], total: 0, limit: 50, offset: 0 },
        }),
        { status: 200 }
      )
    );
    render(<SessionsPage />, { wrapper });
    await waitFor(() => {
      expect(screen.getByTestId('page-sessions')).toBeInTheDocument();
    });
  });
});
