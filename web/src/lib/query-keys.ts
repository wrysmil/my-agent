/**
 * TanStack Query key factory.
 *
 * Every top-level key is a domain entity; nested helpers produce
 * consistent `[entity, ...scope]` tuples used across hooks.
 */
export const queryKeys = {
  sessions: {
    all: ['sessions'] as const,
    list: ['sessions', 'list'] as const,
    detail: (id: string) => ['sessions', id] as const,
    history: (id: string) => ['sessions', id, 'history'] as const,
  },
  providers: {
    all: ['providers'] as const,
    detail: (id: string) => ['providers', id] as const,
  },
  skills: {
    all: ['skills'] as const,
    detail: (id: string) => ['skills', id] as const,
  },
  agents: {
    all: ['agents'] as const,
    detail: (id: string) => ['agents', id] as const,
  },
  tools: {
    all: ['tools'] as const,
    detail: (name: string) => ['tools', name] as const,
  },
};
