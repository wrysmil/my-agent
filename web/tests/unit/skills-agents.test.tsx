import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SkillsPage } from '../../src/pages/SkillsPage';
import { AgentsPage } from '../../src/pages/AgentsPage';

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('SkillsPage', () => {
  it('renders skills list', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({
        ok: true,
        data: {
          skills: [{ id: 'code-review', name: 'code-review', description: 'Review code', source: 'builtin', scope: 'builtin' }]
        }
      }), { status: 200 })
    );
    render(<SkillsPage />, { wrapper });
    await waitFor(() => {
      expect(screen.getByText('code-review')).toBeInTheDocument();
    });
  });
});

describe('AgentsPage', () => {
  it('renders agents list', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({
        ok: true,
        data: {
          agents: [{ id: 'a1', name: 'coder', description: 'Code agent', source: 'builtin', scope: 'builtin', enabled: true, tools: [] }]
        }
      }), { status: 200 })
    );
    render(<AgentsPage />, { wrapper });
    await waitFor(() => {
      expect(screen.getByText('coder')).toBeInTheDocument();
    });
  });
});
