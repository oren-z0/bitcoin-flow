import { useEffect } from 'react';
import { useGlobalState } from './useGlobalState';
import {
  clearShareHashFromUrl,
  decompressSharePayload,
  fetchStateFromGist,
  getShareHashFromLocation,
  hasInvalidGistHashFromLocation,
  GIST_FORMAT_HINT,
} from '../utils/shareState';
import { loadSlimState, type LoadProgress } from '../utils/loadSlimState';
import type { SlimState } from '../utils/stateFile';

function hasStoredContent(): boolean {
  const { transactions, addresses } = useGlobalState.getState();
  return (
    Object.keys(transactions).length > 0 ||
    Object.keys(addresses).length > 0
  );
}

async function resolveSharedState(
  share: NonNullable<ReturnType<typeof getShareHashFromLocation>>
): Promise<{ ok: true; state: SlimState } | { ok: false; error: string }> {
  if (share.type === 'compressed') {
    return decompressSharePayload(share.payload);
  }
  return fetchStateFromGist(share.ref);
}

async function tryLoadSharedStateFromHash(
  onProgress?: (progress: LoadProgress) => void
): Promise<void> {
  if (hasInvalidGistHashFromLocation()) {
    clearShareHashFromUrl();
    useGlobalState.getState().addError(GIST_FORMAT_HINT);
    return;
  }

  const share = getShareHashFromLocation();
  if (!share) return;

  const result = await resolveSharedState(share);
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
}

/**
 * When the URL hash is `#z:…` or `#g:username/gist-id` (on load or via hashchange),
 * offer to replace current state and load the shared graph. The hash is always
 * stripped from the URL afterward.
 */
export function useShareLinkFromHash(onProgress?: (progress: LoadProgress) => void) {
  useEffect(() => {
    const handleHash = () => {
      void tryLoadSharedStateFromHash(onProgress);
    };

    handleHash();
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, [onProgress]);
}
