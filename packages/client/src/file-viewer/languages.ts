// File-type detection for the viewer: which Shiki grammar highlights a file,
// and how the meta strip labels it. Pure, so `node --test` can load it; the
// grammar loaders themselves live in highlighter.ts.

/** The curated grammar set. Each id is a module under `shiki/langs/`. */
export const LANG_IDS = [
  'c', 'cpp', 'csharp', 'css', 'diff', 'docker', 'dotenv', 'go', 'graphql', 'html', 'ini',
  'java', 'javascript', 'json', 'jsonc', 'jsx', 'kotlin', 'lua', 'make', 'markdown', 'php',
  'powershell', 'python', 'ruby', 'rust', 'scss', 'shellscript', 'sql', 'swift', 'toml',
  'tsx', 'typescript', 'vue', 'xml', 'yaml',
] as const;

export type LangId = typeof LANG_IDS[number];

const LANG_BY_EXT: Record<string, LangId> = {
  c: 'c', h: 'c',
  cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hh: 'cpp', hpp: 'cpp', hxx: 'cpp', mm: 'cpp',
  cs: 'csharp',
  css: 'css',
  diff: 'diff', patch: 'diff',
  env: 'dotenv',
  go: 'go',
  graphql: 'graphql', gql: 'graphql',
  htm: 'html', html: 'html',
  cfg: 'ini', conf: 'ini', ini: 'ini', properties: 'ini',
  java: 'java',
  cjs: 'javascript', js: 'javascript', mjs: 'javascript',
  json: 'json', webmanifest: 'json',
  jsonc: 'jsonc', json5: 'jsonc',
  jsx: 'jsx',
  kt: 'kotlin', kts: 'kotlin',
  lua: 'lua',
  mk: 'make',
  markdown: 'markdown', md: 'markdown', mdx: 'markdown',
  php: 'php',
  ps1: 'powershell', psm1: 'powershell',
  py: 'python', pyi: 'python',
  rb: 'ruby',
  rs: 'rust',
  scss: 'scss',
  bash: 'shellscript', fish: 'shellscript', ksh: 'shellscript', sh: 'shellscript', zsh: 'shellscript',
  sql: 'sql',
  swift: 'swift',
  toml: 'toml',
  tsx: 'tsx',
  cts: 'typescript', mts: 'typescript', ts: 'typescript',
  vue: 'vue',
  plist: 'xml', svg: 'xml', xml: 'xml', xsd: 'xml', xsl: 'xml',
  yaml: 'yaml', yml: 'yaml',
};

const LANG_BY_NAME: Record<string, LangId> = {
  '.bash_profile': 'shellscript', '.bashrc': 'shellscript', '.profile': 'shellscript',
  '.zprofile': 'shellscript', '.zshenv': 'shellscript', '.zshrc': 'shellscript',
  '.env': 'dotenv',
  '.editorconfig': 'ini', '.gitconfig': 'ini',
  'containerfile': 'docker', 'dockerfile': 'docker',
  'gnumakefile': 'make', 'makefile': 'make',
  'gemfile': 'ruby', 'rakefile': 'ruby',
  'tsconfig.json': 'jsonc', 'jsconfig.json': 'jsonc',
};

/** Fence-info aliases used in Markdown code blocks, beyond the ids themselves. */
const LANG_ALIASES: Record<string, LangId> = {
  'c++': 'cpp', 'c#': 'csharp', dockerfile: 'docker', golang: 'go', js: 'javascript',
  makefile: 'make', md: 'markdown', patch: 'diff', ps: 'powershell', ps1: 'powershell',
  py: 'python', rb: 'ruby', rs: 'rust', bash: 'shellscript', console: 'shellscript',
  sh: 'shellscript', shell: 'shellscript', zsh: 'shellscript', ts: 'typescript',
  yml: 'yaml', svg: 'xml', html5: 'html', json5: 'jsonc', env: 'dotenv',
};

const LANG_LABELS: Record<LangId, string> = {
  c: 'C', cpp: 'C++', csharp: 'C#', css: 'CSS', diff: 'Diff', docker: 'Dockerfile',
  dotenv: 'dotenv', go: 'Go', graphql: 'GraphQL', html: 'HTML', ini: 'INI', java: 'Java',
  javascript: 'JavaScript', json: 'JSON', jsonc: 'JSON with comments', jsx: 'JSX',
  kotlin: 'Kotlin', lua: 'Lua', make: 'Makefile', markdown: 'Markdown', php: 'PHP',
  powershell: 'PowerShell', python: 'Python', ruby: 'Ruby', rust: 'Rust', scss: 'SCSS',
  shellscript: 'Shell', sql: 'SQL', swift: 'Swift', toml: 'TOML', tsx: 'TSX',
  typescript: 'TypeScript', vue: 'Vue', xml: 'XML', yaml: 'YAML',
};

/** Extensions the server previews as images (IMAGE_EXTENSIONS in cli-shared.ts). */
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']);

function fileName(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return path.slice(slash + 1).toLowerCase();
}

function extension(path: string): string {
  const name = fileName(path);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1);
}

export function detectLanguage(path: string): LangId | null {
  const name = fileName(path);
  const byName = LANG_BY_NAME[name];
  if (byName) return byName;
  if (name.startsWith('.env.')) return 'dotenv';
  if (name.startsWith('dockerfile.')) return 'docker';
  return LANG_BY_EXT[extension(path)] ?? null;
}

/** Map a Markdown fence's info string (`ts`, `language-bash`) to a grammar. */
export function languageFromFence(info: string | undefined): LangId | null {
  if (!info) return null;
  const id = info.trim().toLowerCase().replace(/^language-/, '').split(/\s/, 1)[0] ?? '';
  if ((LANG_IDS as readonly string[]).includes(id)) return id as LangId;
  return LANG_ALIASES[id] ?? null;
}

export function isMarkdownPath(path: string): boolean {
  const ext = extension(path);
  return ext === 'md' || ext === 'markdown' || ext === 'mdx';
}

/** Whether the tree shows the image icon. The server decides the real kind. */
export function isImagePath(path: string): boolean {
  return IMAGE_EXTS.has(extension(path));
}

/** Label for the meta strip, e.g. `TypeScript`, `PNG image`, `Plain text`. */
export function fileTypeLabel(path: string, contentType?: string): string {
  if (contentType?.startsWith('image/')) {
    return `${contentType.slice('image/'.length).replace('+xml', '').toUpperCase()} image`;
  }
  const lang = detectLanguage(path);
  return lang ? LANG_LABELS[lang] : 'Plain text';
}
