// Hook per caricamenti async con stati loading/error/data + reload.
import { useCallback, useEffect, useState, type DependencyList } from 'react';
import { toUserMessage } from '@/lib/errors';

export interface AsyncState<T> {
  loading: boolean;
  error: string | null;
  data: T | null;
}

export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList) {
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<AsyncState<T>>({ loading: true, error: null, data: null });

  useEffect(() => {
    let active = true;
    setState((s) => ({ loading: true, error: null, data: s.data }));
    fn()
      .then((d) => { if (active) setState({ loading: false, error: null, data: d }); })
      .catch((e) => { if (active) setState({ loading: false, error: toUserMessage(e), data: null }); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setData = useCallback(
    (updater: T | ((prev: T | null) => T)) =>
      setState((s) => ({ ...s, data: typeof updater === 'function' ? (updater as (p: T | null) => T)(s.data) : updater })),
    [],
  );

  return { ...state, reload, setData };
}
