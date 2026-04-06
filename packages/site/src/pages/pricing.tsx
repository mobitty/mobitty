import type { ReactNode } from 'react';
import clsx from 'clsx';
import Head from '@docusaurus/Head';
import Layout from '@theme/Layout';
import styles from './pricing.module.css';

interface Plan {
  name: string;
  price: string;
  period: string;
  description: string;
  features: string[];
  cta: string;
  href: string;
  highlighted?: boolean;
  badge?: string;
}

const plans: Plan[] = [
  {
    name: 'Free',
    price: '$0',
    period: 'forever',
    description: 'For non-commercial use.',
    features: [
      'All features — no gating',
      'Community support',
    ],
    cta: 'Get Started',
    href: '/docs/getting-started',
  },
  {
    name: 'Pro',
    price: '$99',
    period: 'one-time',
    description: 'Commercial use for one user.',
    badge: 'Most Popular',
    features: [
      'Lifetime license — no renewal',
      'All future updates included',
      'Priority support',
    ],
    cta: 'Buy License',
    href: 'https://buy.stripe.com/14A4gr3Ua0hCamwdlaejK00',
    highlighted: true,
  },
  {
    name: 'Team',
    price: '$8',
    period: '/user/month',
    description: 'For companies.',
    features: [
      'Flexible seat management and billing',
      'Priority support',
    ],
    cta: 'Buy License',
    href: 'https://buy.stripe.com/7sY5kv3UaggAamwbd2ejK01',
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    period: '',
    description: 'For large organizations with custom needs.',
    features: [
      'Custom terms',
      'Dedicated support',
    ],
    cta: 'Contact Sales',
    href: 'mailto:hello@mobitty.dev',
  },
];

interface FaqItem {
  question: string;
  answer: ReactNode;
}

const faqItems: FaqItem[] = [
  {
    question: 'Which AI agents work with Mobitty?',
    answer:
      'Any CLI-based AI agent that runs in a terminal works with Mobitty — Claude Code, OpenAI Codex, Cursor Agent CLI, and any other terminal-based agent. If it runs in a shell, it runs in Mobitty.',
  },
  {
    question: 'What does "no feature gating" mean?',
    answer:
      'The software is identical across all tiers. Free, Pro, Team, and Enterprise all run the exact same binary with the exact same features. The license determines whether you may use it commercially — not which features you can access.',
  },
  {
    question: 'Why one-time instead of a subscription?',
    answer:
      '$99 once — lifetime commercial-use license for one person, every future update included, no renewal. Most developer tools charge $10–20/month for less. Mobitty pays for itself in a few months and keeps working for years.',
  },
  {
    question: 'What is BSL-1.1?',
    answer:
      <><a href="https://github.com/nicfab/mobitty/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">Business Source License 1.1</a>. You can read, build, and modify the source code. Commercial use requires a license during the BSL period. Four years after each release, that version automatically converts to GPLv2+ — fully open source, forever.</>,
  },
  {
    question: 'Can I self-host for my team?',
    answer:
      'Yes. Mobitty runs entirely on your infrastructure. A Team license covers your seats. There is no cloud dependency — your data never leaves your network.',
  },
  {
    question: 'What happens if Mobitty shuts down?',
    answer:
      'Every version converts to GPLv2+ four years after release. You can fork and maintain it yourself. Your data was always on your server — nothing is lost.',
  },
];

function PricingCard({ plan }: { plan: Plan }) {
  return (
    <div className={clsx(styles.card, plan.highlighted && styles.cardHighlighted)}>
      {plan.badge && <span className={styles.cardBadge}>{plan.badge}</span>}
      <div className={styles.cardHeader}>
        <h3 className={styles.planName}>{plan.name}</h3>
        <div className={styles.priceRow}>
          <span className={styles.price}>{plan.price}</span>
          {plan.period && (
            <span className={clsx(styles.period, plan.highlighted && styles.periodAccent)}>
              {plan.period}
            </span>
          )}
        </div>
        <p className={styles.planDesc}>{plan.description}</p>
      </div>
      <ul className={styles.featureList}>
        {plan.features.map((f) => (
          <li key={f} className={styles.featureItem}>{f}</li>
        ))}
      </ul>
      <a
        href={plan.href}
        className={clsx(styles.ctaButton, plan.highlighted && styles.ctaHighlighted)}
      >
        {plan.cta}
      </a>
    </div>
  );
}

function TrustIndicators() {
  return (
    <section className={styles.trust}>
      <div className={styles.trustGrid}>
        <div className={styles.trustItem}>
          <svg className={styles.trustIcon} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
            <path d="M14 2v6h6" />
            <path d="m9 15 2 2 4-4" />
          </svg>
          <h3 className={styles.trustTitle}>Source-available</h3>
          <p className={styles.trustDesc}>Read every line of code. Audit before you deploy.</p>
        </div>
        <div className={styles.trustItem}>
          <svg className={styles.trustIcon} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
            <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
            <line x1="6" y1="6" x2="6.01" y2="6" />
            <line x1="6" y1="18" x2="6.01" y2="18" />
          </svg>
          <h3 className={styles.trustTitle}>Self-hosted</h3>
          <p className={styles.trustDesc}>Runs on your infrastructure. Data never leaves your network.</p>
        </div>
        <div className={styles.trustItem}>
          <svg className={styles.trustIcon} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
            <path d="m9 12 2 2 4-4" />
          </svg>
          <h3 className={styles.trustTitle}>No vendor lock-in</h3>
          <p className={styles.trustDesc}>BSL-1.1 converts to GPLv2+ after 4 years. Every version becomes fully open source.</p>
        </div>
      </div>
    </section>
  );
}

function FAQ() {
  return (
    <section className={styles.faq}>
      <h2 className={styles.faqTitle}>Frequently Asked Questions</h2>
      <div className={styles.faqList}>
        {faqItems.map((item) => (
          <details key={item.question} className={styles.faqItem}>
            <summary className={styles.faqQuestion}>{item.question}</summary>
            <p className={styles.faqAnswer}>{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'Which AI agents work with Mobitty?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Any CLI-based AI agent that runs in a terminal works with Mobitty — Claude Code, OpenAI Codex, Cursor Agent CLI, and any other terminal-based agent. If it runs in a shell, it runs in Mobitty.',
      },
    },
    {
      '@type': 'Question',
      name: 'What does "no feature gating" mean?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'The software is identical across all tiers. Free, Pro, Team, and Enterprise all run the exact same binary with the exact same features. The license determines whether you may use it commercially — not which features you can access.',
      },
    },
    {
      '@type': 'Question',
      name: 'Why one-time instead of a subscription?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: '$99 once — lifetime commercial-use license for one person, every future update included, no renewal. Most developer tools charge $10–20/month for less. Mobitty pays for itself in a few months and keeps working for years.',
      },
    },
    {
      '@type': 'Question',
      name: 'What is BSL-1.1?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Business Source License 1.1. You can read, build, and modify the source code. Commercial use requires a license during the BSL period. Four years after each release, that version automatically converts to GPLv2+ — fully open source, forever.',
      },
    },
    {
      '@type': 'Question',
      name: 'Can I self-host for my team?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes. Mobitty runs entirely on your infrastructure. A Team license covers your seats. There is no cloud dependency — your data never leaves your network.',
      },
    },
    {
      '@type': 'Question',
      name: 'What happens if Mobitty shuts down?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Every version converts to GPLv2+ four years after release. You can fork and maintain it yourself. Your data was always on your server — nothing is lost.',
      },
    },
  ],
};

export default function Pricing(): JSX.Element {
  return (
    <Layout
      title="Pricing"
      description="Mobitty pricing — free for non-commercial use. $99 one-time Pro license for developers. Team and enterprise plans for commercial use."
    >
      <Head>
        <script type="application/ld+json">{JSON.stringify(faqJsonLd)}</script>
      </Head>
      <main className={styles.main}>
        <section className={styles.hero}>
          <h1 className={styles.title}>Simple, honest pricing</h1>
          <p className={styles.subtitle}>
            No feature gating. No surprises. Pay for a license, not for features.
          </p>
        </section>
        <section className={styles.grid}>
          {plans.map((plan) => (
            <PricingCard key={plan.name} plan={plan} />
          ))}
        </section>
        <TrustIndicators />
        <FAQ />
      </main>
    </Layout>
  );
}
