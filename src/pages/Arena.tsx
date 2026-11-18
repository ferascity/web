import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AgentRow } from '../components/AgentRow';
import { ChessBoard } from '../components/ChessBoard';
import { Icon } from '../components/Icon';
import { StatusBadge } from '../components/MatchCard';
import {
  formatEval,
  formatMultiplier,
  formatNumber,
  formatUsdc,
} from '../lib/format';
import { getBetaStatus, type BetaStatus } from '../lib/api/beta';
import {
  loadMatch,
  loadMatchReplay,
  subscribeMatchEvents,
} from '../lib/api/matches';
import { useMatches } from '../lib/hooks/useMatches';
import { useWallet } from '../lib/wallet';
import type {
  MarketOutcome,
  Match,
  MoveStep,
  PositionDraft,
  TransactionReceipt,
} from '../lib/types';

const QUICK_AMOUNTS = [1, 5, 10, 25];

function multiplierFor(match: Match, outcome: MarketOutcome): number {
  if (outcome === 'WHITE') return match.marketEstimates.whiteMultiplier;
  if (outcome === 'BLACK') return match.marketEstimates.blackMultiplier;
  return match.marketEstimates.drawMultiplier;
}

function outcomeLabel(outcome: MarketOutcome): string {
  if (outcome === 'WHITE') return 'White';
  if (outcome === 'BLACK') return 'Black';
  return 'Draw';
}

function formatMoveLabel(step: MoveStep | null): string {
  if (!step) return '';
  const moveNum = Math.ceil(step.ply / 2);
  return step.color === 'w' ? `${moveNum}. ${step.san}` : `${moveNum}… ${step.san}`;
}

function formatCountdown(msRemaining: number): string {
  const totalSec = Math.max(0, Math.ceil(msRemaining / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins >= 60) {
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hours}h ${remMins}m`;
  }
  if (mins > 0) {
    return `${mins}m ${String(secs).padStart(2, '0')}s`;
  }
  return `${secs}s`;
}

function mergeMoves(existing: MoveStep[], incoming: MoveStep[]): MoveStep[] {
  if (incoming.length === 0) return existing;
  const byPly = new Map<number, MoveStep>();
  for (const step of existing) byPly.set(step.ply, step);
  for (const step of incoming) byPly.set(step.ply, step);
  return [...byPly.values()].sort((a, b) => a.ply - b.ply);
}

export function Arena() {
  const { matches, loading, error: apiError, reload } = useMatches(undefined, 24);
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    authenticated,
    address,
    usdcBalance,
    solBalance,
    balanceStatus,
    login,
    placePosition,
    topUpTestCredit,
  } = useWallet();

  const requestedId = searchParams.get('match');
  const [deepLinkedMatch, setDeepLinkedMatch] = useState<Match | null>(null);
  const [liveSnapshot, setLiveSnapshot] = useState<Match | null>(null);

  useEffect(() => {
    if (!requestedId || loading) {
      setDeepLinkedMatch(null);
      return;
    }
    if (matches.some((item) => item.id === requestedId)) {
      setDeepLinkedMatch(null);
      return;
    }
    let cancelled = false;
    loadMatch(requestedId)
      .then((result) => {
        if (!cancelled) setDeepLinkedMatch(result);
      })
      .catch(() => {
        if (!cancelled) setDeepLinkedMatch(null);
      });
    return () => {
      cancelled = true;
    };
  }, [requestedId, loading, matches]);

  const baseMatch =
    matches.find((item) => item.id === requestedId) ??
    deepLinkedMatch ??
    matches[0] ??
    null;

  const match: Match | null =
    baseMatch && liveSnapshot && liveSnapshot.id === baseMatch.id
      ? {
          ...baseMatch,
          ...liveSnapshot,
          currentPly: Math.max(baseMatch.currentPly, liveSnapshot.currentPly),
        }
      : baseMatch;

  const [replayMoves, setReplayMoves] = useState<MoveStep[]>([]);
  const [replayStatus, setReplayStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle',
  );
  const moves = replayMoves;

  const [ply, setPly] = useState(0);
  const [playing, setPlaying] = useState(false);
  const followLiveRef = useRef(true);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [outcome, setOutcome] = useState<MarketOutcome>('WHITE');
  const [amount, setAmount] = useState('5');
  const [pending, setPending] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'topup' | 'position'>('idle');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<TransactionReceipt | null>(null);
  const [betaStatus, setBetaStatus] = useState<BetaStatus | null>(null);
  const [betaLoading, setBetaLoading] = useState(false);

  useEffect(() => {
    if (!authenticated || !address) {
      setBetaStatus(null);
      setBetaLoading(false);
      return;
    }
    let cancelled = false;
    setBetaLoading(true);
    getBetaStatus(address)
      .then((next) => {
        if (!cancelled) setBetaStatus(next);
      })
      .catch(() => {
        if (!cancelled) setBetaStatus(null);
      })
      .finally(() => {
        if (!cancelled) setBetaLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authenticated, address]);

  const matchId = baseMatch?.id ?? null;
  const matchStatus = match?.status ?? null;
  const moveCount = moves.length;

  // Reset board & bet form state only when switching to a different match.
  useEffect(() => {
    setLiveSnapshot(null);
    setReplayMoves([]);
    setPly(0);
    setPlaying(false);
    followLiveRef.current = true;
    setOutcome('WHITE');
    setSubmitError(null);
    setReceipt(null);

    if (!matchId) {
      setReplayStatus('idle');
      return;
    }

    let cancelled = false;
    setReplayStatus('loading');

    loadMatchReplay(matchId)
      .then((replay) => {
        if (cancelled) return;
        setReplayMoves(replay.moves);
        setPly(replay.moves.length);
        setReplayStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setReplayStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [matchId]);

  // Keep the board at the latest move as live moves arrive unless the user
  // scrubbed backward to inspect an earlier position.
  useEffect(() => {
    if (followLiveRef.current && !playing) {
      setPly(moveCount);
    }
  }, [moveCount, playing]);

  // Subscribe to real-time SSE move/completion events + periodic match sync
  // while the selected match is UPCOMING or LIVE.
  useEffect(() => {
    if (!matchId || matchStatus === 'COMPLETED') return;

    let cancelled = false;
    const unsubscribe = subscribeMatchEvents(matchId, {
      after: 0,
      onMove: ({ step }) => {
        if (cancelled) return;
        setReplayMoves((prev) => mergeMoves(prev, [step]));
        setReplayStatus('ready');
        setLiveSnapshot((prev) => {
          const base = prev && prev.id === matchId ? prev : baseMatch;
          if (!base) return prev;
          return {
            ...base,
            status: 'LIVE',
            currentPly: Math.max(base.currentPly, step.ply),
            moveCount: Math.max(base.moveCount ?? 0, step.ply),
            currentFen: step.fen,
            evalScore:
              step.evalCentipawns != null
                ? step.evalCentipawns / 100
                : base.evalScore,
            hasReplay: true,
          };
        });
      },
      onCompleted: ({ result }) => {
        if (cancelled) return;
        setLiveSnapshot((prev) => {
          const base = prev && prev.id === matchId ? prev : baseMatch;
          if (!base) return prev;
          return {
            ...base,
            status: 'COMPLETED',
            result: result ?? base.result,
          };
        });
        reload();
      },
    });

    const syncActiveMatch = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      loadMatch(matchId)
        .then((fresh) => {
          if (cancelled || !fresh) return;
          setLiveSnapshot(fresh);
          if (fresh.replay.moves.length > 0) {
            setReplayMoves((prev) => mergeMoves(prev, fresh.replay.moves));
            setReplayStatus('ready');
          }
        })
        .catch(() => {
          // Keep existing state on transient network hiccups.
        });
    };

    const pollTimer = window.setInterval(syncActiveMatch, 4_000);

    return () => {
      cancelled = true;
      unsubscribe();
      window.clearInterval(pollTimer);
    };
  }, [matchId, matchStatus, baseMatch, reload]);

  // Update countdown timer every second while a lock time is approaching.
  useEffect(() => {
    if (!match?.marketLockTime || match.status === 'COMPLETED') return;
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [match?.marketLockTime, match?.status]);

  useEffect(() => {
    if (!playing) return;
    if (ply >= moveCount) {
      setPlaying(false);
      followLiveRef.current = true;
      return;
    }
    const timer = window.setTimeout(() => {
      setPly((value) => {
        const next = Math.min(value + 1, moveCount);
        if (next >= moveCount) followLiveRef.current = true;
        return next;
      });
    }, 850);
    return () => window.clearTimeout(timer);
  }, [playing, ply, moveCount]);

  if (loading && matches.length === 0) {
    return (
      <div className="page route-view">
        <div className="page-head">
          <div>
            <span className="eyebrow">Arena · Solana Devnet</span>
            <h1>The arena</h1>
            <p className="lede">Loading the board and its market…</p>
          </div>
        </div>
        <div className="arena-grid">
          <div className="card arena-main">
            <div className="skeleton" style={{ height: 18, width: '38%' }} />
            <div
              className="skeleton"
              style={{ aspectRatio: '1 / 1', marginTop: 18, borderRadius: 14 }}
            />
          </div>
          <div className="arena-rail">
            <div className="card rail-card">
              <div className="skeleton" style={{ height: 16, width: '42%' }} />
              <div className="skeleton" style={{ height: 58, marginTop: 16 }} />
              <div className="skeleton" style={{ height: 58, marginTop: 9 }} />
            </div>
            <div className="card rail-card">
              <div className="skeleton" style={{ height: 16, width: '42%' }} />
              <div className="skeleton" style={{ height: 58, marginTop: 16 }} />
              <div className="skeleton" style={{ height: 120, marginTop: 12 }} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!match) {
    return (
      <div className="page route-view">
        <div className="page-head">
          <div>
            <span className="eyebrow">Arena · Solana Devnet</span>
            <h1>No markets on the board</h1>
            <p className="lede">
              The arena has nothing scheduled right now. Reload to check again.
            </p>
          </div>
        </div>
        <div className="card empty">
          <span className="empty-icon">
            <Icon name="target" />
          </span>
          <h3>The arena is quiet</h3>
          <p>
            {apiError
              ? 'The Devnet market API could not be reached.'
              : 'No matches were returned by the market API.'}
          </p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={reload}>
            Refresh
          </button>
        </div>
      </div>
    );
  }

  const activeMove = ply > 0 ? moves[ply - 1] : null;
  const moveLabel = formatMoveLabel(activeMove);
  const fen = activeMove
    ? activeMove.fen
    : moves.length > 0
      ? match.replay.initialFen
      : match.currentFen;
  const lastMove = activeMove ? { from: activeMove.from, to: activeMove.to } : null;
  const inCheck = activeMove?.isCheck ?? false;

  const evalScore =
    activeMove?.evalCentipawns != null
      ? activeMove.evalCentipawns / 100
      : match.evalScore;
  const winProbability =
    activeMove?.winProbabilityWhite != null &&
    Number.isFinite(activeMove.winProbabilityWhite)
      ? activeMove.winProbabilityWhite
      : 1 / (1 + Math.pow(10, -evalScore / 4));
  const whitePct = Math.max(0, Math.min(1, winProbability));

  const lockTimeMs = match.marketLockTime
    ? new Date(match.marketLockTime).getTime()
    : null;
  const msUntilLock =
    lockTimeMs != null && Number.isFinite(lockTimeMs) ? lockTimeMs - nowMs : null;
  const lockTimePassed = msUntilLock != null && msUntilLock <= 0;
  const marketCancelled = match.marketStatus === 'CANCELLED';
  const marketSettled =
    match.status === 'COMPLETED' ||
    match.marketStatus === 'SETTLED' ||
    match.marketStatus === 'CLOSED';
  const marketLocked =
    !marketSettled &&
    !marketCancelled &&
    (match.marketStatus === 'LOCKED' || lockTimePassed);

  const stake = Number.parseFloat(amount);
  const validStake = Number.isFinite(stake) && stake >= 0.01;
  const multiplier = multiplierFor(match, outcome);
  const estimatedReturn = validStake ? stake * multiplier : 0;
  const tradable = !marketSettled && !marketCancelled && !marketLocked;
  const balancePending = Boolean(address) && balanceStatus === 'loading';
  const insufficient =
    balanceStatus === 'ready' && validStake && usdcBalance < stake;

  // Private beta: when the tester is short on test-USDC, add the difference from
  // their Devnet SOL so the position still goes through in one flow.
  const rate = betaStatus?.limits.solToUsdcRate ?? 150;
  const minTopUp = betaStatus?.limits.swapMinUsdc ?? 5;
  const maxTopUp = betaStatus?.limits.swapMaxUsdc ?? 100;
  const dailyRemaining = betaStatus?.usage.usdcRemaining ?? maxTopUp;
  const testerReady = betaStatus?.canTopUp === true;
  const shortfall = insufficient ? Math.max(0, stake - usdcBalance) : 0;
  const requestedTopUp = Math.max(minTopUp, Math.ceil(shortfall * 100) / 100);
  const topUpUsdc = Math.min(requestedTopUp, maxTopUp, dailyRemaining);
  const topUpCovers = insufficient && topUpUsdc + 0.000001 >= shortfall;
  const topUpSol = topUpUsdc / rate;
  const enoughSol = solBalance >= topUpSol + 0.005;
  const canTopUp =
    insufficient && testerReady && topUpCovers && enoughSol && betaStatus !== null;

  const canSubmit =
    tradable &&
    authenticated &&
    Boolean(address) &&
    validStake &&
    (!insufficient || canTopUp) &&
    !pending &&
    !balancePending;

  const handleSubmit = async () => {
    if (!authenticated) {
      login();
      return;
    }
    if (!canSubmit) return;

    setSubmitError(null);
    setReceipt(null);
    setPending(true);

    const draft: PositionDraft = {
      matchId: match.id,
      matchTitle: match.title,
      selectedAgentId:
        outcome === 'WHITE'
          ? match.whiteAgent.id
          : outcome === 'BLACK'
            ? match.blackAgent.id
            : '',
      selectedAgentName:
        outcome === 'WHITE'
          ? match.whiteAgent.name
          : outcome === 'BLACK'
            ? match.blackAgent.name
            : 'Draw',
      outcome,
      stakeUsdc: Number(stake.toFixed(2)),
      estimatedMultiplier: multiplier,
    };

    try {
      if (insufficient) {
        setPhase('topup');
        await topUpTestCredit(topUpUsdc);
      }
      setPhase('position');
      const result = await placePosition(draft);
      setReceipt(result);
      setAmount('5');
      loadMatch(match.id)
        .then((fresh) => {
          if (fresh) setLiveSnapshot(fresh);
        })
        .catch(() => {});
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : 'The position could not be placed.',
      );
    } finally {
      setPhase('idle');
      setPending(false);
    }
  };

  let ctaLabel = 'Place position';
  if (!authenticated) ctaLabel = 'Sign in to take a position';
  else if (!address) ctaLabel = 'Preparing wallet…';
  else if (marketCancelled) {
    ctaLabel = 'Market cancelled';
  } else if (marketSettled) {
    ctaLabel = 'Market settled';
  } else if (marketLocked) {
    ctaLabel = 'Market locked · match in play';
  } else if (balancePending) ctaLabel = 'Checking balance…';
  else if (!validStake) ctaLabel = 'Enter a stake';
  else if (insufficient) {
    if (betaLoading) ctaLabel = 'Checking top-up options…';
    else if (canTopUp) {
      ctaLabel = `Take ${outcomeLabel(outcome)} · ${formatUsdc(topUpUsdc)} ≈ ${topUpSol.toFixed(3)} SOL`;
    } else ctaLabel = 'Insufficient Devnet USDC';
  } else if (pending) {
    ctaLabel = phase === 'topup' ? 'Confirm top-up in wallet…' : 'Confirm position in wallet…';
  } else ctaLabel = `Take ${outcomeLabel(outcome)}`;

  const ctaDisabled = pending || (authenticated && !canSubmit);

  let marketBadgeLabel = 'Open';
  if (marketCancelled) marketBadgeLabel = 'Cancelled';
  else if (marketSettled) marketBadgeLabel = 'Settled';
  else if (marketLocked) marketBadgeLabel = 'Locked';
  else if (msUntilLock != null && msUntilLock > 0) {
    marketBadgeLabel = `Open · ${formatCountdown(msUntilLock)}`;
  }

  return (
    <div className="page route-view arena-page">
      <div className="arena-grid">
        <div className="card arena-main">
          <div className="arena-board-head">
            <div className="arena-board-id">
              <div className="arena-board-title">
                {match.whiteAgent.name} <span className="text-faint">vs</span>{' '}
                {match.blackAgent.name}
              </div>
              <div className="arena-board-sub">
                {match.timeControl} · Ply {Math.max(match.currentPly, moves.length)}
                {moveLabel ? ` · ${moveLabel}` : ''}
                {replayStatus === 'loading' && moves.length === 0
                  ? ' · Loading replay…'
                  : replayStatus === 'error' && moves.length === 0
                    ? ' · Replay unavailable'
                    : moves.length === 0 && match.status === 'UPCOMING' && msUntilLock && msUntilLock > 0
                      ? ` · Starts in ${formatCountdown(msUntilLock)}`
                      : moves.length === 0
                        ? ' · Waiting for first move'
                        : ''}
              </div>
            </div>
            <div className="arena-board-tools">
              <StatusBadge match={match} />
              {matches.length > 0 ? (
                <select
                  className="select arena-select"
                  value={match.id}
                  aria-label="Select match"
                  onChange={(event) => {
                    setSearchParams({ match: event.target.value }, { replace: true });
                  }}
                >
                  {matches.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          </div>

          <div className="board-shell">
            <ChessBoard fen={fen} lastMove={lastMove} inCheck={inCheck} />

            <div className="board-controls">
              <div className="board-controls-left">
                <button
                  type="button"
                  className="control-btn"
                  onClick={() => {
                    followLiveRef.current = false;
                    setPlaying(false);
                    setPly(0);
                  }}
                  disabled={moves.length === 0 || ply === 0}
                  aria-label="Go to the starting position"
                >
                  <Icon name="skip-back" size={14} />
                </button>
                <button
                  type="button"
                  className="control-btn"
                  onClick={() => {
                    followLiveRef.current = false;
                    setPlaying(false);
                    setPly((value) => Math.max(0, value - 1));
                  }}
                  disabled={moves.length === 0 || ply === 0}
                  aria-label="Previous move"
                >
                  <Icon name="arrow-left" size={14} />
                </button>
                <button
                  type="button"
                  className="control-btn play"
                  onClick={() => {
                    followLiveRef.current = false;
                    if (ply >= moves.length) setPly(0);
                    setPlaying((value) => !value);
                  }}
                  disabled={moves.length === 0}
                  aria-label={playing ? 'Pause replay' : 'Play replay'}
                >
                  <Icon name={playing ? 'pause' : 'play'} size={14} />
                </button>
                <button
                  type="button"
                  className="control-btn"
                  onClick={() => {
                    setPlaying(false);
                    setPly((value) => {
                      const next = Math.min(moves.length, value + 1);
                      followLiveRef.current = next >= moves.length;
                      return next;
                    });
                  }}
                  disabled={moves.length === 0 || ply >= moves.length}
                  aria-label="Next move"
                >
                  <Icon name="arrow-right" size={14} />
                </button>
                <button
                  type="button"
                  className="control-btn"
                  onClick={() => {
                    followLiveRef.current = true;
                    setPlaying(false);
                    setPly(moves.length);
                  }}
                  disabled={moves.length === 0 || ply >= moves.length}
                  aria-label="Go to the current position"
                >
                  <Icon name="skip-forward" size={14} />
                </button>
              </div>

              <span className="ply-label">
                {moves.length > 0
                  ? `Ply ${ply} / ${moves.length}${moveLabel ? ` · ${moveLabel}` : ''}`
                  : match.currentPly > 0
                    ? `Ply ${match.currentPly}`
                    : 'Not started'}
              </span>

              <div className="eval-bar" title="Evaluation · positive favours White">
                <span>{formatEval(evalScore)}</span>
                <div className="eval-track">
                  <div
                    className="eval-fill"
                    style={{ width: `${(whitePct * 100).toFixed(1)}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <aside className="arena-rail">
          <div className="card rail-card">
            <div className="rail-head">
              <span className="rail-title">Matchup</span>
              <span className="agent-side">Engine</span>
            </div>
            <div className="rail-battle">
              <div className="rail-battle-row">
                <AgentRow agent={match.whiteAgent} side="white" />
                <span className="agent-side">White</span>
              </div>
              <div className="rail-vs">vs</div>
              <div className="rail-battle-row">
                <AgentRow agent={match.blackAgent} side="black" />
                <span className="agent-side">Black</span>
              </div>
            </div>
            <div className="rail-meta">
              <span className="chip">{match.timeControl}</span>
              <span className="chip">
                <Icon name="users" size={12} />
                {formatNumber(match.viewerCount, { compact: true })}
              </span>
              <span className="chip">
                Pool <span className="mono">{formatUsdc(match.poolVolumeUsdc, { compact: true })}</span>
              </span>
            </div>
          </div>

          <div className="card rail-card market-card">
            <div className="rail-head">
              <span className="rail-title">Market</span>
              <span className="badge soft">
                <span className={`dot${tradable ? ' live' : ''}`} />
                {marketBadgeLabel}
              </span>
            </div>

            <div className="outcome-grid">
              {(['WHITE', 'DRAW', 'BLACK'] as MarketOutcome[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`outcome-btn${outcome === value ? ' selected' : ''}`}
                  onClick={() => setOutcome(value)}
                  disabled={!tradable || pending}
                >
                  <span className="outcome-label">{outcomeLabel(value)}</span>
                  <span className="outcome-mult">
                    {formatMultiplier(multiplierFor(match, value))}
                  </span>
                </button>
              ))}
            </div>

            <div className="market-form">
              <div className="field">
                <label className="field-label" htmlFor="stake">
                  Stake
                  <span>
                    {authenticated && address
                      ? `${usdcBalance.toFixed(2)} USDC available`
                      : 'Devnet USDC'}
                  </span>
                </label>
                <div className="amount-wrap">
                  <input
                    id="stake"
                    className="input"
                    inputMode="decimal"
                    autoComplete="off"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    disabled={!tradable || pending}
                  />
                  <span className="amount-suffix">USDC</span>
                </div>
              </div>

              <div className="quick-amounts">
                {QUICK_AMOUNTS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`quick-chip${Number.isFinite(stake) && Math.abs(stake - value) < 0.001 ? ' active' : ''}`}
                    onClick={() => setAmount(String(value))}
                    disabled={!tradable || pending}
                  >
                    ${value}
                  </button>
                ))}
              </div>

              <div className="market-summary">
                <div className="summary-row">
                  <span>Stake</span>
                  <strong>{validStake ? formatUsdc(stake) : '—'}</strong>
                </div>
                <div className="summary-row">
                  <span>Multiplier</span>
                  <strong>{formatMultiplier(multiplier)}</strong>
                </div>
                <div className="summary-row total">
                  <span>Estimated return</span>
                  <strong>{validStake ? formatUsdc(estimatedReturn) : '—'}</strong>
                </div>
              </div>

              {insufficient ? (
                betaLoading ? (
                  <div className="notice">
                    <Icon name="clock" />
                    <span>Checking your beta top-up options…</span>
                  </div>
                ) : canTopUp ? (
                  <div className="notice">
                    <Icon name="sparkles" />
                    <span>
                      You hold {formatUsdc(usdcBalance)} USDC. The remaining{' '}
                      {formatUsdc(topUpUsdc)} is added from your Devnet SOL
                      (≈ {topUpSol.toFixed(3)} SOL) in the same step.
                    </span>
                  </div>
                ) : (
                  <div className="notice error">
                    <Icon name="alert" />
                    <span>
                      {testerReady && !enoughSol
                        ? `You need ≈ ${(topUpSol + 0.005).toFixed(3)} Devnet SOL to cover this top-up and fees. Use the faucet on Profile.`
                        : 'Insufficient Devnet USDC in the connected wallet. You need ' +
                          `${formatUsdc(stake)} and currently hold ${formatUsdc(usdcBalance)}.`}
                    </span>
                  </div>
                )
              ) : null}

              {submitError ? (
                <div className="notice error">
                  <Icon name="alert" />
                  <span>{submitError}</span>
                </div>
              ) : null}

              {receipt ? (
                <div className="notice success">
                  <Icon name="check" />
                  <span>
                    Position placed.{' '}
                    {receipt.explorerUrl ? (
                      <a
                        className="link"
                        href={receipt.explorerUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View transaction
                      </a>
                    ) : null}
                  </span>
                </div>
              ) : null}

              <button
                type="button"
                className="btn btn-accent btn-block"
                onClick={() => void handleSubmit()}
                disabled={ctaDisabled}
              >
                {pending ? <span className="spinner" /> : null}
                {ctaLabel}
              </button>

              <p className="market-note">
                Devnet only. Positions are recorded on Solana and settle when the match
                ends. Multipliers are estimates, not guarantees.
              </p>
            </div>
          </div>

          {/*<div className="arena-side-note">
            <Icon name="shield" />
            <span>
              Non-custodial. Your wallet signs every position and no funds move
              without your approval.
            </span>
          </div>*/}
        </aside>
      </div>
    </div>
  );
}
