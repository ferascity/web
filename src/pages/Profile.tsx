import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { BetaCreditsCard } from '../components/BetaCreditsCard';
import {
  getCachedPositions,
  getPositions,
  type SettlementKind,
} from '../lib/api/positions';
import {
  formatMultiplier,
  formatRelativeTime,
  formatUsdc,
  shortAddress,
} from '../lib/format';
import { useWallet } from '../lib/wallet';
import type { MarketPosition } from '../lib/types';

type AsyncStatus = 'idle' | 'loading' | 'ready' | 'error';

export function Profile() {
  const {
    ready,
    authDelayed,
    authenticated,
    walletLoading,
    address,
    userLabel,
    solBalance,
    usdcBalance,
    balanceStatus,
    balanceRefreshing,
    balanceError,
    refreshBalances,
    login,
    logout,
    createWallet,
    settlePosition,
    requestDevnetSol,
  } = useWallet();

  const [copied, setCopied] = useState(false);
  const [positions, setPositions] = useState<MarketPosition[]>(
    () => getCachedPositions(address) ?? [],
  );
  const [positionsStatus, setPositionsStatus] = useState<AsyncStatus>(() =>
    getCachedPositions(address) ? 'ready' : address ? 'loading' : 'idle',
  );
  const [positionsRefreshing, setPositionsRefreshing] = useState(false);
  const [positionsError, setPositionsError] = useState<string | null>(null);
  const [positionsNonce, setPositionsNonce] = useState(0);

  const [airdropStatus, setAirdropStatus] = useState<AsyncStatus>('idle');
  const [airdropMessage, setAirdropMessage] = useState<string | null>(null);
  const [walletStatus, setWalletStatus] = useState<AsyncStatus>('idle');
  const [walletMessage, setWalletMessage] = useState<string | null>(null);

  const [settlingId, setSettlingId] = useState<string | null>(null);
  const [settleNotice, setSettleNotice] = useState<{
    tone: 'success' | 'error';
    text: string;
  } | null>(null);

  useEffect(() => {
    if (!address) {
      setPositions([]);
      setPositionsStatus('idle');
      setPositionsRefreshing(false);
      setPositionsError(null);
      return;
    }

    let cancelled = false;
    const cached = getCachedPositions(address);
    if (cached) {
      setPositions(cached);
      setPositionsStatus('ready');
      setPositionsRefreshing(true);
    } else {
      setPositionsStatus('loading');
    }
    setPositionsError(null);

    getPositions(address)
      .then((list) => {
        if (cancelled) return;
        setPositions(list);
        setPositionsStatus('ready');
        setPositionsRefreshing(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPositionsRefreshing(false);
        if (!getCachedPositions(address)) {
          setPositionsStatus('error');
        }
        setPositionsError(
          error instanceof Error
            ? error.message
            : 'Positions are unavailable right now.',
        );
      });

    return () => {
      cancelled = true;
    };
  }, [address, positionsNonce]);

  const copyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard may be blocked; the address is still selectable.
    }
  };

  const handleAirdrop = async () => {
    setAirdropStatus('loading');
    setAirdropMessage(null);
    try {
      const signature = await requestDevnetSol();
      setAirdropStatus('ready');
      setAirdropMessage(`+1 SOL funded · ${shortAddress(signature, 6)}`);
    } catch (error) {
      setAirdropStatus('error');
      setAirdropMessage(
        error instanceof Error ? error.message : 'The Devnet faucet is unavailable.',
      );
    }
  };

  const handleSettle = async (position: MarketPosition, kind: SettlementKind) => {
    setSettlingId(position.id);
    setSettleNotice(null);
    try {
      const receipt = await settlePosition(position, kind);
      setSettleNotice({
        tone: 'success',
        text:
          kind === 'refund'
            ? `Refund confirmed · ${shortAddress(receipt.signature ?? '', 6)}`
            : `Payout claimed · ${shortAddress(receipt.signature ?? '', 6)}`,
      });
      setPositionsNonce((value) => value + 1);
      refreshBalances();
    } catch (error) {
      setSettleNotice({
        tone: 'error',
        text:
          error instanceof Error
            ? error.message
            : `The ${kind} could not be completed.`,
      });
    } finally {
      setSettlingId(null);
    }
  };

  const handleCreateWallet = async () => {
    setWalletStatus('loading');
    setWalletMessage(null);
    try {
      await createWallet();
      setWalletStatus('ready');
    } catch (error) {
      setWalletStatus('error');
      setWalletMessage(
        error instanceof Error ? error.message : 'The Solana wallet could not be created.',
      );
    }
  };

  const handleRefreshAll = () => {
    refreshBalances();
    setPositionsNonce((value) => value + 1);
  };

  if (!ready) {
    return (
      <div className="page route-view profile-minimal">
        <div className="profile-header-skeleton" aria-hidden="true">
          <div className="skeleton" style={{ height: 28, width: 220 }} />
          <div className="skeleton" style={{ height: 64, marginTop: 24, borderRadius: 12 }} />
          <div className="skeleton" style={{ height: 180, marginTop: 32, borderRadius: 12 }} />
        </div>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="page route-view profile-minimal">
        <div className="card profile-signed-out">
          <img src="/logo.png" alt="" width="48" height="48" />
          <h1>Sign in</h1>
          <p>
            Connect your account to view your balances and settle
            positions.
          </p>
          <button type="button" className="btn btn-primary btn-block" onClick={login}>
            Sign In
          </button>
        </div>

        {authDelayed ? (
          <div className="notice error" style={{ marginTop: 16 }}>
            <Icon name="alert" />
            <span>
              Privy could not initialize on this origin. Add{' '}
              <span className="mono">{window.location.origin}</span> to the allowed
              origins in the Privy dashboard, then reload.
            </span>
          </div>
        ) : null}
      </div>
    );
  }

  const explorerAddress = address
    ? `https://explorer.solana.com/address/${address}?cluster=devnet`
    : null;
  const showPositionSkeletons =
    positions.length === 0 && (positionsStatus === 'loading' || walletLoading);
  const showEmptyPositions =
    !walletLoading && positionsStatus === 'ready' && positions.length === 0;
  const refreshingAny =
    balanceStatus === 'loading' ||
    balanceRefreshing ||
    positionsStatus === 'loading' ||
    positionsRefreshing;

  return (
    <div className="page route-view profile-minimal">
      <header className="profile-top">
        <div className="profile-user">
          <span className="profile-avatar">
            {(userLabel ?? 'F').trim().charAt(0).toUpperCase()}
          </span>
          <div className="profile-user-meta">
            <h1>{userLabel ?? 'Feras account'}</h1>
            <div className="profile-address-line">
              {address ? (
                <>
                  <button
                    type="button"
                    className="profile-address-btn mono"
                    onClick={copyAddress}
                    title="Copy Solana address"
                  >
                    {shortAddress(address, 6)}
                    <Icon name={copied ? 'check' : 'copy'} size={12} />
                    {copied ? <span className="copied-tag">Copied</span> : null}
                  </button>
                  {explorerAddress ? (
                    <a
                      className="profile-explorer-link"
                      href={explorerAddress}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="View wallet on Solana Explorer"
                    >
                      <Icon name="external" size={12} />
                    </a>
                  ) : null}
                </>
              ) : (
                <span className="text-tertiary">
                  {walletLoading ? 'Restoring wallet…' : 'No Solana wallet'}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="profile-top-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={handleRefreshAll}
            disabled={!address || refreshingAny}
            aria-label="Refresh balances and positions"
            title="Refresh"
          >
            <Icon name="rewind" />
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => void logout()}
          >
            <Icon name="logout" size={14} />
            Sign out
          </button>
        </div>
      </header>

      <section className="profile-balances" aria-label="Wallet balances">
        <div className="profile-metrics">
          <div className="profile-metric">
            <span className="profile-metric-label">Test-USDC</span>
            <strong className="profile-metric-value mono">
              {balanceStatus === 'loading' || walletLoading
                ? '—'
                : formatUsdc(usdcBalance)}
            </strong>
          </div>
          <div className="profile-metric">
            <span className="profile-metric-label">SOL</span>
            <strong className="profile-metric-value mono">
              {balanceStatus === 'loading' || walletLoading
                ? '—'
                : `${solBalance.toFixed(3)} SOL`}
            </strong>
          </div>
        </div>

        <div className="profile-balance-actions">
          {!address && !walletLoading ? (
            <button
              type="button"
              className="btn btn-accent btn-xs"
              onClick={() => void handleCreateWallet()}
              disabled={walletStatus === 'loading'}
            >
              {walletStatus === 'loading' ? <span className="spinner" /> : null}
              Create wallet
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-secondary btn-xs"
              onClick={() => void handleAirdrop()}
              disabled={!address || airdropStatus === 'loading'}
            >
              {airdropStatus === 'loading' ? (
                <span className="spinner" />
              ) : (
                <Icon name="download" size={13} />
              )}
              Faucet +1 SOL
            </button>
          )}
        </div>
      </section>

      {balanceError || walletMessage || airdropMessage ? (
        <div
          className={`notice ${
            balanceError || walletMessage || airdropStatus === 'error'
              ? 'error'
              : 'success'
          }`}
          style={{ marginTop: 12 }}
        >
          <Icon
            name={
              balanceError || walletMessage || airdropStatus === 'error'
                ? 'alert'
                : 'check'
            }
          />
          <span>{balanceError ?? walletMessage ?? airdropMessage}</span>
        </div>
      ) : null}

      <BetaCreditsCard />

      <section className="profile-positions" aria-label="Market positions">
        <div className="profile-section-head">
          <h2>Positions</h2>
          {positions.length > 0 ? (
            <span className="mono text-tertiary">{positions.length}</span>
          ) : null}
        </div>

        {positionsStatus === 'error' ? (
          <div className="notice error" style={{ marginBottom: 12 }}>
            <Icon name="alert" />
            <span>{positionsError ?? 'Positions are unavailable right now.'}</span>
          </div>
        ) : null}

        {settleNotice ? (
          <div
            className={`notice${settleNotice.tone === 'error' ? ' error' : ' success'}`}
            style={{ marginBottom: 12 }}
          >
            <Icon name={settleNotice.tone === 'error' ? 'alert' : 'check'} />
            <span>{settleNotice.text}</span>
          </div>
        ) : null}

        {showPositionSkeletons ? (
          <div className="position-list">
            {[0, 1, 2].map((index) => (
              <div className="position-row" key={index} aria-hidden="true">
                <div className="skeleton" style={{ width: 46, height: 20 }} />
                <div className="position-main">
                  <div className="skeleton" style={{ height: 13, width: '48%' }} />
                  <div
                    className="skeleton"
                    style={{ height: 10, width: '32%', marginTop: 6 }}
                  />
                </div>
                <div className="skeleton" style={{ width: 56, height: 28 }} />
              </div>
            ))}
          </div>
        ) : null}

        {showEmptyPositions ? (
          <div className="profile-empty">
            <p>No positions yet.</p>
            <Link to="/arena" className="btn btn-secondary btn-xs">
              Open arena
              <Icon name="arrow-right" size={12} />
            </Link>
          </div>
        ) : null}

        {positions.length > 0 ? (
          <div className="position-list">
            {positions.map((position) => (
              <div className="position-row" key={position.id}>
                <span className={`outcome-tag ${position.outcome.toLowerCase()}`}>
                  {position.outcome}
                </span>
                <div className="position-main">
                  <Link
                    to={`/arena?match=${encodeURIComponent(position.matchId)}`}
                    className="position-title"
                  >
                    {position.matchTitle}
                  </Link>
                  <div className="position-meta">
                    <span>{position.selectedAgentName}</span>
                    <span>·</span>
                    <span>{formatRelativeTime(position.placedAt)}</span>
                    <span>·</span>
                    <span>{position.status}</span>
                  </div>
                </div>
                <div className="position-side">
                  <div className="position-stake">{formatUsdc(position.stakeUsdc)}</div>
                  <div
                    className={`position-return${position.status === 'WON' ? ' won' : ''}`}
                  >
                    {position.status === 'WON' || position.status === 'CLAIMED'
                      ? formatUsdc(position.payoutUsdc ?? position.estimatedReturnUsdc)
                      : position.status === 'REFUNDED' || position.status === 'CANCELLED'
                        ? formatUsdc(position.stakeUsdc)
                        : formatMultiplier(position.estimatedMultiplier)}
                  </div>
                </div>
                {position.canClaim || position.canRefund ? (
                  <button
                    type="button"
                    className="btn btn-primary btn-xs position-settle"
                    disabled={settlingId !== null}
                    onClick={() =>
                      handleSettle(position, position.canRefund ? 'refund' : 'claim')
                    }
                  >
                    {settlingId === position.id ? <span className="spinner" /> : null}
                    {settlingId === position.id
                      ? position.canRefund
                        ? 'Refunding'
                        : 'Claiming'
                      : position.canRefund
                        ? 'Refund'
                        : 'Claim'}
                  </button>
                ) : null}
                {position.receipt.explorerUrl ? (
                  <a
                    className="icon-btn"
                    href={position.receipt.explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="View position transaction"
                  >
                    <Icon name="external" />
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
