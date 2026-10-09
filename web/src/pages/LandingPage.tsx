import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import "../styles/pages/landing-page.css";

export default function LandingPage() {
  const { ready, user } = useAuth();
  const primaryTo = ready && user ? "/strategies" : "/login";
  const primaryLabel = ready && user ? "Open terminal" : "Get started";

  return (
    <div className="landing">
      <header className="landing-top">
        <Link to="/" className="landing-brand" aria-label="Finhubkh home">
          Finhubkh
        </Link>
        <nav className="landing-nav">
          {ready && user ? (
            <Link to="/strategies" className="landing-nav-link">
              Strategies
            </Link>
          ) : (
            <Link to="/login" className="landing-nav-link">
              Sign in
            </Link>
          )}
          <Link to={primaryTo} className="landing-nav-cta">
            {primaryLabel}
          </Link>
        </nav>
      </header>

      <main className="landing-hero">
        <div className="landing-hero-copy">
          <p className="landing-eyebrow">Chart terminal</p>
          <h1 className="landing-title">
            Finhubkh
          </h1>
          <p className="landing-lede">
            Multi-pair charts, period replay, drawings, and strategy workspaces —
            built for traders who practice before they risk.
          </p>
          <div className="landing-cta-row">
            <Link to={primaryTo} className="landing-btn primary">
              {primaryLabel}
            </Link>
            {!user && (
              <Link to="/login" className="landing-btn ghost">
                Sign in
              </Link>
            )}
          </div>
        </div>

        <div className="landing-hero-visual" aria-hidden="true">
          <div className="landing-chart-frame">
            <div className="landing-chart-grid" />
            <svg
              className="landing-candles"
              viewBox="0 0 420 240"
              preserveAspectRatio="none"
            >
              <polyline
                className="landing-line"
                points="8,170 48,155 88,162 128,120 168,132 208,98 248,110 288,72 328,88 368,54 408,66"
              />
              {[
                [40, 140, 165, 150],
                [80, 148, 170, 155],
                [120, 110, 145, 130],
                [160, 118, 150, 135],
                [200, 88, 125, 105],
                [240, 95, 128, 112],
                [280, 62, 95, 80],
                [320, 70, 105, 90],
                [360, 48, 78, 65],
              ].map(([x, high, low, close], i) => {
                const open = close + (i % 2 === 0 ? 12 : -10);
                const up = close <= open;
                return (
                  <g key={x} className={up ? "up" : "down"}>
                    <line x1={x} y1={high} x2={x} y2={low} />
                    <rect
                      x={x - 6}
                      y={Math.min(open, close)}
                      width="12"
                      height={Math.max(4, Math.abs(open - close))}
                    />
                  </g>
                );
              })}
            </svg>
            <div className="landing-chart-tag">XAUUSD · 1H · Replay</div>
          </div>
        </div>
      </main>

      <section className="landing-strip">
        <p>
          <strong>Replay any period</strong>
          <span>Walk price forward bar by bar</span>
        </p>
        <p>
          <strong>Save strategies</strong>
          <span>Drawings, notes, and backtests per workspace</span>
        </p>
        <p>
          <strong>Multi-pair</strong>
          <span>Gold, FX, crypto, and indices from one terminal</span>
        </p>
      </section>

      <footer className="landing-foot">
        <span>© {new Date().getFullYear()} Finhubkh</span>
        <Link to="/login">Member sign in</Link>
      </footer>
    </div>
  );
}
