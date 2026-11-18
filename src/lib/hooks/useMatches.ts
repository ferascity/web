import { useCallback, useEffect, useState } from 'react';
import {
  getCachedMatches,
  loadMatches,
  type MatchesResult,
} from '../api/matches';
import type { MatchStatus } from '../types';

interface MatchesState extends MatchesResult {
  loading: boolean;
}

export function useMatches(status?: MatchStatus, limit = 40, pollIntervalMs = 8_000) {
  const [state, setState] = useState<MatchesState>(() => {
    const cached = getCachedMatches(status, limit);
    if (cached && cached.matches.length > 0) {
      return { ...cached, loading: false };
    }
    return {
      matches: [],
      source: 'live',
      error: null,
      loading: true,
    };
  });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((previous) => {
      if (previous.matches.length > 0) return previous;
      const cached = getCachedMatches(status, limit);
      if (cached && cached.matches.length > 0) {
        return { ...cached, loading: false };
      }
      return { ...previous, loading: true };
    });

    const fetchOnce = () => {
      loadMatches(status, { limit })
        .then((result) => {
          if (cancelled) return;
          setState((previous) => ({
            matches:
              result.error && previous.matches.length > 0
                ? previous.matches
                : result.matches,
            source: 'live',
            error: result.error,
            loading: false,
          }));
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setState((previous) => ({
            matches: previous.matches,
            source: 'live',
            error:
              error instanceof Error
                ? error.message
                : 'The market API could not be reached.',
            loading: false,
          }));
        });
    };

    fetchOnce();

    if (pollIntervalMs <= 0) {
      return () => {
        cancelled = true;
      };
    }

    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      fetchOnce();
    }, pollIntervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [status, limit, pollIntervalMs, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  return { ...state, reload };
}
