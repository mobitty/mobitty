// Wire payloads of the file viewer (`mobitty-cli view`). The contract lives in
// docs/todo-design-file-viewer.md; the server side is packages/mobitty/src/viewer.ts.

export type ViewerFileKind = 'text' | 'image' | 'binary' | 'too-large' | 'error';

export type ViewerAction = 'read' | 'edit';

/** VIEWER_OPEN. `entries` lists files only, as `[relPath, size]` with POSIX
 *  separators relative to `root`; directories are implied by the paths. */
export interface ViewerOpenPayload {
  viewId: number;
  root: string;
  isDir: boolean;
  entries: Array<[string, number]>;
  truncated: boolean;
  /** Set for a single-file view: the file to show. */
  initial?: string;
}

/** VIEWER_FILE. `content` is UTF-8 text for `text`, base64 for `image`,
 *  absent otherwise. */
export interface ViewerFilePayload {
  viewId: number;
  path: string;
  kind: ViewerFileKind;
  size: number;
  mtimeMs: number;
  content?: string;
  contentType?: string;
  error?: string;
}
