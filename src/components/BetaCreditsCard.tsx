import { useCallback, useEffect, useState } from 'react';
import { Icon } from './Icon';
import {
  getBetaStatus,
  getCachedBetaStatus,
  requestAutoStarterGrant,
  type BetaStatus,
} from '../lib/api/beta';
import { useWallet } from '../lib/wallet';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';
type ClaimState = 'idle' | 'sending' | 'done';
type TopUpState = 'idle' | 'signing' | 'sending' | 'done';

export function BetaCreditsCard() {
  const {
    address,
    authenticated,
    walletLoading,
    refreshBalances,
    topUpTestCredit,
  } = useWallet();

  const [status, setStatus] = useState<BetaStatus | null>(() =>
    getCachedBetaStatus(address),
  );
  const [loadState, setLoadState] = useState<LoadState>(() =>
    getCachedBetaStatus(address) ? 'ready' : address ? 'loading' : 'idle',
  );
  const [error, setError] = useState<string | null>(null);
  const [claimState, setClaimState] = useState<ClaimState>('idle');
  const [claimError, setClaimError] = useState<string | null>(null);
  const [topUpAmount, setTopUpAmount] = useState(10);
  const [topUpState, setTopUpState] = useState<TopUpState>('idle');
  const [topUpError, setTopUpError] = useState<string | null>(null);
  const [topUpSignature, setTopUpSignature] = useState<string | null>(null);

  const load = useCallback(
    async (wallet: string) => {
      const cached = getCachedBetaStatus(wallet);
      if (cached) {
        setStatus(cached);
        setLoadState('ready');
      } else {
        setLoadState('loading');
      }
      setError(null);
      try {
        let next = await getBetaStatus(wallet);
        setStatus(next);
        setLoadState('ready');

        // Automatically fund new wallets with starter credits without requiring
        // an invite code or manual signature.
        if (next.enabled && !next.grant && !next.tester?.blocked && !next.tester?.claimedAt) {
          setClaimState('sending');
          setClaimError(null);
          try {
            const grantRes = await requestAutoStarterGrant(wallet);
            if (grantRes.status === 'CLAIMED') {
              refreshBalances();
            }
            next = await getBetaStatus(wallet);
            setStatus(next);
            setClaimState('done');
          } catch (autoErr) {
            setClaimState('idle');
            setClaimError(
              autoErr instanceof Error
                ? autoErr.message
                : 'Starter credits could not be sent right now.',
            );
          }
        }
      } catch (loadError) {
        if (!getCachedBetaStatus(wallet)) {
          setLoadState('error');
        }
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Beta credits are unavailable right now.',
        );
      }
    },
    [refreshBalances],
  );

  useEffect(() => {
    if (!authenticated || !address) {
      setStatus(null);
      setLoadState('idle');
      return;
    }
    void load(address);
  }, [authenticated, address, load]);

  const handleManualGrantRetry = async () => {
    if (!address || claimState === 'sending') return;
    setClaimError(null);
    setClaimState('sending');
    try {
      await requestAutoStarterGrant(address);
      setClaimState('done');
      refreshBalances();
      const next = await getBetaStatus(address);
      setStatus(next);
    } catch (claimFailure) {
      setClaimState('idle');
      setClaimError(
        claimFailure instanceof Error
          ? claimFailure.message
          : 'Starter credits could not be sent right now.',
      );
    }
  };

  if (!authenticated) return null;
  if (walletLoading || (loadState === 'loading' && !status)) {
    return (
      <div className="profile-strip" aria-hidden="true">
        <span className="skeleton" style={{ height: 16, width: 160 }} />
        <span className="skeleton" style={{ height: 30, width: 220, borderRadius: 999 }} />
      </div>
    );
  }
  if (!address) return null;

  const grant = status?.grant ?? null;
  const confirmed = grant?.status === 'CONFIRMED';
  const pending = grant?.status === 'PENDING' || claimState === 'sending';
  const blocked = status?.tester?.blocked === true;
  const disabled = status ? !status.enabled : false;

  const rate = status?.limits.solToUsdcRate ?? 150;
  const minTopUp = status?.limits.swapMinUsdc ?? 5;
  const maxTopUp = status?.limits.swapMaxUsdc ?? 100;
  const remaining = status?.usage.usdcRemaining ?? maxTopUp;
  const maxAllowed = Math.min(maxTopUp, remaining);
  const topUpOptions = [5, 10, 25].filter((value) => value <= maxAllowed);
  const effectiveTopUp = Math.min(topUpAmount, maxAllowed);
  const topUpBusy = topUpState === 'signing' || topUpState === 'sending';
  const canTopUp = confirmed && status?.canTopUp === true && maxAllowed >= minTopUp;
  const topUpExplorer = topUpSignature
    ? `https://explorer.solana.com/tx/${topUpSignature}?cluster=devnet`
    : null;

  const handleTopUp = async () => {
    if (!address || !canTopUp || topUpBusy) return;
    setTopUpError(null);
    setTopUpState('signing');
    try {
      const result = await topUpTestCredit(effectiveTopUp);
      setTopUpState('sending');
      setTopUpSignature(result.signature);
      setTopUpState('done');
      refreshBalances();
      await load(address);
    } catch (topUpFailure) {
      setTopUpState('idle');
      const message =
        topUpFailure instanceof Error
          ? topUpFailure.message
          : 'The test credit could not be added.';
      setTopUpError(
        /reject|cancel|denied/i.test(message) ? 'Signature request cancelled.' : message,
      );
    }
  };

  if (disabled || blocked) return null;

  if (loadState === 'error') {
    return (
      <div className="profile-strip">
        <span className="text-tertiary">{error ?? 'Beta credits unavailable.'}</span>
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          onClick={() => void load(address)}
        >
          Retry
        </button>
      </div>
    );
  }

  if (confirmed) {
    if (!canTopUp) return null;
    return (
      <div className="profile-strip">
        <div className="profile-strip-label">
          <span>Top up test-USDC</span>
          <span className="mono text-tertiary">
            ${remaining.toFixed(0)} daily limit left
          </span>
        </div>
        <div className="profile-strip-controls">
          <div className="quick-amounts">
            {topUpOptions.map((value) => (
              <button
                key={value}
                type="button"
                className={`quick-chip${effectiveTopUp === value ? ' active' : ''}`}
                onClick={() => setTopUpAmount(value)}
                disabled={topUpBusy}
              >
                +${value}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-xs"
            onClick={() => void handleTopUp()}
            disabled={topUpBusy || effectiveTopUp < minTopUp}
          >
            {topUpBusy ? <span className="spinner" /> : null}
            {topUpState === 'signing'
              ? 'Sign in wallet…'
              : topUpState === 'sending'
                ? 'Adding…'
                : `Add $${effectiveTopUp} · ${(effectiveTopUp / rate).toFixed(3)} SOL`}
          </button>
          {topUpExplorer ? (
            <a
              className="icon-btn"
              href={topUpExplorer}
              target="_blank"
              rel="noreferrer"
              aria-label="View top-up transaction"
            >
              <Icon name="external" />
            </a>
          ) : null}
        </div>
        {topUpError ? (
          <div className="notice error" style={{ width: '100%', marginTop: 8 }}>
            <Icon name="alert" />
            <span>{topUpError}</span>
          </div>
        ) : null}
      </div>
    );
  }

  if (pending) {
    return (
      <div className="profile-strip">
        <div className="profile-strip-label">
          <span className="spinner" />
          <span className="text-secondary">
            Sending {status ? `${status.limits.starterUsdc} USDC + ${status.limits.starterSol} SOL` : 'starter credits'} to your wallet…
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="profile-strip">
      <div className="profile-strip-label">
        <span>Starter credits</span>
        <span className="text-tertiary">
          {status
            ? `${status.limits.starterUsdc} USDC + ${status.limits.starterSol} SOL`
            : '25 USDC + 0.25 SOL'}
        </span>
      </div>
      <div className="profile-strip-controls">
        <button
          type="button"
          className="btn btn-accent btn-xs"
          onClick={() => void handleManualGrantRetry()}
        >
          Claim free {status?.limits.starterUsdc ?? 25} USDC
        </button>
      </div>
      {claimError ? (
        <div className="notice error" style={{ width: '100%', marginTop: 8 }}>
          <Icon name="alert" />
          <span>{claimError}</span>
        </div>
      ) : null}
    </div>
  );
}
