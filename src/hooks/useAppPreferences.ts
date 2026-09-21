import { useCallback, useEffect, useRef, useState } from "react";
import {
  APP_PREFERENCES_DEFAULT,
  loadAppPreferences,
  saveAppPreference,
  type AppPreferences,
} from "../lib/appPreferences";

/**
 * 界面行为偏好（启动时展开侧栏 / 启动时自动检查更新）。
 * 与 useReaderSettings 同构：挂在共享 settings.json Store 上，启动尽早读盘、改动即落盘。
 * 注意两者都只是**启动偏好**——改它不改当前会话的界面（侧栏的开合只由顶栏 / Ctrl+B 决定）。
 */
export function useAppPreferences(): [AppPreferences, (patch: Partial<AppPreferences>) => void] {
  const [preferences, setPreferencesState] = useState<AppPreferences>(APP_PREFERENCES_DEFAULT);
  /// 本次改动涉及哪些 key（启动时那次异步读盘不是改动，不该回写）
  const pendingKeysRef = useRef<Set<keyof AppPreferences>>(new Set());
  /// 最新一份偏好：异步读盘落地时据此比对，读到的与当前一致就不触发渲染
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;

  // 启动尽早恢复持久化偏好；无记录或读取失败时保持出厂值（loadAppPreferences 已兜底）。
  // 逐字段比对后再决定要不要写 state：读到的就是当前这一份（没存过偏好 / 出厂值）时
  // 一次 setState 都不发——省一次无谓重渲染，也让「没有偏好」的启动与出厂值逐帧一致
  useEffect(() => {
    let cancelled = false;
    void loadAppPreferences().then((loaded) => {
      if (cancelled) return;
      const prev = preferencesRef.current;
      if (
        prev.sidebarOpenOnLaunch === loaded.sidebarOpenOnLaunch &&
        prev.autoCheckUpdates === loaded.autoCheckUpdates
      ) {
        return;
      }
      setPreferencesState(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 落盘挂在 effect 上而不是 setState updater 里：updater 在 StrictMode 下会被调用两次
  // （副作用幂等只是运气好），且它可能早于本次状态真正提交就发起 IPC —— 落盘的内容与
  // 已提交的状态不再是同一份。effect 只在**提交之后**跑，落盘值就是屏幕上的值
  useEffect(() => {
    const keys = [...pendingKeysRef.current];
    if (keys.length === 0) return;
    pendingKeysRef.current.clear();
    void (async () => {
      for (const key of keys) {
        await saveAppPreference(key, preferences[key]);
      }
    })();
  }, [preferences]);

  const setPreferences = useCallback((patch: Partial<AppPreferences>) => {
    for (const key of Object.keys(patch) as (keyof AppPreferences)[]) {
      pendingKeysRef.current.add(key);
    }
    setPreferencesState((prev) => ({ ...prev, ...patch }));
  }, []);

  return [preferences, setPreferences];
}
