import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Mobitty',
  tagline: 'A touch-first web terminal for AI agent workflows.',
  favicon: 'img/logo.svg',

  headTags: [
    {
      tagName: 'link',
      attributes: {
        rel: 'preconnect',
        href: 'https://fonts.googleapis.com',
      },
    },
    {
      tagName: 'link',
      attributes: {
        rel: 'preconnect',
        href: 'https://fonts.gstatic.com',
        crossorigin: 'anonymous',
      },
    },
    {
      tagName: 'link',
      attributes: {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap',
      },
    },
    {
      tagName: 'link',
      attributes: {
        rel: 'preload',
        as: 'image',
        href: '/img/main-interface.webp',
        type: 'image/webp',
      },
    },
    {
      tagName: 'meta',
      attributes: {
        name: 'keywords',
        content: 'mobitty, web terminal, mobile terminal, SSH, Claude Code, Codex, AI agent, AI coding agent, self-hosted terminal, touch terminal, mobile SSH, browser terminal, terminal emulator, xterm.js, PWA terminal',
      },
    },
    {
      tagName: 'script',
      attributes: { type: 'application/ld+json' },
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: 'Mobitty',
        url: 'https://mobitty.dev',
        description: 'A touch-first web terminal for AI agent workflows.',
        publisher: {
          '@type': 'Organization',
          name: 'CCSW LLC',
          url: 'https://mobitty.dev',
          logo: {
            '@type': 'ImageObject',
            url: 'https://mobitty.dev/img/logo.svg',
          },
          email: 'hello@mobitty.dev',
        },
      }),
    },
    {
      tagName: 'script',
      attributes: { type: 'application/ld+json' },
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: 'Mobitty',
        url: 'https://mobitty.dev',
        description:
          'A touch-first web terminal for AI agent workflows. Self-hosted, source-available. Run AI coding agents like Claude Code and Codex from your phone.',
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'Any (runs in browser)',
        offers: [
          {
            '@type': 'Offer',
            price: '0',
            priceCurrency: 'USD',
            description: 'Free for non-commercial use',
          },
          {
            '@type': 'Offer',
            price: '99',
            priceCurrency: 'USD',
            description:
              'Pro — one-time lifetime license for individual commercial use',
          },
        ],
      }),
    },
  ],

  url: 'https://mobitty.dev',
  baseUrl: '/',

  organizationName: 'mobitty',
  projectName: 'mobitty',

  onBrokenLinks: 'throw',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: undefined,
          lastVersion: 'current',
          versions: {
            current: {
              label: 'Latest',
            },
          },
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themes: [
    [
      '@easyops-cn/docusaurus-search-local',
      {
        hashed: true,
        language: ['en'],
        highlightSearchTermsOnTargetPage: true,
        explicitSearchResultPath: true,
      },
    ],
  ],

  themeConfig: {
    metadata: [
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: 'Mobitty' },
      { property: 'og:image', content: 'https://mobitty.dev/img/social-card.png' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:image', content: 'https://mobitty.dev/img/social-card.png' },
    ],
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Mobitty',
      logo: {
        alt: 'Mobitty',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'right',
          label: 'Docs',
        },
        {
          to: '/ios',
          label: 'iOS',
          position: 'right',
        },
        {
          to: '/pricing',
          label: 'Pricing',
          position: 'right',
        },
        {
          href: 'https://github.com/mobitty/mobitty',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Product',
          items: [
            { label: 'Getting Started', to: '/docs/getting-started' },
            { label: 'Pricing', to: '/pricing' },
          ],
        },
        {
          title: 'Resources',
          items: [
            { label: 'Documentation', to: '/docs/getting-started' },
            {
              label: 'GitHub',
              href: 'https://github.com/mobitty/mobitty',
            },
          ],
        },
        {
          title: 'Company',
          items: [
            { label: 'Contact', href: 'mailto:hello@mobitty.dev' },
            { label: 'License', to: '/docs/license' },
          ],
        },
      ],
      copyright: `Copyright \u00a9 ${new Date().getFullYear()} CCSW LLC. Self-hosted mobile terminal. Source-available.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
