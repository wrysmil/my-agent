import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from '../../src/components/layout/AppShell';

// Mock lucide-react icons to avoid issues
vi.mock('lucide-react', () => ({
  MessageSquare: () => <span data-testid="icon-msg">msg</span>,
  History: () => <span data-testid="icon-history">hist</span>,
  Bot: () => <span data-testid="icon-bot">bot</span>,
  Plug: () => <span data-testid="icon-plug">plug</span>,
  Settings2: () => <span data-testid="icon-settings">set</span>,
  SlidersHorizontal: () => <span data-testid="icon-sliders">slid</span>,
  Sun: () => <span data-testid="icon-sun">sun</span>,
  Moon: () => <span data-testid="icon-moon">moon</span>,
  Languages: () => <span data-testid="icon-lang">lang</span>,
  Command: () => <span data-testid="icon-cmd">cmd</span>,
}));

describe('AppShell', () => {
  it('renders sidebar + topbar', () => {
    render(<MemoryRouter><AppShell /></MemoryRouter>);
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('topbar')).toBeInTheDocument();
  });
});
