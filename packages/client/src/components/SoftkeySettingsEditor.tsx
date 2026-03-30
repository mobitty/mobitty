import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { SoftkeyKeySettings } from '@/profile-schema';
import { SOFTKEY_SETTINGS_FIELD_RULES, validateField } from '@/profile-schema';
import { DEFAULT_SOFTKEY_SETTINGS } from '@/profiles';

interface SoftkeySettingsEditorProps {
  softkeySettings: Record<string, SoftkeyKeySettings>;
  onChange: (settings: Record<string, SoftkeyKeySettings>) => void;
}

const DISPLAY_LABELS: Record<string, string> = {
  wheel_up: 'Wheel Up',
  wheel_down: 'Wheel Down',
};

function fieldLabel(field: string): string {
  return field.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim();
}

function FieldError({ error }: { error: string | undefined }) {
  if (!error) return null;
  return (
    <div className="flex items-start gap-2">
      <span className="min-w-[100px]" />
      <p className="text-destructive text-xs">{error}</p>
    </div>
  );
}

export function SoftkeySettingsEditor({ softkeySettings, onChange }: SoftkeySettingsEditorProps) {
  const [errors, setErrors] = useState<Map<string, string>>(new Map);

  const keyIds = Object.keys(DEFAULT_SOFTKEY_SETTINGS);
  const fields = Object.entries(SOFTKEY_SETTINGS_FIELD_RULES);

  const handleChange = (keyId: string, field: string, raw: string) => {
    const rule = SOFTKEY_SETTINGS_FIELD_RULES[field];
    if (!rule) return;

    const errorKey = `${keyId}.${field}`;

    if (rule.type === 'number') {
      const parsed = parseInt(raw, 10);
      const error = Number.isFinite(parsed) ? validateField(rule, parsed) : rule.errors.type;
      setErrors(prev => {
        const next = new Map(prev);
        if (error) next.set(errorKey, error);
        else next.delete(errorKey);
        return next;
      });
      if (!Number.isFinite(parsed)) return;
      const keySettings: SoftkeyKeySettings = { ...(softkeySettings[keyId] ?? {}), [field]: parsed };
      onChange({ ...softkeySettings, [keyId]: keySettings });
    }
  };

  return (
    <div className="space-y-3">
      <Label className="text-xs text-muted-foreground font-medium">Key Settings</Label>
      {keyIds.map(keyId => (
        <div key={keyId} className="space-y-1">
          <span className="text-xs font-medium">{DISPLAY_LABELS[keyId] ?? keyId}</span>
          {fields.map(([field, rule]) => {
            const value = softkeySettings[keyId]?.[field as keyof SoftkeyKeySettings];
            const errorKey = `${keyId}.${field}`;
            if (rule.type === 'number') {
              return (
                <div key={field}>
                  <div className="flex items-center gap-2">
                    <Label className="min-w-[100px] text-xs text-muted-foreground">{fieldLabel(field)}</Label>
                    <Input
                      type="number"
                      min={rule.min}
                      max={rule.max}
                      value={value ?? rule.default}
                      onChange={e => handleChange(keyId, field, e.target.value)}
                      aria-invalid={errors.has(errorKey) || undefined}
                    />
                  </div>
                  <FieldError error={errors.get(errorKey)} />
                </div>
              );
            }
            return null;
          })}
        </div>
      ))}
    </div>
  );
}
