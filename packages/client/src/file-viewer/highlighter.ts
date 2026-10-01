// Lazy Shiki highlighter for the file viewer. Loaded only through a dynamic
// import from CodeView, so Shiki and its grammars stay out of the main bundle.
//
// The JavaScript regex engine avoids Oniguruma's WASM (no CSP change needed).
// Output is tokens, rendered as React elements by CodeView: React applies the
// token styles through CSSOM, which `style-src 'self'` does not govern —
// `codeToHtml` + `dangerouslySetInnerHTML` would have its inline styles blocked.
// Both themes are emitted as CSS variables (`defaultColor: false`); index.css
// picks one per `prefers-color-scheme`, matching the app's shadcn tokens.

import { createHighlighterCore, type HighlighterCore, type ThemedToken } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import type { LangId } from './languages.ts';

type LangModule = Promise<{ default: unknown }>;

// Static specifiers so Vite emits one lazy chunk per grammar.
const LANG_LOADERS: Record<LangId, () => LangModule> = {
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  docker: () => import('shiki/langs/docker.mjs'),
  dotenv: () => import('shiki/langs/dotenv.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  graphql: () => import('shiki/langs/graphql.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  ini: () => import('shiki/langs/ini.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  jsonc: () => import('shiki/langs/jsonc.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  lua: () => import('shiki/langs/lua.mjs'),
  make: () => import('shiki/langs/make.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  powershell: () => import('shiki/langs/powershell.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  scss: () => import('shiki/langs/scss.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  vue: () => import('shiki/langs/vue.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
};

let highlighterPromise: Promise<HighlighterCore> | null = null;
const langPromises = new Map<LangId, Promise<void>>();

function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighterCore({
    themes: [import('shiki/themes/github-light.mjs'), import('shiki/themes/github-dark.mjs')],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  });
  return highlighterPromise;
}

async function ensureLanguage(highlighter: HighlighterCore, lang: LangId): Promise<void> {
  let pending = langPromises.get(lang);
  if (!pending) {
    pending = LANG_LOADERS[lang]().then(mod => highlighter.loadLanguage(mod.default as Parameters<HighlighterCore['loadLanguage']>[0]));
    // A failed load (chunk fetch error) may be retried on the next request.
    pending.catch(() => langPromises.delete(lang));
    langPromises.set(lang, pending);
  }
  await pending;
}

/** Tokenize `code`; each token carries `htmlStyle` with `--shiki-light*` /
 *  `--shiki-dark*` variables. */
export async function tokenize(code: string, lang: LangId): Promise<ThemedToken[][]> {
  const highlighter = await getHighlighter();
  await ensureLanguage(highlighter, lang);
  return highlighter.codeToTokens(code, {
    lang,
    themes: { light: 'github-light', dark: 'github-dark' },
    defaultColor: false,
  }).tokens;
}
