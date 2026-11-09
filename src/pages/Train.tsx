import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';

const PIPELINE = [
  {
    title: 'Draft',
    detail: 'Name, engine, opening book and temperament.',
    status: 'Design',
  },
  {
    title: 'Dataset',
    detail: 'Generate training and evaluation games.',
    status: 'Design',
  },
  {
    title: 'Fine-tune',
    detail: 'Run the Feras trainer on your draft.',
    status: 'Planned',
  },
  {
    title: 'Deploy',
    detail: 'Enter the arena and compete for the pool.',
    status: 'Planned',
  },
];

const PREVIEW = [
  { label: 'Base engine', value: 'Stockfish 16' },
  { label: 'Opening book', value: 'Ruy López' },
  { label: 'Temperament', value: 'Sharp · 4 / 5' },
];

export function Train() {
  return (
    <div className="page route-view train-page">
      <div className="page-head">
        <div>
          <span className="eyebrow">Train · Agent lab</span>
          <h1>Shape your agent.</h1>
          <p className="lede">
            Draft an engine, choose its opening repertoire, and set its
            temperament. The training lab is being built now.
          </p>
        </div>
        <div className="page-head-actions">
          <span className="chip">
            <Icon name="clock" size={12} />
            Coming soon
          </span>
        </div>
      </div>

      <div className="train-coming">
        <section className="card train-coming-main">
          <div className="train-coming-aura" aria-hidden="true" />
          <div className="train-coming-copy">
            <span className="badge live">
              <span className="dot live" />
              In development
            </span>
            <h2>
              Your engine.
              <br />
              <span className="train-coming-em">Your temperament.</span>
            </h2>
            <p>
              Soon you will be able to build an agent from the same Stockfish
              family that powers the arena, tune how aggressively it plays, and
              send it into a live market. Training runs, weights, and on-chain
              ownership will arrive together.
            </p>
          </div>

          <div className="train-coming-preview" aria-hidden="true">
            <div className="train-preview-head">
              <span className="train-preview-title">Nightshade</span>
              <span className="badge soft">Draft</span>
            </div>
            <div className="train-preview-elo">
              <span className="mono">1800</span>
              <span>projected rating</span>
            </div>
            <div className="train-preview-rows">
              {PREVIEW.map((row) => (
                <div className="train-preview-row" key={row.label}>
                  <span>{row.label}</span>
                  <strong>{row.value}</strong>
                </div>
              ))}
            </div>
            <div className="train-preview-bar">
              <span style={{ width: '68%' }} />
            </div>
            <div className="train-preview-foot">
              <span>Engine preview</span>
              <span className="mono">68%</span>
            </div>
          </div>

          <div className="train-coming-actions">
            <Link to="/arena" className="btn btn-primary">
              Watch the agents
              <Icon name="arrow-right" className="btn-icon" />
            </Link>
            <Link to="/" className="btn btn-secondary">
              Back to overview
            </Link>
          </div>
        </section>

        <aside className="train-coming-aside">
          <div className="card rail-card">
            <div className="rail-head">
              <span className="rail-title">Build pipeline</span>
              <span className="badge soft">v2</span>
            </div>
            <div className="pipeline">
              {PIPELINE.map((step, index) => (
                <div className="pipeline-step" key={step.title}>
                  <span className="pipeline-num">{index + 1}</span>
                  <div className="pipeline-body">
                    <strong>{step.title}</strong>
                    <span>{step.detail}</span>
                  </div>
                  <span className="train-step-status">{step.status}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card rail-card train-coming-note">
            <div className="rail-head">
              <span className="rail-title">While you wait</span>
              <Icon name="sparkles" size={14} />
            </div>
            <p>
              The arena is live on Solana Devnet. Watch Stockfish personas play,
              replay every move, and take a position on the outcome with test
              credit.
            </p>
            <Link to="/arena" className="section-link">
              Open the arena
              <Icon name="arrow-right" />
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
