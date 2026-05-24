import { useEffect, useRef } from 'react';
import { useGlobalState } from './useGlobalState';
import {
  clearShareHashFromUrl,
  decompressSharePayload,
  getSharePayloadFromLocation,
} from '../utils/shareState';
import { loadSlimState, type LoadProgress } from '../utils/loadSlimState';

function hasStoredContent(): boolean {
  const { transactions, addresses } = useGlobalState.getState();
  return (
    Object.keys(transactions).length > 0 ||
    Object.keys(addresses).length > 0
  );
}

/**
 * On mount, if the URL hash is `#z:<compressed-state>`, offer to replace current state
 * and load the shared graph. The hash is always stripped from the URL afterward.
 */
export function useShareLinkFromHash(onProgress?: (progress: LoadProgress) => void) {
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;

    const payload = getSharePayloadFromLocation();
    if (!payload) return;

    handled.current = true;

    void (async () => {
      const result = decompressSharePayload(payload);
      clearShareHashFromUrl();

      const { addError, clearState } = useGlobalState.getState();

      if (!result.ok) {
        addError(result.error);
        return;
      }

      if (hasStoredContent()) {
        const confirmed = window.confirm(
          'This page was opened with a shared graph link. Clear your current state and load the shared graph?'
        );
        if (!confirmed) return;
      }

      clearState();
      await loadSlimState(result.state, onProgress);
    })();
  }, [onProgress]);
}
