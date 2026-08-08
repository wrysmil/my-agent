import { useState } from 'react';
import { apiPost } from '@/lib/api';
import { Wifi, Loader2, CheckCircle, XCircle } from 'lucide-react';

type TestStatus = 'idle' | 'testing' | 'success' | 'failed';

export function ProviderTestButton({ providerId }: { providerId: string }) {
  const [status, setStatus] = useState<TestStatus>('idle');
  const [message, setMessage] = useState('');

  async function handleTest() {
    setStatus('testing');
    setMessage('');
    try {
      const res = await apiPost<{ tested: string; reachable: boolean }>(
        `/api/providers/${providerId}/test`,
      );
      if (res.reachable) {
        setStatus('success');
        setMessage('连接成功');
      } else {
        setStatus('failed');
        setMessage('认证失败');
      }
    } catch {
      setStatus('failed');
      setMessage('请求失败');
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={handleTest}
        disabled={status === 'testing'}
        className="text-xs text-text-muted hover:text-text px-2 py-1 rounded border border-border hover:bg-surface-hover inline-flex items-center gap-1 disabled:opacity-50"
      >
        {status === 'testing' ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <Wifi className="w-3 h-3" />
        )}
        {status === 'testing' ? '测试中...' : '测试联通'}
      </button>
      {status === 'success' && (
        <span className="text-xs text-success flex items-center gap-0.5">
          <CheckCircle className="w-3 h-3" />
          {message}
        </span>
      )}
      {status === 'failed' && (
        <span className="text-xs text-danger flex items-center gap-0.5">
          <XCircle className="w-3 h-3" />
          {message}
        </span>
      )}
    </span>
  );
}
