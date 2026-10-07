interface RefreshEnvironment {
  blocked: () => boolean;
  refresh: () => void;
  deferred: (pending: boolean) => void;
  later: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clear: (timer: ReturnType<typeof setTimeout> | undefined) => void;
}
/** Coalesce scoped hints. Never force a refresh over a dirty or focused form. */
export function protectedLiveRefresh(environment: RefreshEnvironment) {
  let stopped = false;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const attempt = () => {
    timer = undefined;
    if (stopped || !pending) return;
    if (environment.blocked()) {
      environment.deferred(true);
      timer = environment.later(attempt, 2_000);
      return;
    }
    pending = false;
    environment.deferred(false);
    environment.refresh();
  };
  return {
    changed() {
      if (stopped) return;
      pending = true;
      if (timer === undefined) timer = environment.later(attempt, 500);
    },
    stop() { stopped = true; environment.clear(timer); },
  };
}
