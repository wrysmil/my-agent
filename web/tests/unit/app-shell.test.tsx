import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShell } from '../../src/components/layout/AppShell';

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  MessageSquare: () => <span data-testid="icon-msg">msg</span>,
  Bot: () => <span data-testid="icon-bot">bot</span>,
  Plug: () => <span data-testid="icon-plug">plug</span>,
  Settings2: () => <span data-testid="icon-settings">set</span>,
  SlidersHorizontal: () => <span data-testid="icon-sliders">slid</span>,
  Plus: () => <span data-testid="icon-plus">plus</span>,
  LayoutDashboard: () => <span data-testid="icon-dashboard">dash</span>,
  Loader2: () => <span data-testid="icon-loader">load</span>,
  Sun: () => <span data-testid="icon-sun">sun</span>,
  Moon: () => <span data-testid="icon-moon">moon</span>,
  Languages: () => <span data-testid="icon-lang">lang</span>,
  Command: () => <span data-testid="icon-cmd">cmd</span>,
}));

describe('AppShell', () => {
  it('renders sidebar + topbar', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter><AppShell /></MemoryRouter>
      </QueryClientProvider>
    );
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('topbar')).toBeInTheDocument();
  });
});
