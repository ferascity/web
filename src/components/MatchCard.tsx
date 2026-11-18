import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Match } from '../lib/types';
import { formatMultiplier, formatNumber, formatUsdc } from '../lib/format';
import { AgentRow } from './AgentRow';
import { Icon } from './Icon';

function formatShortCountdown(msRemaining: number): string {
  const totalSec = Math.max(0, Math.ceil(msRemaining / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins >= 60) {
    const hours = Math.floor(mins / 60);
    return `${hours}h ${mins % 60}m`;
  }
  if (mins > 0) {
    return `${mins}m ${String(secs).padStart(2, '0')}s`;
  }
  return `${secs}s`;
}

export function StatusBadge({ match }: { match: Match }) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (match.status !== 'UPCOMING' || !match.marketLockTime) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [match.status, match.marketLockTime]);

  if (match.status === 'LIVE') {
    return (
      <span className="badge live">
        <span className="dot live" />
        Live
      </span>
    );
  }
  if (match.status === 'UPCOMING') {
    const lockMs = match.marketLockTime ? new Date(match.marketLockTime).getTime() : NaN;
    const diff = Number.isFinite(lockMs) ? lockMs - nowMs : null;
    const label =
      diff != null && diff > 0
        ? `Upcoming · ${formatShortCountdown(diff)}`
        : diff != null && diff <= 0
          ? 'Starting…'
          : 'Upcoming';
    return <span className="badge upcoming mono">{label}</span>;
  }
  return <span className="badge completed">Final</span>;
}

export function MatchCard({ match }: { match: Match }) {
  const completed = match.status === 'COMPLETED';

  return (
    <Link
      to={`/arena?match=${encodeURIComponent(match.id)}`}
      className="card card-hover match-card"
      aria-label={`Open ${match.title}`}
    >
      <div className="match-card-top">
        <div style={{ minWidth: 0 }}>
          <h3 className="match-card-title">{match.title}</h3>
          <p className="match-card-meta">
            {match.timeControl}
            {match.poolVolumeUsdc > 0
              ? ` · Pool ${formatUsdc(match.poolVolumeUsdc, { compact: true })}`
              : ''}
            {match.viewerCount > 0 ? ` · ${formatNumber(match.viewerCount, { compact: true })} watching` : ''}
          </p>
        </div>
        <StatusBadge match={match} />
      </div>

      <div className="match-pair">
        <AgentRow agent={match.whiteAgent} side="white" />
        <div className="match-vs">vs</div>
        <AgentRow agent={match.blackAgent} side="black" />
      </div>

      <div className="match-card-foot">
        {completed && match.result ? (
          <div className="match-card-market">
            <span>Result</span>
            <b>{match.result}</b>
            {match.marketStatus === 'CANCELLED' ? <span>· Refunded</span> : null}
          </div>
        ) : (
          <div className="match-card-market" aria-label="Market multipliers">
            <span title="White">
              <b>W</b> {formatMultiplier(match.marketEstimates.whiteMultiplier)}
            </span>
            <span title="Draw">
              <b>D</b> {formatMultiplier(match.marketEstimates.drawMultiplier)}
            </span>
            <span title="Black">
              <b>B</b> {formatMultiplier(match.marketEstimates.blackMultiplier)}
            </span>
          </div>
        )}
        <span className="match-card-arrow">
          <Icon name="arrow-up-right" />
        </span>
      </div>
    </Link>
  );
}
