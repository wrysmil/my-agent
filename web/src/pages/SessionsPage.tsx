import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useSessions, type SessionItem } from '@/features/sessions/useSessions';

export function SessionsPage() {
  const [archived, setArchived] = useState(false);
  const [search, setSearch] = useState('');

  const { data, isLoading, isError } = useSessions(archived);

  const sessions: SessionItem[] = data?.sessions ?? [];

  const filtered = useMemo(() => {
    if (!search.trim()) return sessions;
    const q = search.toLowerCase();
    return sessions.filter((s) => s.title.toLowerCase().includes(q));
  }, [sessions, search]);

  return (
    <div data-testid="page-sessions">
      {/* Tabs: Active / Archived */}
      <div role="tablist">
        <button
          role="tab"
          aria-selected={!archived}
          onClick={() => setArchived(false)}
        >
          Active
        </button>
        <button
          role="tab"
          aria-selected={archived}
          onClick={() => setArchived(true)}
        >
          Archived
        </button>
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search sessions..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {/* Loading / Error */}
      {isLoading && <p>Loading sessions...</p>}
      {isError && <p>Failed to load sessions.</p>}

      {/* Empty state */}
      {!isLoading && !isError && filtered.length === 0 && (
        <p>
          {archived
            ? 'No archived sessions.'
            : search.trim()
              ? 'No sessions match your search.'
              : 'No sessions yet.'}
        </p>
      )}

      {/* Session list */}
      {!isLoading && !isError && filtered.length > 0 && (
        <ul>
          {filtered.map((s) => (
            <li key={s.id}>
              <Link to={`/chat/${s.id}`}>{s.title}</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
