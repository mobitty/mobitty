import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { KEY_REGISTRY } from '@/softkey-types';
import type { SoftkeyCustomKeySpec } from '@/profiles';
import type { GestureMapping, GestureId } from '@/gesture-types';
import { GESTURE_GROUPS, DEFAULT_GESTURE_MAPPING } from '@/gesture-types';

const DISABLED_VALUE = '__disabled__';

const GESTURE_DISPLAY_LABELS: Partial<Record<GestureId, string>> = {
  'double-tap': 'Double-tap',
  'triple-tap': 'Triple-tap',
  'pinch-in': 'Pinch in',
  'pinch-out': 'Pinch out',
  'rotate-cw': 'Clockwise',
  'rotate-ccw': 'Counter-CW',
};

function directionLabel(gestureId: GestureId): string {
  const custom = GESTURE_DISPLAY_LABELS[gestureId];
  if (custom) return custom;
  const parts = gestureId.split('-');
  const dir = parts[parts.length - 1]!;
  return dir.charAt(0).toUpperCase() + dir.slice(1);
}

/** Notes about xterm.js default behaviors that gestures override. */
const GESTURE_NOTES: Partial<Record<string, string>> = {
  '1-Finger Swipe': 'Horizontal only; vertical always scrolls natively.',
  '1-Finger Flick': 'Quick gesture; fires alongside native scroll.',
  '2-Finger Swipe': 'Up/Down overrides native terminal scrolling when mapped.',
  'Pinch': '2-finger squeeze (in) or spread (out).',
  'Rotate': '2-finger twist gesture.',
};

interface GestureEditorProps {
  gestures: GestureMapping;
  customKeys: SoftkeyCustomKeySpec[];
  onChange: (gestures: GestureMapping) => void;
}

export function GestureEditor({ gestures, customKeys, onChange }: GestureEditorProps) {
  const allKeyOptions = [
    ...Object.entries(KEY_REGISTRY).map(([id, spec]) => ({ id, label: `${id} (${spec.label})` })),
    ...customKeys.map(ck => ({ id: ck.id, label: `${ck.id} (${ck.label})` })),
  ];

  const handleChange = (gestureId: GestureId, value: string) => {
    const next = { ...gestures };
    if (value === DISABLED_VALUE) {
      delete next[gestureId];
    } else {
      next[gestureId] = value;
    }
    onChange(next);
  };

  const resetDefaults = () => {
    onChange({ ...DEFAULT_GESTURE_MAPPING });
  };

  return (
    <div className="space-y-4">
      {GESTURE_GROUPS.map(group => (
        <div key={group.label} className="space-y-1.5">
          <Label className="text-xs text-muted-foreground font-medium">{group.label}</Label>
          {GESTURE_NOTES[group.label] && (
            <p className="text-[11px] text-muted-foreground/70 italic">{GESTURE_NOTES[group.label]}</p>
          )}
          {group.gestures.map(gestureId => (
            <div key={gestureId} className="flex items-center gap-2">
              <span className="text-xs w-20 text-right text-muted-foreground">{directionLabel(gestureId)}</span>
              <Select
                value={gestures[gestureId] ?? DISABLED_VALUE}
                onValueChange={v => handleChange(gestureId, v)}
              >
                <SelectTrigger className="flex-1 h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DISABLED_VALUE}>disabled</SelectItem>
                  {allKeyOptions.map(opt => (
                    <SelectItem key={opt.id} value={opt.id}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
          <Separator />
        </div>
      ))}

      <Button variant="ghost" size="sm" onClick={resetDefaults}>
        Reset to Defaults
      </Button>
    </div>
  );
}
