import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSkills, type Skill } from '@/features/skills/useSkills';
import { apiGet, apiPost, apiDelete } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { Button } from '@/components/ui/button';
import { X, Plus, Trash2 } from 'lucide-react';

type SkillDetail = Skill & { body: string; description_zh: string; description_en: string };

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="skills-loading">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="animate-pulse rounded-lg border border-border bg-surface p-5">
          <div className="mb-3 h-5 w-2/3 rounded bg-border" />
          <div className="h-4 w-full rounded bg-border" />
          <div className="mt-2 h-4 w-4/5 rounded bg-border" />
        </div>
      ))}
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-danger/30 bg-danger-bg p-8" data-testid="skills-error">
      <p className="mb-3 text-sm text-danger">{message}</p>
      <button onClick={onRetry} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-fg hover:opacity-90">
        重试
      </button>
    </div>
  );
}

function CreateForm({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [descZh, setDescZh] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!id.trim() || !name.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      await apiPost('/api/skills', { id: id.trim(), name: name.trim(), description_zh: descZh, body });
      queryClient.invalidateQueries({ queryKey: queryKeys.skills.all });
      onClose();
    } catch (err: any) {
      setError(err?.message || '创建失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-border bg-surface p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">创建新技能</h3>
        <button type="button" onClick={onClose} className="p-0.5 rounded hover:bg-surface-hover"><X className="w-4 h-4" /></button>
      </div>
      <input className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm" placeholder="ID（例如：my-skill）" value={id} onChange={e => setId(e.target.value)} required />
      <input className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm" placeholder="名称" value={name} onChange={e => setName(e.target.value)} required />
      <input className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm" placeholder="中文描述（可选）" value={descZh} onChange={e => setDescZh(e.target.value)} />
      <textarea className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm" rows={4} placeholder="正文内容（可选）" value={body} onChange={e => setBody(e.target.value)} />
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button type="submit" disabled={submitting}>{submitting ? '创建中...' : '创建'}</Button>
    </form>
  );
}

function DetailPanel({ skill, onClose }: { skill: SkillDetail; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirm(`确定删除技能 "${skill.name}"？此操作不可撤销。`)) return;
    setDeleting(true);
    try {
      await apiDelete(`/api/skills/${skill.id}`);
      queryClient.invalidateQueries({ queryKey: queryKeys.skills.all });
      onClose();
    } catch {
      // error
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/40" onClick={onClose}>
      <div className="bg-surface border border-border rounded-lg shadow-xl w-full max-w-2xl max-h-[70vh] flex flex-col m-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="text-lg font-semibold">{skill.name}</h2>
            <p className="text-xs text-text-muted mt-0.5">ID: {skill.id} · 来源: {skill.source}</p>
          </div>
          <div className="flex items-center gap-2">
            {skill.source === 'user' && (
              <button onClick={handleDelete} disabled={deleting} className="p-1.5 rounded hover:bg-danger/10 text-danger" title="删除">
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button onClick={onClose} className="p-1.5 rounded hover:bg-surface-hover"><X className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="text-sm text-text-muted mb-4">{skill.description_zh || skill.description || '无描述'}</p>
          <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">正文内容</h4>
          <pre className="text-sm whitespace-pre-wrap font-mono bg-bg rounded-md p-4 border border-border max-h-80 overflow-y-auto">
            {skill.body || '（空）'}
          </pre>
        </div>
      </div>
    </div>
  );
}

export function SkillsPage() {
  const { data: skills, isLoading, isError, error, refetch } = useSkills();
  const [selected, setSelected] = useState<SkillDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [showForm, setShowForm] = useState(false);

  async function openDetail(skill: Skill) {
    setLoadingDetail(true);
    try {
      const data = await apiGet<{ skill: SkillDetail }>(`/api/skills/${skill.id}`);
      setSelected(data.skill);
    } catch {
      // 404 etc — silently close
    } finally {
      setLoadingDetail(false);
    }
  }

  return (
    <div className="p-6" data-testid="page-skills">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text">技能</h1>
          <p className="mt-1 text-sm text-text-muted">
            {skills ? `共 ${skills.length} 个技能` : '管理可用技能'}
          </p>
        </div>
        <button
          onClick={() => { setShowForm(v => !v); }}
          className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-fg hover:opacity-90"
        >
          <Plus className="w-4 h-4" />
          新建技能
        </button>
      </div>

      {showForm && (
        <div className="mb-6">
          <CreateForm onClose={() => setShowForm(false)} />
        </div>
      )}

      {loadingDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
          <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      )}

      {isLoading && <LoadingSkeleton />}
      {isError && (
        <ErrorState
          message={error instanceof Error ? error.message : '加载技能列表失败'}
          onRetry={() => refetch()}
        />
      )}
      {!isLoading && !isError && skills && skills.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border p-12" data-testid="skills-empty">
          <p className="text-sm text-text-muted">暂无技能</p>
          <p className="text-xs text-text-muted mt-1">点击「新建技能」创建第一个</p>
        </div>
      )}
      {!isLoading && !isError && skills && skills.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {skills.map((skill) => (
            <div
              key={skill.id}
              className="cursor-pointer rounded-lg border border-border bg-surface p-5 transition-shadow hover:shadow-md"
              onClick={() => openDetail(skill)}
              data-testid="skill-card"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-base font-semibold text-text">{skill.name}</h3>
                {skill.source && (
                  <span className="shrink-0 rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-fg">
                    {skill.source}
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm text-text-muted line-clamp-2">
                {skill.description || '无描述'}
              </p>
              <p className="mt-2 text-xs text-text-muted/60">ID: {skill.id}</p>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <DetailPanel skill={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
