/**
 * Player state hook: re-render on service store changes with selector support.
 * Module-level singleton store → every mounted consumer updates together.
 */
import { useEffect, useState } from 'react';

import { getState, subscribe } from './service';
import type { PlayerState } from './service';

export function usePlayerState<T>(select: (s: PlayerState) => T): T {
  const [value, setValue] = useState<T>(() => select(getState()));
  useEffect(() => {
    const update = () => setValue(select(getState()));
    update();
    return subscribe(update);
    // Selector identity varies per render by design; store is the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return value;
}
