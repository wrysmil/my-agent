import { Sun, Moon, Languages, Command } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme';

export function Topbar() {
  const { theme, toggle } = useTheme();

  return (
    <header
      data-testid="topbar"
      className="h-14 shrink-0 border-b border-border bg-surface flex items-center justify-between px-6"
    >
      <div className="flex items-center gap-2">
        {/* Breadcrumb placeholder — will be filled later */}
      </div>

      <div className="flex items-center gap-3">
        {/* Theme toggle */}
        <button
          onClick={toggle}
          className="p-2 rounded-md text-text-muted hover:bg-surface-hover hover:text-text transition-colors"
          aria-label="Toggle theme"
        >
          {theme === 'light' ? (
            <Sun className="w-4 h-4" />
          ) : (
            <Moon className="w-4 h-4" />
          )}
        </button>

        {/* Language switch placeholder */}
        <button
          className="p-2 rounded-md text-text-muted hover:bg-surface-hover hover:text-text transition-colors"
          aria-label="Switch language"
        >
          <Languages className="w-4 h-4" />
        </button>

        {/* Command palette hint */}
        <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface-hover text-text-muted text-xs">
          <Command className="w-3 h-3" />
          <span>K</span>
        </div>
      </div>
    </header>
  );
}
