import { useState, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import type { SoftkeyConfig, SoftkeyCustomKeySpec, SoftkeyContainerSpec } from '@/profiles';
import { KEY_REGISTRY, BUILTIN_KEY_IDS, validateComboString, comboToDisplayString } from '@/softkey-types';

interface SoftkeyEditorProps {
  softkeys: SoftkeyConfig;
  onChange: (config: SoftkeyConfig) => void;
  defaultPages: string[][];
  defaultCustomKeys: SoftkeyCustomKeySpec[];
}

function getAllAvailableKeyIds(customKeys: SoftkeyCustomKeySpec[], containers?: SoftkeyContainerSpec[]): string[] {
  const ids = [...BUILTIN_KEY_IDS];
  for (const ck of customKeys) {
    if (!ids.includes(ck.id)) ids.push(ck.id);
  }
  if (containers) {
    for (const c of containers) {
      if (!ids.includes(c.id)) ids.push(c.id);
    }
  }
  return ids;
}

function getKeyLabel(keyId: string, customKeys: SoftkeyCustomKeySpec[], containers?: SoftkeyContainerSpec[]): string {
  const reg = KEY_REGISTRY[keyId];
  if (reg) return reg.label;
  const custom = customKeys.find(ck => ck.id === keyId);
  if (custom) return custom.label;
  const container = containers?.find(c => c.id === keyId);
  if (container) return container.label;
  return keyId;
}

// --- PageEditor ---

interface PageEditorProps {
  pageIndex: number;
  keys: string[];
  allKeyIds: string[];
  customKeys: SoftkeyCustomKeySpec[];
  containers?: SoftkeyContainerSpec[];
  onUpdate: (keys: string[]) => void;
  onDelete: () => void;
  canDelete: boolean;
}

function PageEditor({ pageIndex, keys, allKeyIds, customKeys, containers, onUpdate, onDelete, canDelete }: PageEditorProps) {
  const [addKeyId, setAddKeyId] = useState('');

  const removeKey = (idx: number) => {
    onUpdate(keys.filter((_, i) => i !== idx));
  };

  const addBuiltinKey = (value: string) => {
    if (!value) return;
    onUpdate([...keys, value]);
    setAddKeyId('');
  };

  const availableToAdd = allKeyIds.filter(id => !keys.includes(id));

  return (
    <div className="rounded-md border border-border p-2 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground font-medium">Page {pageIndex + 1}</span>
        {canDelete && (
          <Button variant="ghost" size="xs" className="text-destructive" onClick={onDelete}>
            Remove
          </Button>
        )}
      </div>

      {/* Key chips */}
      <div className="flex flex-wrap gap-1">
        {keys.map((keyId, idx) => (
          <Badge key={`${keyId}-${idx}`} variant="secondary" className="text-xs gap-1 pr-1">
            {getKeyLabel(keyId, customKeys, containers)}
            <button
              className="ml-0.5 text-muted-foreground hover:text-foreground"
              onClick={() => removeKey(idx)}
              title="Remove"
            >
              <X className="size-4" />
            </button>
          </Badge>
        ))}
        {keys.length === 0 && (
          <span className="text-xs text-muted-foreground italic">Empty page</span>
        )}
      </div>

      {/* Add key */}
      <div className="flex gap-1">
        <Select value={addKeyId} onValueChange={addBuiltinKey}>
          <SelectTrigger size="sm" className="flex-1 h-7 text-xs">
            <SelectValue placeholder="+ Add key..." />
          </SelectTrigger>
          <SelectContent>
            {availableToAdd.map(id => (
              <SelectItem key={id} value={id}>{id} ({getKeyLabel(id, customKeys, containers)})</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

// --- Auto-populate helpers ---

function comboToAutoId(comboStr: string): string {
  const steps = comboStr.split(/[,\s]+/).filter(s => s.length > 0);
  return steps.map(step => {
    const parts = step.split('+').map(p => p.trim()).filter(p => p.length > 0);
    return parts.map(p => p.toLowerCase()).join('-');
  }).join('-');
}

function comboToAutoLabel(comboStr: string): string {
  const steps = comboStr.split(/[,\s]+/).filter(s => s.length > 0);
  return steps.map(step => {
    const parts = step.split('+').map(p => p.trim()).filter(p => p.length > 0);
    const result: string[] = [];
    for (const part of parts) {
      const lower = part.toLowerCase();
      if (lower === 'ctrl') result.push('C');
      else if (lower === 'alt') result.push('A');
      else if (lower === 'shift') result.push('S');
      else result.push(part);
    }
    return result.join('-');
  }).join(' ');
}

// --- CustomKeyEditor ---

interface CustomKeyEditorProps {
  customKeys: SoftkeyCustomKeySpec[];
  onChange: (keys: SoftkeyCustomKeySpec[]) => void;
}

function CustomKeyEditor({ customKeys, onChange }: CustomKeyEditorProps) {
  const [newId, setNewId] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newCombo, setNewCombo] = useState('');
  const [comboError, setComboError] = useState<string | null>(null);
  const [editingKeyId, setEditingKeyId] = useState<string | null>(null);
  const [idTouched, setIdTouched] = useState(false);
  const [labelTouched, setLabelTouched] = useState(false);

  useEffect(() => {
    const trimmed = newCombo.trim();
    if (trimmed === '') { setComboError(null); return; }
    setComboError(validateComboString(trimmed));
    if (!idTouched) setNewId(comboToAutoId(trimmed));
    if (!labelTouched) setNewLabel(comboToAutoLabel(trimmed));
  }, [newCombo]); // eslint-disable-line react-hooks/exhaustive-deps

  const clearForm = () => {
    setNewId('');
    setNewLabel('');
    setNewCombo('');
    setEditingKeyId(null);
    setIdTouched(false);
    setLabelTouched(false);
  };

  const saveKey = () => {
    const id = newId.trim();
    const label = newLabel.trim();
    const combo = newCombo.split(/[,\s]+/).map(s => s.trim()).filter(s => s.length > 0);
    if (!id || !label || combo.length === 0 || comboError) return;

    if (editingKeyId) {
      onChange(customKeys.map(ck => ck.id === editingKeyId ? { id, label, combo } : ck));
    } else {
      if (customKeys.some(ck => ck.id === id) || BUILTIN_KEY_IDS.has(id)) return;
      onChange([...customKeys, { id, label, combo }]);
    }
    clearForm();
  };

  const editKey = (ck: SoftkeyCustomKeySpec) => {
    setEditingKeyId(ck.id);
    setNewId(ck.id);
    setNewLabel(ck.label);
    setNewCombo(comboToDisplayString(ck.combo));
    setIdTouched(true);
    setLabelTouched(true);
  };

  const removeKey = (id: string) => {
    onChange(customKeys.filter(ck => ck.id !== id));
    if (editingKeyId === id) clearForm();
  };

  const formValid = newId.trim() !== '' && newLabel.trim() !== '' && newCombo.trim() !== '' && !comboError;

  return (
    <div className="space-y-2">
      <Label className="text-xs text-muted-foreground">Custom Keys</Label>

      {customKeys.map(ck => (
        <div key={ck.id} className="flex items-center gap-2 text-xs">
          <Badge variant="outline" className="text-xs">{ck.id}</Badge>
          <span className="text-muted-foreground">{ck.label}</span>
          <span className="text-muted-foreground">= {ck.combo.join(', ')}</span>
          <div className="ml-auto flex gap-1">
            <Button variant="ghost" size="xs" onClick={() => editKey(ck)}>Edit</Button>
            <Button variant="ghost" size="xs" className="text-destructive" onClick={() => removeKey(ck.id)}>
              <X className="size-4" />
            </Button>
          </div>
        </div>
      ))}

      <Separator />

      <div className="grid grid-cols-3 gap-1">
        <Input
          className="h-7 text-xs"
          placeholder="ID"
          value={newId}
          onChange={e => { setNewId(e.target.value); setIdTouched(true); }}
          readOnly={editingKeyId !== null}
        />
        <Input
          className="h-7 text-xs"
          placeholder="Label"
          value={newLabel}
          onChange={e => { setNewLabel(e.target.value); setLabelTouched(true); }}
        />
        <div className="flex gap-1">
          <Input
            className="h-7 text-xs flex-1"
            placeholder="Ctrl+b, d"
            value={newCombo}
            onChange={e => setNewCombo(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') saveKey(); }}
          />
          {editingKeyId ? (
            <>
              <Button variant="outline" size="xs" onClick={saveKey} disabled={!formValid}>Save</Button>
              <Button variant="ghost" size="xs" onClick={clearForm}>Cancel</Button>
            </>
          ) : (
            <Button variant="outline" size="xs" onClick={saveKey} disabled={!formValid}>+</Button>
          )}
        </div>
      </div>

      {comboError && (
        <span className="text-xs text-destructive">{comboError}</span>
      )}

      <div className="text-xs text-muted-foreground space-y-0.5">
        <p>Syntax: modifier+key steps separated by comma or space.</p>
        <p>Modifiers: Ctrl, Alt, Shift. Examples:</p>
        <p className="pl-2">Ctrl+b — single combo</p>
        <p className="pl-2">Ctrl+b d — two-step: Ctrl+b then d</p>
        <p className="pl-2">Alt+Shift+x — multiple modifiers</p>
      </div>
    </div>
  );
}

// --- ContainerKeyEditor ---

interface ContainerKeyEditorProps {
  containers: SoftkeyContainerSpec[];
  allKeyIds: string[];
  customKeys: SoftkeyCustomKeySpec[];
  onChange: (containers: SoftkeyContainerSpec[]) => void;
}

function ContainerKeyEditor({ containers, allKeyIds, customKeys, onChange }: ContainerKeyEditorProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newId, setNewId] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newKeys, setNewKeys] = useState<string[]>([]);
  const [idTouched, setIdTouched] = useState(false);

  const clearForm = () => {
    setEditingId(null);
    setNewId('');
    setNewLabel('');
    setNewKeys([]);
    setIdTouched(false);
  };

  const saveContainer = () => {
    const id = newId.trim();
    const label = newLabel.trim();
    if (!id || !label) return;

    if (editingId) {
      onChange(containers.map(c => c.id === editingId ? { id, label, keys: newKeys } : c));
    } else {
      if (containers.some(c => c.id === id) || BUILTIN_KEY_IDS.has(id)) return;
      onChange([...containers, { id, label, keys: newKeys }]);
    }
    clearForm();
  };

  const editContainer = (c: SoftkeyContainerSpec) => {
    setEditingId(c.id);
    setNewId(c.id);
    setNewLabel(c.label);
    setNewKeys([...c.keys]);
    setIdTouched(true);
  };

  const removeContainer = (id: string) => {
    onChange(containers.filter(c => c.id !== id));
    if (editingId === id) clearForm();
  };

  const addChildKey = (value: string) => {
    if (!value) return;
    setNewKeys(prev => [...prev, value]);
  };

  const removeChildKey = (idx: number) => {
    setNewKeys(prev => prev.filter((_, i) => i !== idx));
  };

  // Auto-generate ID from label
  useEffect(() => {
    if (!idTouched && newLabel.trim()) {
      setNewId(newLabel.trim().toLowerCase().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64));
    }
  }, [newLabel, idTouched]);

  const formValid = newId.trim() !== '' && newLabel.trim() !== '';
  const childAvailable = allKeyIds.filter(id => !newKeys.includes(id));

  return (
    <div className="space-y-2">
      <Label className="text-xs text-muted-foreground">Container Keys</Label>

      {containers.map(c => (
        <div key={c.id} className="rounded-md border border-border p-2 space-y-1">
          <div className="flex items-center gap-2 text-xs">
            <Badge variant="outline" className="text-xs">{c.id}</Badge>
            <span className="text-muted-foreground">{c.label}</span>
            <div className="ml-auto flex gap-1">
              <Button variant="ghost" size="xs" onClick={() => editContainer(c)}>Edit</Button>
              <Button variant="ghost" size="xs" className="text-destructive" onClick={() => removeContainer(c.id)}>
                <X className="size-4" />
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            {c.keys.map((keyId, idx) => (
              <Badge key={`${keyId}-${idx}`} variant="secondary" className="text-xs">
                {getKeyLabel(keyId, customKeys)}
              </Badge>
            ))}
            {c.keys.length === 0 && (
              <span className="text-xs text-muted-foreground italic">No child keys</span>
            )}
          </div>
        </div>
      ))}

      <Separator />

      <div className="space-y-1">
        <div className="grid grid-cols-2 gap-1">
          <Input
            className="h-7 text-xs"
            placeholder="ID"
            value={newId}
            onChange={e => { setNewId(e.target.value); setIdTouched(true); }}
            readOnly={editingId !== null}
          />
          <Input
            className="h-7 text-xs"
            placeholder="Label"
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
          />
        </div>

        {/* Child keys */}
        <div className="flex flex-wrap gap-1">
          {newKeys.map((keyId, idx) => (
            <Badge key={`${keyId}-${idx}`} variant="secondary" className="text-xs gap-1 pr-1">
              {getKeyLabel(keyId, customKeys)}
              <button
                className="ml-0.5 text-muted-foreground hover:text-foreground"
                onClick={() => removeChildKey(idx)}
                title="Remove"
              >
                <X className="size-4" />
              </button>
            </Badge>
          ))}
        </div>

        <div className="flex gap-1">
          <Select value="" onValueChange={addChildKey}>
            <SelectTrigger size="sm" className="flex-1 h-7 text-xs">
              <SelectValue placeholder="+ Add child key..." />
            </SelectTrigger>
            <SelectContent>
              {childAvailable.map(id => (
                <SelectItem key={id} value={id}>{id} ({getKeyLabel(id, customKeys)})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex gap-1">
          {editingId ? (
            <>
              <Button variant="outline" size="xs" onClick={saveContainer} disabled={!formValid}>Save</Button>
              <Button variant="ghost" size="xs" onClick={clearForm}>Cancel</Button>
            </>
          ) : (
            <Button variant="outline" size="xs" onClick={saveContainer} disabled={!formValid || containers.length >= 20}>
              + Add Container
            </Button>
          )}
        </div>
      </div>

      <div className="text-xs text-muted-foreground space-y-0.5">
        <p>Container keys expand into a row of child keys above the softkey bar.</p>
        <p>Add a container to a page like any other key.</p>
      </div>
    </div>
  );
}

// --- Main SoftkeyEditor ---

export function SoftkeyEditor({ softkeys, onChange, defaultPages, defaultCustomKeys }: SoftkeyEditorProps) {
  const config = softkeys;

  const updatePages = useCallback((pages: string[][]) => {
    onChange({ ...config, pages });
  }, [config, onChange]);

  const updateCustomKeys = useCallback((customKeys: SoftkeyCustomKeySpec[]) => {
    onChange({ ...config, customKeys });
  }, [config, onChange]);

  const updateContainers = useCallback((containers: SoftkeyContainerSpec[]) => {
    onChange({ ...config, containers });
  }, [config, onChange]);

  const addPage = () => {
    updatePages([...config.pages, []]);
  };

  const deletePage = (idx: number) => {
    updatePages(config.pages.filter((_, i) => i !== idx));
  };

  const updatePage = (idx: number, keys: string[]) => {
    const next = [...config.pages];
    next[idx] = keys;
    updatePages(next);
  };

  const resetDefaults = () => {
    onChange({ pages: defaultPages.map(p => [...p]), customKeys: [...defaultCustomKeys], containers: [] });
  };

  const allKeyIds = getAllAvailableKeyIds(config.customKeys, config.containers);

  return (
    <div className="space-y-4">
      {/* Pages */}
      <div className="space-y-2">
        {config.pages.map((page, idx) => (
          <PageEditor
            key={idx}
            pageIndex={idx}
            keys={page}
            allKeyIds={allKeyIds}
            customKeys={config.customKeys}
            containers={config.containers}
            onUpdate={(keys) => updatePage(idx, keys)}
            onDelete={() => deletePage(idx)}
            canDelete={config.pages.length > 0}
          />
        ))}

        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={addPage} disabled={config.pages.length >= 10}>
            + Add Page
          </Button>
          <Button variant="ghost" size="sm" onClick={resetDefaults}>
            Reset to Defaults
          </Button>
        </div>
      </div>

      <Separator />

      {/* Custom keys */}
      <CustomKeyEditor
        customKeys={config.customKeys}
        onChange={updateCustomKeys}
      />

      <Separator />

      {/* Container keys */}
      <ContainerKeyEditor
        containers={config.containers ?? []}
        allKeyIds={[...BUILTIN_KEY_IDS, ...config.customKeys.map(ck => ck.id)]}
        customKeys={config.customKeys}
        onChange={updateContainers}
      />
    </div>
  );
}
