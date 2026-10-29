// Prettier is ~120 KB gzipped, so it is never in the main bundle: both modules
// are dynamic imports, which Vite emits as separate chunks fetched on the first
// Format click. See `todo-feat-remote-editor-markdown.md`.

let loaded: Promise<(text: string) => Promise<string>> | null = null;

function load(): Promise<(text: string) => Promise<string>> {
  loaded ??= Promise.all([
    import('prettier/standalone'),
    import('prettier/plugins/markdown'),
  ]).then(([prettier, markdown]) => (text: string) => prettier.format(text, {
    parser: 'markdown',
    plugins: [markdown],
    // Agent output and prompts are hand-wrapped (or not wrapped) on purpose;
    // reflowing prose would rewrite every paragraph and bury the real changes.
    proseWrap: 'preserve',
  }));
  // A failed chunk fetch (offline, server restarted with a new build) must not
  // poison every later attempt.
  loaded.catch(() => { loaded = null; });
  return loaded;
}

export async function formatMarkdown(text: string): Promise<string> {
  const format = await load();
  return format(text);
}
