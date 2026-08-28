/**
 * useApproval — 审批交互 Hook。
 *
 * 封装审批操作，提供：
 * - 当前审批项
 * - 超时倒计时
 * - 快捷操作
 *
 * 用法：
 * ```tsx
 * function MyComponent() {
 *   const {
 *     currentApproval,
 *     countdown,
 *     approve,
 *     reject,
 *   } = useApproval();
 *
 *   if (!currentApproval) return null;
 *
 *   return (
 *     <ApprovalDialog
 *       toolName={currentApproval.toolName}
 *       payload={currentApproval.input}
 *       timeoutSeconds={countdown}
 *       onApprove={approve}
 *       onReject={reject}
 *     />
 *   );
 * }
 * ```
 */

import { useCallback, useEffect, useState } from 'react';
import { useApproval } from './ApprovalContext';

/**
 * useApproval 的返回值类型。
 */
export interface UseApprovalReturn {
  /** 当前待审批项（无则 null） */
  currentApproval: ReturnType<typeof useApproval>['currentApproval'];
  /** 剩余超时秒数（-1 表示无超时） */
  countdown: number;
  /** 是否已超时 */
  isExpired: boolean;
  /** 是否正在提交（防止重复点击） */
  isSubmitting: boolean;
  /** 允许当前审批 */
  approve: () => Promise<void>;
  /** 拒绝当前审批 */
  reject: (reason?: string) => Promise<void>;
  /** 是否有待审批 */
  hasPending: boolean;
  /** 待审批数量 */
  pendingCount: number;
}

/**
 * 超时步长（毫秒）
 */
const TICK_MS = 1000;

/**
 * 审批交互 Hook。
 */
export function useApprovalInteraction(): UseApprovalReturn {
  const {
    currentApproval,
    approveCurrent,
    rejectCurrent,
    hasPending,
    pendingCount,
  } = useApproval();

  const [countdown, setCountdown] = useState(-1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [expiredAt, setExpiredAt] = useState<number | null>(null);

  // 超时倒计时
  useEffect(() => {
    if (!currentApproval || currentApproval.timeoutMs === 0) {
      setCountdown(-1);
      setExpiredAt(null);
      return;
    }

    const deadline = currentApproval.createdAt + currentApproval.timeoutMs;

    const tick = () => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setCountdown(remaining);
      if (remaining <= 0 && expiredAt === null) {
        setExpiredAt(Date.now());
      }
    };

    tick(); // 立即执行一次
    const timer = setInterval(tick, TICK_MS);
    return () => clearInterval(timer);
  }, [currentApproval?.rpcId, currentApproval?.timeoutMs, currentApproval?.createdAt, expiredAt]);

  // 阻止审批（超时后自动拒绝）
  useEffect(() => {
    if (!expiredAt || !currentApproval || isSubmitting) return;

    const timer = setTimeout(() => {
      rejectCurrent('timeout');
    }, 0); // 下一个 tick 后执行

    return () => clearTimeout(timer);
  }, [expiredAt, currentApproval, isSubmitting, rejectCurrent]);

  const approve = useCallback(async () => {
    if (!currentApproval || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await approveCurrent();
    } finally {
      setIsSubmitting(false);
    }
  }, [currentApproval, isSubmitting, approveCurrent]);

  const reject = useCallback(
    async (reason?: string) => {
      if (!currentApproval || isSubmitting) return;
      setIsSubmitting(true);
      try {
        await rejectCurrent(reason);
      } finally {
        setIsSubmitting(false);
      }
    },
    [currentApproval, isSubmitting, rejectCurrent],
  );

  return {
    currentApproval,
    countdown,
    isExpired: expiredAt !== null && countdown <= 0,
    isSubmitting,
    approve,
    reject,
    hasPending,
    pendingCount,
  };
}
