import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProviderForm } from '../../src/features/providers/ProviderForm';

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('ProviderForm', () => {
  it('disables submit button during submission', async () => {
    vi.spyOn(global, 'fetch').mockImplementationOnce(() =>
      new Promise(r => setTimeout(() => r(new Response('{}', { status: 200 })), 100))
    );
    render(<ProviderForm mode="create" onSuccess={() => {}} />, { wrapper });
    const idInput = screen.getByLabelText('Provider ID');
    const baseUrlInput = screen.getByLabelText('Base URL');
    const apiKeyInput = screen.getByLabelText('API Key');
    fireEvent.change(idInput, { target: { value: 'p1' } });
    fireEvent.change(baseUrlInput, { target: { value: 'https://api.example.com' } });
    fireEvent.change(apiKeyInput, { target: { value: 'sk-test' } });
    const btn = screen.getByRole('button', { name: /保存/ });
    fireEvent.click(btn);
    await waitFor(() => {
      expect(btn).toBeDisabled();
    });
  });
});
