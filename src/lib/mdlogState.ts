export type MdlogState = {
  lastWriteAt: number;
  heartbeatAt: number;
  expiresAt: number;
};

/**
 * 计算距离 expiresAt 设定的毫秒延迟。
 * 保证延时非负（若已过期则返回 0，立即复查）；上限 clamp 到 2^31 - 1（S4，防止 32 位有符号整数溢出导致忙轮询）。
 */
const MAX_TIMEOUT_MS = 2_147_483_647; // 2^31 - 1

export function computeRecheckDelay(expiresAt: number, now = Date.now()): number {
  const diff = expiresAt - now;
  if (diff <= 0) return 0;
  return Math.min(diff, MAX_TIMEOUT_MS);
}
