import { Children, isValidElement, useEffect, type MouseEvent, type ReactElement, type ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ImageOff } from 'lucide-react';
import { openExternalUrl } from '@/open-external-url';
import { CodeView } from './CodeView';
import { languageFromFence } from './languages';
import { isExternalUrl, resolveRelative } from './paths';
import type { ViewerFilePayload } from './types';

interface MarkdownViewProps {
  source: string;
  /** View-relative path of the Markdown file; links resolve against its directory. */
  filePath: string;
  getFile: (path: string) => ViewerFilePayload | undefined;
  hasFile: (path: string) => boolean;
  onRequestFile: (path: string) => void;
  onNavigate: (path: string) => void;
}

/** Rendered Markdown. Raw HTML is not rendered (react-markdown's default), so
 *  nothing reaches the DOM except React elements — no sanitizer, no CSP change. */
export default function MarkdownView({ source, filePath, getFile, hasFile, onRequestFile, onNavigate }: MarkdownViewProps) {
  const components: Components = {
    pre: ({ children }) => {
      const code = Children.toArray(children).find(isValidElement) as
        ReactElement<{ className?: string; children?: ReactNode }> | undefined;
      const text = code ? String(code.props.children ?? '') : '';
      return (
        <div className="my-3 overflow-x-auto rounded-md border border-border bg-card">
          <CodeView code={text} lang={languageFromFence(code?.props.className)} lineNumbers={false} />
        </div>
      );
    },
    img: ({ src, alt }) => (
      <MarkdownImage
        src={typeof src === 'string' ? src : ''}
        alt={alt ?? ''}
        filePath={filePath}
        getFile={getFile}
        hasFile={hasFile}
        onRequestFile={onRequestFile}
      />
    ),
    a: ({ href, children }) => {
      const target = typeof href === 'string' ? href : '';
      const onClick = (e: MouseEvent) => {
        e.preventDefault();
        if (target.startsWith('#')) {
          document.getElementById(decodeURIComponent(target.slice(1)))?.scrollIntoView();
          return;
        }
        if (isExternalUrl(target)) {
          openExternalUrl(target);
          return;
        }
        const rel = resolveRelative(filePath, target);
        if (rel !== null && hasFile(rel)) onNavigate(rel);
      };
      return <a href={target} onClick={onClick}>{children}</a>;
    },
  };

  return (
    <div className="fv-markdown px-5 py-4 md:px-8 md:py-6 max-w-[860px]">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>{source}</Markdown>
    </div>
  );
}

interface MarkdownImageProps {
  src: string;
  alt: string;
  filePath: string;
  getFile: (path: string) => ViewerFilePayload | undefined;
  hasFile: (path: string) => boolean;
  onRequestFile: (path: string) => void;
}

/** Relative images load through the viewer as `data:` URLs. Remote images are
 *  shown as links: the CSP's `img-src` is `'self' data:`. */
function MarkdownImage({ src, alt, filePath, getFile, hasFile, onRequestFile }: MarkdownImageProps) {
  const rel = resolveRelative(filePath, src);
  const known = rel !== null && hasFile(rel);
  const file = known ? getFile(rel) : undefined;

  useEffect(() => {
    if (known && !file && rel !== null) onRequestFile(rel);
  }, [known, file, rel, onRequestFile]);

  if (file?.kind === 'image' && file.content && file.contentType) {
    return <img src={`data:${file.contentType};base64,${file.content}`} alt={alt} className="max-w-full h-auto" />;
  }
  if (isExternalUrl(src)) {
    return (
      <a href={src} onClick={e => { e.preventDefault(); openExternalUrl(src); }}
        className="inline-flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs text-muted-foreground no-underline">
        <ImageOff className="h-3.5 w-3.5" />
        {alt || src}
      </a>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs text-muted-foreground">
      <ImageOff className="h-3.5 w-3.5" />
      {known && !file ? 'Loading…' : (alt || src)}
    </span>
  );
}
