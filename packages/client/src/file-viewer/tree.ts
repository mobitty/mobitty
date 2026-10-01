// Builds the viewer's file tree from the flat VIEWER_OPEN listing. Pure — no
// imports with runtime effect, so `node --test` can load it directly.

export interface FileNode {
  name: string;
  /** Path relative to the view root, POSIX separators. */
  path: string;
  size: number;
}

export interface DirNode {
  name: string;
  /** Path relative to the view root; `''` for the root itself. */
  path: string;
  dirs: DirNode[];
  files: FileNode[];
}

export type TreeRow =
  | { kind: 'dir'; node: DirNode; depth: number; expanded: boolean }
  | { kind: 'file'; node: FileNode; depth: number };

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function compareNames(a: { name: string }, b: { name: string }): number {
  return collator.compare(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

/** Directories first, then files, each sorted by name (natural, case-insensitive). */
export function buildTree(entries: ReadonlyArray<readonly [string, number]>): DirNode {
  const root: DirNode = { name: '', path: '', dirs: [], files: [] };
  const dirIndex = new Map<string, DirNode>([['', root]]);

  const ensureDir = (path: string): DirNode => {
    const existing = dirIndex.get(path);
    if (existing) return existing;
    const slash = path.lastIndexOf('/');
    const parent = ensureDir(slash === -1 ? '' : path.slice(0, slash));
    const node: DirNode = { name: path.slice(slash + 1), path, dirs: [], files: [] };
    parent.dirs.push(node);
    dirIndex.set(path, node);
    return node;
  };

  for (const [rawPath, size] of entries) {
    const path = rawPath.split('/').filter(Boolean).join('/');
    if (path === '') continue;
    const slash = path.lastIndexOf('/');
    const parent = ensureDir(slash === -1 ? '' : path.slice(0, slash));
    parent.files.push({ name: path.slice(slash + 1), path, size });
  }

  for (const dir of dirIndex.values()) {
    dir.dirs.sort(compareNames);
    dir.files.sort(compareNames);
  }
  return root;
}

export function findDir(root: DirNode, path: string): DirNode | undefined {
  if (path === '') return root;
  let node: DirNode | undefined = root;
  for (const segment of path.split('/')) {
    node = node.dirs.find(d => d.name === segment);
    if (!node) return undefined;
  }
  return node;
}

export function hasFile(root: DirNode, path: string): boolean {
  const slash = path.lastIndexOf('/');
  const dir = findDir(root, slash === -1 ? '' : path.slice(0, slash));
  const name = path.slice(slash + 1);
  return dir?.files.some(f => f.name === name) ?? false;
}

/** Directory paths that must be expanded for `path` to be visible:
 *  `a/b/c.ts` → `['a', 'a/b']`. */
export function ancestorDirs(path: string): string[] {
  const segments = path.split('/');
  const out: string[] = [];
  for (let i = 1; i < segments.length; i++) out.push(segments.slice(0, i).join('/'));
  return out;
}

/** Direct children count, as shown next to a folder on mobile. */
export function childCount(dir: DirNode): number {
  return dir.dirs.length + dir.files.length;
}

/** Rows visible with the given directories expanded, root children at depth 0. */
export function flattenVisible(root: DirNode, expanded: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (dir: DirNode, depth: number): void => {
    for (const sub of dir.dirs) {
      const isOpen = expanded.has(sub.path);
      rows.push({ kind: 'dir', node: sub, depth, expanded: isOpen });
      if (isOpen) walk(sub, depth + 1);
    }
    for (const file of dir.files) rows.push({ kind: 'file', node: file, depth });
  };
  walk(root, 0);
  return rows;
}
