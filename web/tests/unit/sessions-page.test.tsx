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
          sessions: [
            { id: 's1', title: 'Test Session', createdAt: '2026-01-01', archived: false },
          ],
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
      new Response(JSON.stringify({ sessions: [] }), { status: 200 })
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
          sessions: [
            { id: 's1', title: 'Alpha Session', createdAt: '2026-01-01', archived: false },
            { id: 's2', title: 'Beta Chat', createdAt: '2026-01-02', archived: false },
          ],
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
          sessions: [
            { id: 's1', title: 'Active Session', createdAt: '2026-01-01', archived: false },
          ],
        }),
        { status: 200 }
      )
    );
    // Second call: archived sessions (archived=true)
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          sessions: [
            { id: 's2', title: 'Archived Session', createdAt: '2025-12-01', archived: true },
          ],
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
      new Response(JSON.stringify({ sessions: [] }), { status: 200 })
    );
    render(<SessionsPage />, { wrapper });
    await waitFor(() => {
      expect(screen.getByTestId('page-sessions')).toBeInTheDocument();
    });
  });
});
