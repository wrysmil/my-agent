import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShell } from '../../src/components/layout/AppShell';
import { useUiStore } from '../../src/features/ui/useUiStore';

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
  Plus: () => <span data-testid="icon-plus">plus</span>,
  Loader2: () => <span data-testid="icon-loader">loader</span>,
}));

// Mock i18n module
vi.mock('../../src/lib/i18n', () => ({
  setLocale: vi.fn(),
  getLocale: vi.fn(() => 'zh'),
  t: vi.fn((key: string) => {
    const translations: Record<string, string> = {
      'nav.dashboard': 'Dashboard',
      'nav.chat': 'Chat',
      'nav.providers': 'Providers',
      'nav.skills': 'Skills',
      'nav.agents': 'Agents',
      'nav.settings': 'Settings',
      'settings.title': 'Settings',
    };
    return translations[key] || key;
  }),
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

// Task 4: i18n integration tests
describe('i18n integration with Zustand', () => {
  beforeEach(() => {
    useUiStore.setState({ locale: 'zh' });
    vi.clearAllMocks();
  });

  it('should call i18n.setLocale when useUiStore.setLocale is called', async () => {
    const { setLocale: setI18nLocale } = await import('../../src/lib/i18n');
    const { setLocale: setStoreLocale } = useUiStore.getState();
    setStoreLocale('en');
    // Verify i18n.setLocale was called
    expect(vi.mocked(setI18nLocale)).toHaveBeenCalledWith('en');
  });

  it('should update Zustand state when setLocale is called', () => {
    const { setLocale: setStoreLocale } = useUiStore.getState();
    setStoreLocale('en');
    expect(useUiStore.getState().locale).toBe('en');
  });

  it('should persist locale to localStorage', () => {
    const { setLocale: setStoreLocale } = useUiStore.getState();
    setStoreLocale('en');
    expect(localStorage.getItem('locale')).toBe('en');
  });
});

// Task 5: Sidebar i18n tests
describe('Sidebar i18n', () => {
  beforeEach(() => {
    useUiStore.setState({ locale: 'zh' });
    vi.clearAllMocks();
  });

  it('should render nav items with translated labels', async () => {
    // Set locale to zh and mock t() to return Chinese
    useUiStore.setState({ locale: 'zh' });
    const i18n = await import('../../src/lib/i18n');
    vi.mocked(i18n.t).mockImplementation((key: string) => {
      const zhMap: Record<string, string> = {
        'nav.dashboard': '控制台',
        'nav.chat': '对话',
        'nav.providers': '提供商',
        'nav.skills': '技能',
        'nav.agents': '子 Agent',
        'nav.settings': '设置',
      };
      return zhMap[key] || key;
    });

    render(<MemoryRouter><AppShell /></MemoryRouter>);
    expect(screen.getByText('控制台')).toBeDefined();
    expect(screen.getByText('对话')).toBeDefined();
  });

  it('should render nav items with English labels when locale is en', async () => {
    useUiStore.setState({ locale: 'en' });
    const i18n = await import('../../src/lib/i18n');
    vi.mocked(i18n.t).mockImplementation((key: string) => {
      const enMap: Record<string, string> = {
        'nav.dashboard': 'Dashboard',
        'nav.chat': 'Chat',
        'nav.providers': 'Providers',
        'nav.skills': 'Skills',
        'nav.agents': 'Sub Agents',
        'nav.settings': 'Settings',
      };
      return enMap[key] || key;
    });

    render(<MemoryRouter><AppShell /></MemoryRouter>);
    expect(screen.getByText('Dashboard')).toBeDefined();
    expect(screen.getByText('Chat')).toBeDefined();
  });
});
