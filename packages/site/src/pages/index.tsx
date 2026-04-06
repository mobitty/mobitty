import Layout from '@theme/Layout';
import TerminalMockup from '../components/TerminalMockup';
import styles from './index.module.css';

/* =========================================================================
   Data
   ========================================================================= */

const primaryFeatures = [
  {
    title: 'AI Agent Integration',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a4 4 0 0 0-4 4v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2h-2V6a4 4 0 0 0-4-4Z" />
        <circle cx="12" cy="15" r="2" />
      </svg>
    ),
    description: 'Paste screenshots to your AI agent. Watch output in real time. Interrupt when needed.',
  },
  {
    title: 'Touch-first Terminal',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2" />
        <path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2" />
        <path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8" />
        <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
      </svg>
    ),
    description: 'Soft keys, macros, gestures. Designed for fingers, not cursors.',
  },
  {
    title: 'Persistent Sessions',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8" />
        <path d="M12 17v4" />
        <path d="M7 8h1" />
        <path d="M7 12h4" />
      </svg>
    ),
    description: 'Sessions survive disconnects. Pick up on any device.',
  },
];

const secondaryFeatures = [
  {
    title: 'Adaptive Protocol',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20h.01" />
        <path d="M2 8.82a15 15 0 0 1 20 0" />
        <path d="M5 12.86a10 10 0 0 1 14 0" />
        <path d="M8.5 16.9a5 5 0 0 1 7 0" />
      </svg>
    ),
    description: 'Adapts to network latency — stays responsive on slow connections.',
  },
  {
    title: 'Image Paste',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
        <circle cx="12" cy="13" r="3" />
      </svg>
    ),
    description: 'Paste screenshots directly into agents running in your terminal.',
  },
  {
    title: 'Remote Editor',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
        <path d="m15 5 4 4" />
      </svg>
    ),
    description: 'Edit remote files with a native-feeling editor from your browser.',
  },
  {
    title: 'PWA Support',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a10 10 0 1 0 10 10H12Z" />
        <path d="M21.18 8.02c-1-2.3-2.85-4.17-5.16-5.18" />
        <path d="M2 12h10" />
        <path d="M12 2v10" />
      </svg>
    ),
    description: 'Installable as a standalone app on mobile and desktop.',
  },
];

/* =========================================================================
   Components
   ========================================================================= */

function Hero() {
  return (
    <header className={styles.hero}>
      <div className={styles.heroInner}>
        <span className={styles.heroBadge}>Source-available &middot; Self-hosted</span>
        <h1 className={styles.heroTitle}>
          Be productive with{'\n'}AI agents from your phone
        </h1>
        <p className={styles.heroSubtitle}>
          A touch-first web terminal for AI agent workflows.{' '}
          Run it on your server. Access from any device.
          <span className={styles.cursorBlink}>_</span>
        </p>
        <div className={styles.heroCta}>
          <a href="/docs/getting-started" className={styles.ctaPrimary}>
            Get Started
          </a>
          <a href="/pricing" className={styles.ctaSecondary}>
            See pricing
          </a>
        </div>
        <p className={styles.heroTrust}>
          BSL-1.1 &middot; Converts to GPLv2+ after 4 years
        </p>
      </div>
    </header>
  );
}

function ProductVisual() {
  return (
    <section className={styles.productVisual}>
      <TerminalMockup />
      <div className={styles.visualPills}>
        <span className={styles.pill}>Touch-first</span>
        <span className={styles.pill}>Persistent sessions</span>
        <span className={styles.pill}>Any device</span>
      </div>
    </section>
  );
}

function AudienceSplit() {
  return (
    <section className={styles.audience}>
      <div className={styles.audienceGrid}>
        {/* Individuals */}
        <div className={styles.audienceCard}>
          <div className={styles.audienceIcon}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 17 10 11 4 5" />
              <line x1="12" y1="19" x2="20" y2="19" />
            </svg>
          </div>
          <h2 className={styles.audienceTitle}>For developers who live in the terminal</h2>
          <ul className={styles.audienceList}>
            <li>Touch-first UX — soft keys, gestures, scroll</li>
            <li>Paste screenshots into AI agents</li>
            <li>Persistent sessions across devices</li>
            <li>PWA — install on your home screen</li>
            <li>Free non-commercial use, $99 lifetime Pro</li>
          </ul>
          <a href="/docs/getting-started" className={styles.audienceCta}>Get started free</a>
        </div>

        {/* Teams */}
        <div className={styles.audienceCard}>
          <div className={styles.audienceIcon}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
              <path d="m9 12 2 2 4-4" />
            </svg>
          </div>
          <h2 className={styles.audienceTitle}>For teams that need control</h2>
          <ul className={styles.audienceList}>
            <li>Self-hosted — data never leaves your network</li>
            <li>Source-available — audit every line</li>
            <li>BSL-1.1 &rarr; GPLv2+ — no vendor lock-in</li>
            <li>Managed seats and volume licensing</li>
            <li>No feature gating between tiers</li>
          </ul>
          <a href="/pricing" className={styles.audienceCta}>See team pricing</a>
        </div>
      </div>
    </section>
  );
}

function Features() {
  return (
    <section className={styles.features}>
      {/* Primary — 3 large cards */}
      <div className={styles.primaryGrid}>
        {primaryFeatures.map((f, idx) => (
          <div
            key={f.title}
            className={styles.primaryCard}
            style={{ animationDelay: `${idx * 100}ms` }}
          >
            <div className={styles.primaryIcon}>{f.icon}</div>
            <h3 className={styles.primaryTitle}>{f.title}</h3>
            <p className={styles.primaryDesc}>{f.description}</p>
          </div>
        ))}
      </div>

      {/* Secondary — 4 compact cards */}
      <div className={styles.secondaryGrid}>
        {secondaryFeatures.map((f, idx) => (
          <div
            key={f.title}
            className={styles.secondaryCard}
            style={{ animationDelay: `${idx * 80}ms` }}
          >
            <div className={styles.secondaryIcon}>{f.icon}</div>
            <h3 className={styles.secondaryTitle}>{f.title}</h3>
            <p className={styles.secondaryDesc}>{f.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function QuickStart() {
  return (
    <section className={styles.quickStart}>
      <h2 className={styles.sectionTitle}>Quick Start</h2>
      <div className={styles.terminalWindow}>
        <div className={styles.terminalBar}>
          <span className={styles.terminalDot} data-color="red" />
          <span className={styles.terminalDot} data-color="yellow" />
          <span className={styles.terminalDot} data-color="green" />
        </div>
        <div className={styles.terminalBody}>
          <div><span className={styles.terminalPrompt}>$</span> npx mobitty --host 0.0.0.0</div>
          <div className={styles.terminalSuccess}>{'\u2714'} Server running at http://192.168.1.42:8000</div>
          <div className={styles.terminalMuted}>  Open this URL on your phone {'\u2191'}</div>
        </div>
      </div>
      <p className={styles.quickStartHint}>
        That&apos;s it. No Docker, no config files, no accounts.
      </p>
    </section>
  );
}

function FinalCta() {
  return (
    <section className={styles.finalCta}>
      <h2 className={styles.finalCtaTitle}>Ready to try?</h2>
      <div className={styles.finalCtaButtons}>
        <a href="/docs/getting-started" className={styles.ctaPrimary}>
          Get Started
        </a>
        <a href="/docs/reference/cli-options" className={styles.ctaSecondary}>
          Read the Docs
        </a>
      </div>
      <p className={styles.finalCtaNote}>
        Free for non-commercial use. $99 lifetime for individuals. Team plans available.
      </p>
      <div className={styles.trustPills}>
        <span className={styles.trustPill}>Source-available</span>
        <span className={styles.trustPill}>Self-hosted</span>
        <span className={styles.trustPill}>BSL-1.1</span>
      </div>
    </section>
  );
}

/* =========================================================================
   Page
   ========================================================================= */

export default function Home(): JSX.Element {
  return (
    <Layout description="Mobitty — a touch-first web terminal for AI coding agents like Claude Code and Codex. Self-hosted, source-available. Access your terminal from any phone or tablet.">
      <main className={styles.main}>
        <Hero />
        <ProductVisual />
        <AudienceSplit />
        <Features />
        <QuickStart />
        <FinalCta />
      </main>
    </Layout>
  );
}
