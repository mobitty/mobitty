// The file viewer overlay for `mobitty-cli view`. Desktop (md and up): header,
// 260px tree, preview with a meta strip. Below md: drill-down — one directory
// level per screen, then a full-screen preview. See
// docs/todo-design-file-viewer.md.

import { lazy, Suspense, useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  X, ChevronRight, ChevronLeft, ChevronDown, Folder, File, FileText, FileCode, FileImage, Copy, Pencil, EyeOff,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { buildTree, findDir, hasFile, ancestorDirs, childCount, flattenVisible, type DirNode } from '@/file-viewer/tree';
import { absolutePath, basename, dirname } from '@/file-viewer/paths';
import { detectLanguage, fileTypeLabel, isImagePath, isMarkdownPath } from '@/file-viewer/languages';
import { formatBytes, formatRelativeTime } from '@/file-viewer/format';
import { copyText } from '@/file-viewer/copy';
import { CodeView } from '@/file-viewer/CodeView';
import type { ViewerFileCache } from '@/file-viewer/cache';
import type { ViewerFilePayload, ViewerOpenPayload } from '@/file-viewer/types';

const MarkdownView = lazy(() => import('@/file-viewer/MarkdownView'));

const DESKTOP_QUERY = '(min-width: 768px)';

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
  );
}

export interface FileViewerPanelProps {
  /** Visible. The panel stays mounted while hidden so selection survives a session switch. */
  open: boolean;
  /** Takes keyboard shortcuts; false while the remote editor is stacked on top. */
  active: boolean;
  view: ViewerOpenPayload;
  files: ViewerFileCache;
  /** Bumped whenever `files` changes. */
  filesVersion: number;
  onRequestFile: (path: string) => void;
  onEdit: (path: string) => void;
  /** Collapse to a pill over the terminal; the view stays open. */
  onHide: () => void;
  onClose: () => void;
}

export default function FileViewerPanel({
  open, active, view, files, filesVersion, onRequestFile, onEdit, onHide, onClose,
}: FileViewerPanelProps) {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const tree = useMemo(() => buildTree(view.entries), [view.entries]);
  const [selected, setSelected] = useState<string | null>(view.initial ?? null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(view.initial ? ancestorDirs(view.initial) : []));
  const [mobileDir, setMobileDir] = useState(() => (view.initial ? dirname(view.initial) : ''));
  const [mobilePane, setMobilePane] = useState<'list' | 'preview'>(view.initial ? 'preview' : 'list');

  // `filesVersion` changes whenever the cache does; the cache itself is a stable object.
  const file = useMemo(
    () => (selected ? files.get(selected) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [files, selected, filesVersion],
  );
  const getFile = useCallback(
    (path: string) => files.get(path),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [files, filesVersion],
  );
  // A file view lists only the file itself, but is rooted at its parent so
  // relative Markdown images and links resolve — let the server's
  // confinement decide there rather than the one-entry tree.
  const hasPath = useCallback((path: string) => !view.isDir || hasFile(tree, path), [tree, view.isDir]);

  // Fetch the selected file. Re-runs when the view is replayed after a
  // reconnect (new `view` object), which re-requests anything dropped while
  // the socket was down.
  useEffect(() => {
    if (open && selected && !file) onRequestFile(selected);
  }, [open, selected, file, view, onRequestFile]);

  const select = useCallback((path: string) => {
    setSelected(path);
    setExpanded(prev => {
      const next = new Set(prev);
      for (const dir of ancestorDirs(path)) next.add(dir);
      return next;
    });
    setMobileDir(dirname(path));
    setMobilePane('preview');
  }, []);

  const toggleDir = useCallback((path: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }, []);

  const canEdit = file?.kind === 'text';
  const handleEdit = useCallback(() => {
    if (selected && canEdit) onEdit(selected);
  }, [selected, canEdit, onEdit]);

  useEffect(() => {
    if (!open || !active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, active, onClose]);

  if (!open) return null;

  const rootName = basename(view.root);
  const copyTarget = selected ?? '';

  if (isDesktop) {
    return (
      <div className="absolute inset-0 z-50 bg-background text-foreground flex flex-col">
        <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border">
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground"
            aria-label="Close" title="Close (Esc)" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
          <Breadcrumb root={view.root} selected={selected} />
          <CopyPathMenu root={view.root} relPath={copyTarget}>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Copy className="h-4 w-4" />
              Copy path
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </Button>
          </CopyPathMenu>
          <Button variant="default" size="sm" className="gap-1.5" disabled={!canEdit} onClick={handleEdit}>
            <Pencil className="h-4 w-4" />
            Edit
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" title="Hide to see the terminal" onClick={onHide}>
            <EyeOff className="h-4 w-4" />
            Hide
          </Button>
        </div>
        <div className="flex-1 min-h-0 flex">
          {view.isDir && (
            <nav aria-label="File tree" className="w-[260px] shrink-0 border-r border-border overflow-y-auto py-2">
              <TreeRows tree={tree} expanded={expanded} selected={selected} onSelect={select} onToggle={toggleDir} />
              {view.truncated && <TruncatedNotice count={view.entries.length} />}
            </nav>
          )}
          <Preview
            selected={selected}
            file={file}
            getFile={getFile}
            hasFile={hasPath}
            onRequestFile={onRequestFile}
            onNavigate={select}
          />
        </div>
      </div>
    );
  }

  if (mobilePane === 'list' && view.isDir) {
    const dir = findDir(tree, mobileDir) ?? tree;
    return (
      <div className="absolute inset-0 z-50 bg-background text-foreground flex flex-col">
        <div className="shrink-0 flex items-center gap-1 px-1 py-1 border-b border-border">
          {dir.path !== '' ? (
            <Button variant="ghost" size="icon" className="size-11" aria-label="Back"
              onClick={() => setMobileDir(dirname(dir.path))}>
              <ChevronLeft className="h-5 w-5" />
            </Button>
          ) : <span className="w-3" />}
          <span className="flex-1 min-w-0 truncate text-sm font-semibold">{dir.path === '' ? rootName : dir.name}</span>
          <Button variant="ghost" size="icon" className="size-11" aria-label="Hide" onClick={onHide}>
            <EyeOff className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" className="size-11" aria-label="Close" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          <MobileRows dir={dir} onOpenDir={setMobileDir} onSelect={select} />
          {view.truncated && dir.path === '' && <TruncatedNotice count={view.entries.length} />}
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-50 bg-background text-foreground flex flex-col">
      <div className="shrink-0 flex items-center gap-0.5 px-1 py-1 border-b border-border">
        {view.isDir ? (
          <Button variant="ghost" size="icon" className="size-11" aria-label="Back to files"
            onClick={() => setMobilePane('list')}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
        ) : <span className="w-3" />}
        <span className="flex-1 min-w-0 truncate text-sm font-semibold font-mono">
          {selected ? basename(selected) : rootName}
        </span>
        <CopyPathMenu root={view.root} relPath={copyTarget}>
          <Button variant="ghost" size="icon" className="size-11" aria-label="Copy path">
            <Copy className="h-5 w-5" />
          </Button>
        </CopyPathMenu>
        <Button variant="ghost" size="icon" className="size-11" aria-label="Edit" disabled={!canEdit} onClick={handleEdit}>
          <Pencil className="h-5 w-5" />
        </Button>
        <Button variant="ghost" size="icon" className="size-11" aria-label="Hide" onClick={onHide}>
          <EyeOff className="h-5 w-5" />
        </Button>
        <Button variant="ghost" size="icon" className="size-11" aria-label="Close" onClick={onClose}>
          <X className="h-5 w-5" />
        </Button>
      </div>
      <Preview
        selected={selected}
        file={file}
        getFile={getFile}
        hasFile={hasPath}
        onRequestFile={onRequestFile}
        onNavigate={select}
      />
    </div>
  );
}

// ── Header pieces ───────────────────────────────────────────────────────────

function Breadcrumb({ root, selected }: { root: string; selected: string | null }) {
  const segments = selected ? selected.split('/') : [];
  return (
    <div className="flex-1 min-w-0 truncate font-mono text-[12.5px] text-muted-foreground" title={selected ? absolutePath(root, selected) : root}>
      {root}
      {segments.map((segment, i) => (
        <span key={i}>
          <span className="mx-1.5">/</span>
          <span className={cn(i === segments.length - 1 && 'text-foreground')}>{segment}</span>
        </span>
      ))}
    </div>
  );
}

function CopyPathMenu({ root, relPath, children }: { root: string; relPath: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const copy = async (text: string) => {
    setOpen(false);
    if (await copyText(text)) toast.success('Path copied', { description: text, duration: 1500 });
    else toast.error('Copy failed');
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="end" className="w-44 p-1">
        <button type="button" className="w-full rounded-sm px-2.5 py-2 text-left text-sm hover:bg-accent"
          onClick={() => void copy(absolutePath(root, relPath))}>
          Absolute path
        </button>
        <button type="button" className="w-full rounded-sm px-2.5 py-2 text-left text-sm hover:bg-accent"
          onClick={() => void copy(relPath || '.')}>
          Relative path
        </button>
      </PopoverContent>
    </Popover>
  );
}

// ── Tree (desktop) and list (mobile) ────────────────────────────────────────

function FileIcon({ path, className }: { path: string; className?: string }) {
  if (isImagePath(path)) return <FileImage className={cn('text-purple-300', className)} />;
  if (isMarkdownPath(path) || path.endsWith('.txt')) return <FileText className={cn('text-muted-foreground', className)} />;
  if (detectLanguage(path)) return <FileCode className={cn('text-muted-foreground', className)} />;
  return <File className={cn('text-muted-foreground', className)} />;
}

interface TreeRowsProps {
  tree: DirNode;
  expanded: ReadonlySet<string>;
  selected: string | null;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
}

function TreeRows({ tree, expanded, selected, onSelect, onToggle }: TreeRowsProps) {
  const rows = useMemo(() => flattenVisible(tree, expanded), [tree, expanded]);
  return (
    <div role="tree">
      {rows.map(row => {
        const isSelected = row.kind === 'file' && row.node.path === selected;
        return (
          <button
            key={`${row.kind}:${row.node.path}`}
            type="button"
            role="treeitem"
            aria-expanded={row.kind === 'dir' ? row.expanded : undefined}
            aria-selected={isSelected}
            className={cn(
              'w-full h-7 flex items-center gap-1.5 pr-3 text-[13px] text-left hover:bg-accent/50',
              isSelected && 'bg-accent hover:bg-accent text-foreground',
            )}
            style={{ paddingLeft: 12 + row.depth * 20 }}
            onClick={() => (row.kind === 'dir' ? onToggle(row.node.path) : onSelect(row.node.path))}
          >
            <ChevronRight className={cn(
              'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
              row.kind === 'file' && 'invisible',
              row.kind === 'dir' && row.expanded && 'rotate-90',
            )} />
            {row.kind === 'dir'
              ? <Folder className="h-4 w-4 shrink-0 text-blue-300" />
              : <FileIcon path={row.node.path} className="h-4 w-4 shrink-0" />}
            <span className="truncate">{row.node.name}</span>
          </button>
        );
      })}
    </div>
  );
}

function MobileRows({ dir, onOpenDir, onSelect }: { dir: DirNode; onOpenDir: (path: string) => void; onSelect: (path: string) => void }) {
  return (
    <div>
      {dir.dirs.map(sub => {
        const count = childCount(sub);
        return (
          <button key={sub.path} type="button"
            className="w-full min-h-11 flex items-center gap-3 px-4 text-left text-sm border-b border-border/50 active:bg-accent"
            onClick={() => onOpenDir(sub.path)}>
            <Folder className="h-5 w-5 shrink-0 text-blue-300" />
            <span className="flex-1 min-w-0 truncate">{sub.name}</span>
            <span className="text-xs text-muted-foreground">{count} {count === 1 ? 'item' : 'items'}</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        );
      })}
      {dir.files.map(f => (
        <button key={f.path} type="button"
          className="w-full min-h-11 flex items-center gap-3 px-4 text-left text-sm border-b border-border/50 active:bg-accent"
          onClick={() => onSelect(f.path)}>
          <FileIcon path={f.path} className="h-5 w-5 shrink-0" />
          <span className="flex-1 min-w-0 truncate">{f.name}</span>
          <span className="text-xs text-muted-foreground">{formatBytes(f.size)}</span>
        </button>
      ))}
    </div>
  );
}

function TruncatedNotice({ count }: { count: number }) {
  return (
    <p className="px-4 py-3 text-xs text-muted-foreground">
      Listing stopped at {count.toLocaleString()} files.
    </p>
  );
}

// ── Preview ─────────────────────────────────────────────────────────────────

interface PreviewProps {
  selected: string | null;
  file: ViewerFilePayload | undefined;
  getFile: (path: string) => ViewerFilePayload | undefined;
  hasFile: (path: string) => boolean;
  onRequestFile: (path: string) => void;
  onNavigate: (path: string) => void;
}

function Preview({ selected, file, getFile, hasFile, onRequestFile, onNavigate }: PreviewProps) {
  const [mdMode, setMdMode] = useState<'rendered' | 'source'>('rendered');
  const [dims, setDims] = useState<{ path: string; w: number; h: number } | null>(null);

  if (!selected) return <Placeholder>Select a file to preview</Placeholder>;
  if (!file) return <Placeholder>Loading…</Placeholder>;

  const isMarkdown = file.kind === 'text' && isMarkdownPath(file.path);
  const meta: string[] = [];
  if (file.kind === 'image' && dims?.path === file.path) meta.push(`${dims.w}×${dims.h}`);
  meta.push(formatBytes(file.size));
  if (file.mtimeMs > 0) meta.push(`Modified ${formatRelativeTime(file.mtimeMs)}`);
  meta.push(file.kind === 'binary' ? 'Binary' : fileTypeLabel(file.path, file.contentType));

  return (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col">
      <div className="shrink-0 flex items-center gap-2 px-4 py-1.5 border-b border-border text-xs text-muted-foreground">
        <span className="flex-1 min-w-0 truncate">{meta.join(' · ')}</span>
        {isMarkdown && (
          <div className="shrink-0 flex rounded-md border border-border overflow-hidden">
            {(['rendered', 'source'] as const).map(mode => (
              <button key={mode} type="button"
                className={cn('px-2.5 py-1 text-[11.5px] capitalize', mdMode === mode ? 'bg-accent text-foreground' : 'text-muted-foreground')}
                aria-pressed={mdMode === mode}
                onClick={() => setMdMode(mode)}>
                {mode}
              </button>
            ))}
          </div>
        )}
      </div>
      {/* Keyed on the path so switching files starts at the top. */}
      <div key={file.path} className="flex-1 min-h-0 overflow-auto">
        {file.kind === 'image' && file.content && file.contentType ? (
          <div className="fv-checker min-h-full flex items-center justify-center p-6"
            style={{ touchAction: 'pinch-zoom pan-x pan-y' }}>
            <img
              src={`data:${file.contentType};base64,${file.content}`}
              alt={basename(file.path)}
              className="max-w-full h-auto"
              onLoad={e => setDims({ path: file.path, w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            />
          </div>
        ) : file.kind === 'text' && file.content !== undefined ? (
          isMarkdown && mdMode === 'rendered' ? (
            <Suspense fallback={<Placeholder>Loading…</Placeholder>}>
              <MarkdownView
                source={file.content}
                filePath={file.path}
                getFile={getFile}
                hasFile={hasFile}
                onRequestFile={onRequestFile}
                onNavigate={onNavigate}
              />
            </Suspense>
          ) : detectLanguage(file.path) ? (
            <CodeView code={file.content} lang={detectLanguage(file.path)} />
          ) : (
            <pre className="font-mono text-[13px] leading-5 whitespace-pre-wrap break-words px-4 py-3">{file.content}</pre>
          )
        ) : (
          <Placeholder>{unavailableMessage(file)}</Placeholder>
        )}
      </div>
    </div>
  );
}

function unavailableMessage(file: ViewerFilePayload): string {
  switch (file.kind) {
    case 'binary': return 'Binary file — no preview';
    case 'too-large': return `Too large to preview (${formatBytes(file.size)})`;
    case 'error': return file.error ?? 'Could not read this file';
    default: return 'No preview';
  }
}

function Placeholder({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 min-h-0 flex items-center justify-center p-6 text-sm text-muted-foreground text-center">
      {children}
    </div>
  );
}
