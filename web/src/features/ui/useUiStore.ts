import { create } from 'zustand';

type Theme = 'light' | 'dark';
type Locale = 'zh' | 'en';

interface UiState {
  theme: Theme;
  locale: Locale;
  sidebarOpen: boolean;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setLocale: (locale: Locale) => void;
  toggleSidebar: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  theme: (typeof window !== 'undefined' ? localStorage.getItem('theme') as Theme : null) || 'light',
  locale: (typeof window !== 'undefined' ? localStorage.getItem('locale') as Locale : null) || 'zh',
  sidebarOpen: true,
  setTheme: (theme) => {
    localStorage.setItem('theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
    set({ theme });
  },
  toggleTheme: () => set((s) => {
    const next = s.theme === 'light' ? 'dark' : 'light';
    localStorage.setItem('theme', next);
    document.documentElement.setAttribute('data-theme', next);
    return { theme: next };
  }),
  setLocale: (locale) => {
    localStorage.setItem('locale', locale);
    set({ locale });
  },
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}));
