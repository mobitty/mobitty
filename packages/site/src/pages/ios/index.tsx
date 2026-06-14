import type { ReactNode } from 'react';
import Layout from '@theme/Layout';

const APP_STORE_URL = ''; // fill in once the listing is live

export default function IOS(): ReactNode {
  return (
    <Layout
      title="Mobitty for iOS"
      description="Mobitty for iOS — a touch-first SSH terminal optimized for AI agent workflows. Long-lived cross-device sessions, an on-screen terminal keyboard with custom chords, parallel multi-URL servers, and a magnifier-loupe selection that works in tmux and vim. Connects to any Mobitty server you self-host."
    >
      <main
        style={{
          maxWidth: 720,
          margin: '0 auto',
          padding: '4rem 1.5rem',
        }}
      >
        <h1>Mobitty for iOS</h1>
        <p
          style={{
            fontSize: '1.15rem',
            color: 'var(--ifm-color-emphasis-700)',
            marginTop: '1.5rem',
          }}
        >
          A touch-first SSH terminal for AI agents. Long-lived cross-device
          sessions, an on-screen terminal keyboard with custom chords, parallel
          multi-URL servers, and a magnifier-loupe selection that works in
          tmux and vim. Connects to any Mobitty server you self-host.
        </p>
        {APP_STORE_URL && (
          <p style={{ marginTop: '2rem' }}>
            <a href={APP_STORE_URL}>Download on the App Store →</a>
          </p>
        )}
        <p style={{ marginTop: '2rem' }}>
          <a href="/docs/guides/ios-app">Read the iOS guide →</a>
        </p>
        <p
          style={{
            marginTop: '3rem',
            color: 'var(--ifm-color-emphasis-600)',
            fontSize: '0.9rem',
          }}
        >
          <a href="https://www.ccswllc.com/privacy">Privacy policy</a>
        </p>
      </main>
    </Layout>
  );
}
