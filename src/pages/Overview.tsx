import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { MatchCard, StatusBadge } from '../components/MatchCard';
import { formatMultiplier, formatNumber, formatUsdc } from '../lib/format';
import { useMatches } from '../lib/hooks/useMatches';

export function Overview() {
  const { matches, error, loading, reload } = useMatches(undefined, 3);

  const liveMatches = matches.filter((match) => match.status === 'LIVE');
  const featured = liveMatches[0] ?? matches[0] ?? null;
  const arenaMatches = matches.slice(0, 3);

  const agentIds = new Set<string>();
  let poolVolume = 0;
  let viewers = 0;
  for (const match of matches) {
    agentIds.add(match.whiteAgent.id);
    agentIds.add(match.blackAgent.id);
    poolVolume += match.poolVolumeUsdc;
    viewers += match.viewerCount;
  }

  return (
    <div className="page route-view overview-page">
      <section className="hero">
        <div className="hero-aura" aria-hidden="true" />
        <div className="hero-inner">
          <span className="eyebrow hero-eyebrow">
            <span className="dot live" />
            Live on Solana Devnet
          </span>
          <h1 className="hero-title">
            Machines play.
            <br />
            <span className="hero-em">You decide.</span>
            <span className="hero-caret" aria-hidden="true" />
          </h1>
          <p className="hero-lede">
            Watch autonomous agents fight and take a position on the outcome.
          </p>
          <div className="hero-actions">
            <Link to="/arena" className="btn btn-primary">
              Enter the arena
              <Icon name="arrow-right" className="btn-icon" />
            </Link>
            <Link to="/train" className="btn btn-secondary">
              Train an agent
            </Link>
          </div>
          <div className="hero-trust">
            <span>
              <Icon name="shield" />
              Non-custodial
            </span>
            <span>
              <Icon name="cpu" />
              Autonomous agents
            </span>
            <span>
              <Icon name="chart" />
              On-chain markets
            </span>
          </div>
        </div>

        {featured ? (
          <Link
            to={`/arena?match=${encodeURIComponent(featured.id)}`}
            className="hero-ticker"
            aria-label={`Open ${featured.title}`}
          >
            <StatusBadge match={featured} />
            <span className="hero-ticker-title">{featured.title}</span>
            <span className="hero-ticker-divider" aria-hidden="true" />
            <span className="hero-ticker-matchup">
              {featured.whiteAgent.name}
              <em>vs</em>
              {featured.blackAgent.name}
            </span>
            <span className="hero-ticker-odds mono">
              <span>{formatMultiplier(featured.marketEstimates.whiteMultiplier)}</span>
              <span>{formatMultiplier(featured.marketEstimates.drawMultiplier)}</span>
              <span>{formatMultiplier(featured.marketEstimates.blackMultiplier)}</span>
            </span>
            <span className="hero-ticker-arrow">
              <Icon name="arrow-right" />
            </span>
          </Link>
        ) : loading ? (
          <div className="hero-ticker" aria-hidden="true">
            <span className="skeleton" style={{ width: 84, height: 22, borderRadius: 999 }} />
            <span className="skeleton" style={{ width: 148, height: 14 }} />
            <span className="hero-ticker-divider" />
            <span className="skeleton" style={{ width: 112, height: 14 }} />
            <span className="hero-ticker-arrow">
              <Icon name="arrow-right" />
            </span>
          </div>
        ) : null}
      </section>

      <div className="stats-strip">
        <div className="stat">
          <div className="stat-value mono">
            {loading && matches.length === 0 ? (
              <span
                className="skeleton"
                style={{ display: 'inline-block', width: 32, height: 22, verticalAlign: 'middle' }}
              />
            ) : (
              liveMatches.length
            )}
          </div>
          <div className="stat-label">Live matches</div>
        </div>
        <div className="stat">
          <div className="stat-value mono">
            {loading && matches.length === 0 ? (
              <span
                className="skeleton"
                style={{ display: 'inline-block', width: 32, height: 22, verticalAlign: 'middle' }}
              />
            ) : (
              agentIds.size
            )}
          </div>
          <div className="stat-label">Agents</div>
        </div>
        <div className="stat">
          <div className="stat-value mono">
            {loading && matches.length === 0 ? (
              <span
                className="skeleton"
                style={{ display: 'inline-block', width: 58, height: 22, verticalAlign: 'middle' }}
              />
            ) : (
              formatUsdc(poolVolume, { compact: true })
            )}
          </div>
          <div className="stat-label">Pool volume</div>
        </div>
        <div className="stat">
          <div className="stat-value mono">
            {loading && matches.length === 0 ? (
              <span
                className="skeleton"
                style={{ display: 'inline-block', width: 36, height: 22, verticalAlign: 'middle' }}
              />
            ) : (
              formatNumber(viewers, { compact: true })
            )}
          </div>
          <div className="stat-label">Watching now</div>
        </div>
      </div>

      {error && !loading ? (
        <div className="notice" style={{ marginTop: 18 }}>
          <Icon name="info" />
          <span>
            The Devnet market API is unreachable right now. Markets will reappear
            as soon as the connection recovers.
            <span className="notice-detail"> {error}</span>
          </span>
        </div>
      ) : null}

      <section className="section">
        <div className="section-head">
          <div>
            <span className="section-label">Arena</span>
            <h2>Every game, in motion.</h2>
            <p>
              Follow live positions, replay finished games move by move, and see how
              the market prices each side.
            </p>
          </div>
          <Link to="/arena" className="section-link">
            Open arena
            <Icon name="arrow-right" />
          </Link>
        </div>

        {loading ? (
          <div className="match-grid">
            {[0, 1, 2].map((index) => (
              <div className="card match-card" key={index} aria-hidden="true">
                <div className="skeleton" style={{ height: 16, width: '62%' }} />
                <div className="skeleton" style={{ height: 58, borderRadius: 11 }} />
                <div className="skeleton" style={{ height: 58, borderRadius: 11 }} />
                <div className="skeleton" style={{ height: 30, marginTop: 'auto' }} />
              </div>
            ))}
          </div>
        ) : arenaMatches.length > 0 ? (
          <div className="match-grid">
            {arenaMatches.map((match) => (
              <MatchCard key={match.id} match={match} />
            ))}
          </div>
        ) : (
          <div className="card empty">
            <span className="empty-icon">
              <Icon name="target" />
            </span>
            <h3>No matches on the board</h3>
            <p>
              The arena is quiet right now. Reload to check for newly scheduled
              markets.
            </p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={reload}>
              Refresh
            </button>
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <span className="section-label">How it works</span>
            <h2>Three moves, one arena.</h2>
            <p>
              Feras turns arena into a live market. Agents play, the
              evaluation moves, and positions price the game in real time.
            </p>
          </div>
        </div>

        <div className="value-grid">
          <article className="card value-card">
            <span className="value-icon">
              <Icon name="cpu" />
            </span>
            <h3>Agents compete</h3>
            <p>
              Autonomous engines play full games under tournament time controls.
              Every move is recorded and replayed.
            </p>
            <span className="value-meta">
              <span className="dot" />
              Engine vs engine
            </span>
          </article>

          <article className="card value-card">
            <span className="value-icon">
              <Icon name="chart" />
            </span>
            <h3>Markets price the game</h3>
            <p>
              Take a position on White, Draw, or Black. Multipliers shift with the
              evaluation as the position develops.
            </p>
            <span className="value-meta">
              <span className="dot" />
              Devnet USDC
            </span>
          </article>

          <article className="card value-card">
            <span className="value-icon">
              <Icon name="sparkles" />
            </span>
            <h3>Train and enter</h3>
            <p>
              Shape an agent&apos;s opening book and temperament, then send it to the
              arena to compete for the pool.
            </p>
            <span className="value-meta">
              <Icon name="clock" size={12} />
              Training pipeline · v2
            </span>
          </article>
        </div>
      </section>
    </div>
  );
}
