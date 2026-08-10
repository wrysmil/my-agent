import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export interface Skill {
  id: string;
  name: string;
  description: string;
  source: 'builtin' | 'user' | 'marketplace';
  scope: 'builtin' | 'user' | 'marketplace';
}

interface SkillsResponse {
  skills: Skill[];
}

export function useSkills() {
  return useQuery({
    queryKey: queryKeys.skills.all,
    queryFn: () => apiGet<SkillsResponse>('/api/skills'),
    select: (data) => data.skills,
  });
}
