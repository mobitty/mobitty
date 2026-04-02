import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { SoftkeyEditor } from '@/components/SoftkeyEditor';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { CircleHelp, ExternalLink } from 'lucide-react';
import { GestureEditor } from '@/components/GestureEditor';
import { SoftkeySettingsEditor } from '@/components/SoftkeySettingsEditor';
import type { Profile, ProfileTheme, ProfileSoftkeys, SoftkeyConfig, GestureMapping, SoftkeyKeySettings, ProfileFieldErrors, ProfileFieldName } from '@/profiles';
import {
  fetchProfileList, fetchProfile, saveProfile, deleteProfile,
  getSelectedProfileName, setSelectedProfileName, isProfile, validateProfileFields,
  validateHotkeyString, DEFAULT_SOFTKEYS, DEFAULT_GESTURES, DEFAULT_SOFTKEY_SETTINGS,
} from '@/profiles';
import { fetchThemeList, fetchTheme, saveTheme, deleteTheme, isBuiltinTheme, getThemeCredit } from '@/themes';
import { fetchShells, saveShell, deleteShell, rediscoverShells, type ShellInfo } from '@/shells';
import { FONT_OPTIONS, CUSTOM_FONT_VALUE, findFontOption, loadFont } from '@/fonts';

function FieldError({ error }: { error: string | undefined }) {
  if (!error) return null;
  return (
    <div className="flex items-start gap-2">
      <span className="min-w-[100px]" />
      <p className="text-destructive text-xs">{error}</p>
    </div>
  );
}

function HelpTip({ children }: { children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button">
          <CircleHelp className="size-4 text-muted-foreground shrink-0 cursor-help" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top"
        className="w-auto max-w-[240px] rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground shadow-md">
        {children}
      </PopoverContent>
    </Popover>
  );
}

const THEME_FIELDS: ReadonlyArray<{ key: keyof ProfileTheme; label: string }> = [
  { key: 'foreground', label: 'Foreground' },
  { key: 'background', label: 'Background' },
  { key: 'cursor', label: 'Cursor' },
  { key: 'black', label: 'Black' },
  { key: 'red', label: 'Red' },
  { key: 'green', label: 'Green' },
  { key: 'yellow', label: 'Yellow' },
  { key: 'blue', label: 'Blue' },
  { key: 'magenta', label: 'Magenta' },
  { key: 'cyan', label: 'Cyan' },
  { key: 'white', label: 'White' },
  { key: 'brightBlack', label: 'BrtBlack' },
  { key: 'brightRed', label: 'BrtRed' },
  { key: 'brightGreen', label: 'BrtGreen' },
  { key: 'brightYellow', label: 'BrtYellow' },
  { key: 'brightBlue', label: 'BrtBlue' },
  { key: 'brightMagenta', label: 'BrtMagenta' },
  { key: 'brightCyan', label: 'BrtCyan' },
  { key: 'brightWhite', label: 'BrtWhite' },
];

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentProfile?: Profile;
  isMobile: boolean;
  onApply: (profile: Profile) => void;
}

export function SettingsDialog({ open, onOpenChange, currentProfile, isMobile, onApply }: SettingsDialogProps) {
  const [profileList, setProfileList] = useState<string[]>([]);
  const [selectedName, setSelectedName] = useState('default');
  const [name, setName] = useState('');
  const [fontSizeMobile, setFontSizeMobile] = useState('');
  const [fontSizeDesktop, setFontSizeDesktop] = useState('');
  const [fontFamily, setFontFamily] = useState('');
  const [customFontFamily, setCustomFontFamily] = useState('');
  const [themeDesktopLight, setThemeDesktopLight] = useState('default-light');
  const [themeDesktopDark, setThemeDesktopDark] = useState('default-dark');
  const [themeMobileLight, setThemeMobileLight] = useState('default-light');
  const [themeMobileDark, setThemeMobileDark] = useState('default-dark');
  const [softkeySize, setSoftkeySize] = useState('');
  const [generalDeviceTab, setGeneralDeviceTab] = useState<'mobile' | 'desktop'>(isMobile ? 'mobile' : 'desktop');
  const [paddingMobile, setPaddingMobile] = useState('');
  const [paddingDesktop, setPaddingDesktop] = useState('');
  const [scrollback, setScrollback] = useState('');
  const [softkeys, setSoftkeys] = useState<ProfileSoftkeys>(DEFAULT_SOFTKEYS);
  const [gestures, setGestures] = useState<GestureMapping>({ ...DEFAULT_GESTURES });
  const [softkeySettings, setSoftkeySettings] = useState<Record<string, SoftkeyKeySettings>>({ ...DEFAULT_SOFTKEY_SETTINGS });
  const [sessionSwitcherHotkey, setSessionSwitcherHotkey] = useState('');
  const [imagePasteDir, setImagePasteDir] = useState('tmp');
  const [optionIsMeta, setOptionIsMeta] = useState(true);
  const [notificationMode, setNotificationMode] = useState<'iterm' | 'kitty' | 'ghostty' | 'off'>('iterm');
  const [remoteEditor, setRemoteEditor] = useState(false);
  const [hotkeyError, setHotkeyError] = useState<string | undefined>();
  const [status, setStatus] = useState('');
  const [fieldErrors, setFieldErrors] = useState<ProfileFieldErrors>(new Map());

  const clearFieldError = useCallback((field: ProfileFieldName) => {
    setFieldErrors(prev => {
      if (!prev.has(field)) return prev;
      const next = new Map(prev);
      next.delete(field);
      return next;
    });
  }, []);

  // Theme tab state
  const [themeList, setThemeList] = useState<string[]>([]);
  const [selectedThemeName, setSelectedThemeName] = useState('default-dark');
  const [themeName, setThemeName] = useState('default-dark');
  const [themeColors, setThemeColors] = useState<Record<string, string>>({});

  // Shell tab state
  const [shellList, setShellList] = useState<ShellInfo[]>([]);
  const [shellEditName, setShellEditName] = useState('');
  const [shellEditCommand, setShellEditCommand] = useState('');
  const [shellEditEnv, setShellEditEnv] = useState<Array<{ key: string; value: string }>>([]);
  const [shellEditing, setShellEditing] = useState<string | null>(null); // name of shell being edited, null = adding new

  const isDefaultProfile = selectedName === 'default';
  const isReadonlyTheme = isBuiltinTheme(selectedThemeName);

  const showStatus = useCallback((msg: string) => {
    setStatus(msg);
    if (msg) setTimeout(() => setStatus(prev => prev === msg ? '' : prev), 3000);
  }, []);

  const refreshProfileList = useCallback(async () => {
    const list = await fetchProfileList();
    setProfileList(list);
  }, []);

  const refreshThemeList = useCallback(async () => {
    const list = await fetchThemeList();
    setThemeList(list);
  }, []);

  const populateForm = useCallback((profile: Profile) => {
    setName(profile.name);
    setFontSizeMobile(String(profile.fontSize.mobile));
    setFontSizeDesktop(String(profile.fontSize.desktop));
    setFontFamily(profile.fontFamily);
    if (!findFontOption(profile.fontFamily)) {
      setCustomFontFamily(profile.fontFamily);
    }
    setThemeDesktopLight(profile.theme.desktopLight);
    setThemeDesktopDark(profile.theme.desktopDark);
    setThemeMobileLight(profile.theme.mobileLight);
    setThemeMobileDark(profile.theme.mobileDark);
    setSoftkeySize(String(profile.softkeySize ?? 44));
    setPaddingMobile(String(profile.padding.mobile));
    setPaddingDesktop(String(profile.padding.desktop));
    setScrollback(String(profile.scrollback));
    setSoftkeys(profile.softkeys ?? DEFAULT_SOFTKEYS);
    setGestures(profile.gestures ?? { ...DEFAULT_GESTURES });
    setSoftkeySettings(profile.softkeySettings ?? { ...DEFAULT_SOFTKEY_SETTINGS });
    setSessionSwitcherHotkey(profile.sessionSwitcherHotkey ?? '');
    setImagePasteDir(profile.imagePasteDir ?? 'tmp');
    setOptionIsMeta(profile.optionIsMeta);
    setNotificationMode(profile.notificationMode);
    setRemoteEditor(profile.remoteEditor);
    setHotkeyError(undefined);
    setFieldErrors(new Map());
  }, []);

  const loadTheme = useCallback(async (name: string) => {
    const theme = await fetchTheme(name);
    if (theme) {
      setSelectedThemeName(name);
      setThemeName(theme.name);
      const c: Record<string, string> = {};
      for (const f of THEME_FIELDS) c[f.key] = theme.colors[f.key];
      setThemeColors(c);
    }
  }, []);

  const loadProfile = useCallback(async (profileName: string) => {
    const profile = await fetchProfile(profileName);
    if (profile) populateForm(profile);
  }, [populateForm]);

  // On open: refresh lists and load current profile + theme
  useEffect(() => {
    if (!open) return;
    refreshProfileList();
    refreshThemeList();
    const profileName = getSelectedProfileName();
    setSelectedName(profileName);
    if (currentProfile) {
      populateForm(currentProfile);
      const isLight = window.matchMedia('(prefers-color-scheme: light)').matches;
      const activeTheme = isMobile
        ? (isLight ? currentProfile.theme.mobileLight : currentProfile.theme.mobileDark)
        : (isLight ? currentProfile.theme.desktopLight : currentProfile.theme.desktopDark);
      loadTheme(activeTheme);
    } else {
      loadProfile(profileName).then(() => {});
    }
  }, [open, currentProfile, refreshProfileList, refreshThemeList, populateForm, loadProfile, loadTheme]);

  const readProfile = (): Profile | undefined => {
    const candidate: Record<string, unknown> = {
      name: name.trim(),
      fontSize: { mobile: parseInt(fontSizeMobile, 10), desktop: parseInt(fontSizeDesktop, 10) },
      fontFamily: fontFamily.trim(),
      theme: {
        desktopLight: themeDesktopLight,
        desktopDark: themeDesktopDark,
        mobileLight: themeMobileLight,
        mobileDark: themeMobileDark,
      },
      scrollback: parseInt(scrollback, 10),
      padding: { mobile: parseInt(paddingMobile, 10), desktop: parseInt(paddingDesktop, 10) },
      softkeys,
      softkeySize: parseInt(softkeySize, 10),
      imagePasteDir: imagePasteDir.trim() || undefined,
      optionIsMeta,
      notificationMode,
      remoteEditor,
    };
    if (Object.keys(gestures).length > 0) {
      candidate['gestures'] = gestures;
    }
    if (Object.keys(softkeySettings).length > 0) {
      candidate['softkeySettings'] = softkeySettings;
    }
    const hotkeyTrimmed = sessionSwitcherHotkey.trim();
    if (hotkeyTrimmed !== '') {
      const err = validateHotkeyString(hotkeyTrimmed);
      if (err) { setHotkeyError(err); return undefined; }
      candidate['sessionSwitcherHotkey'] = hotkeyTrimmed;
    }
    setHotkeyError(undefined);
    const errors = validateProfileFields(candidate);
    if (errors.size > 0) {
      setFieldErrors(errors);
      return undefined;
    }
    setFieldErrors(new Map());
    if (isProfile(candidate)) return candidate;
    return undefined;
  };

  const handleApply = async () => {
    const profile = readProfile();
    if (!profile) { showStatus('Invalid profile data'); return; }
    const option = findFontOption(profile.fontFamily);
    if (option) await loadFont(option);
    setSelectedProfileName(profile.name);
    onApply(profile);
    showStatus('Applied');
  };

  const handleSave = async () => {
    if (isDefaultProfile) { showStatus('Cannot modify the default profile'); return; }
    const profile = readProfile();
    if (!profile) { showStatus('Invalid profile data'); return; }
    const ok = await saveProfile(profile);
    if (ok) {
      setSelectedProfileName(profile.name);
      onApply(profile);
      await refreshProfileList();
      setSelectedName(profile.name);
      showStatus('Saved');
    } else {
      showStatus('Failed to save');
    }
  };

  const handleSaveAsNew = async () => {
    const profile = readProfile();
    if (!profile) { showStatus('Invalid profile data'); return; }
    if (profile.name === selectedName || profile.name === 'default') {
      const newName = prompt('Enter new profile name:', `${profile.name}-copy`);
      if (!newName) return;
      profile.name = newName.trim();
      if (!isProfile(profile)) { showStatus('Invalid profile name'); return; }
    }
    const ok = await saveProfile(profile);
    if (ok) {
      setName(profile.name);
      setSelectedProfileName(profile.name);
      onApply(profile);
      await refreshProfileList();
      setSelectedName(profile.name);
      showStatus(`Saved as "${profile.name}"`);
    } else {
      showStatus('Failed to save');
    }
  };

  const handleDelete = async () => {
    if (!selectedName || selectedName === 'default') {
      showStatus('Cannot delete the default profile');
      return;
    }
    if (!confirm(`Delete profile "${selectedName}"?`)) return;
    const ok = await deleteProfile(selectedName);
    if (ok) {
      setSelectedProfileName('default');
      await refreshProfileList();
      setSelectedName('default');
      await loadProfile('default');
      showStatus(`Deleted "${selectedName}"`);
    } else {
      showStatus('Failed to delete');
    }
  };

  const handleProfileSelect = async (value: string) => {
    setSelectedName(value);
    await loadProfile(value);
  };

  const handleSoftkeyConfigChange = (device: 'mobile' | 'desktop', config: SoftkeyConfig) => {
    setSoftkeys(prev => ({ ...prev, [device]: config }));
  };

  // --- Theme tab handlers ---

  const handleThemeSelect = async (value: string) => {
    await loadTheme(value);
  };

  const handleThemeSave = async () => {
    if (isReadonlyTheme) { showStatus('Cannot modify a built-in theme'); return; }
    const colors = {} as Record<string, string>;
    for (const f of THEME_FIELDS) colors[f.key] = themeColors[f.key] ?? '#000000';
    const ok = await saveTheme({ name: themeName.trim(), colors: colors as unknown as ProfileTheme });
    if (ok) {
      await refreshThemeList();
      setSelectedThemeName(themeName.trim());
      showStatus('Theme saved');
    } else {
      showStatus('Failed to save theme');
    }
  };

  const handleThemeSaveAsNew = async () => {
    const colors = {} as Record<string, string>;
    for (const f of THEME_FIELDS) colors[f.key] = themeColors[f.key] ?? '#000000';
    let newName = themeName.trim();
    if (newName === selectedThemeName || isBuiltinTheme(newName)) {
      const input = prompt('Enter new theme name:', `${newName}-copy`);
      if (!input) return;
      newName = input.trim();
    }
    const ok = await saveTheme({ name: newName, colors: colors as unknown as ProfileTheme });
    if (ok) {
      await refreshThemeList();
      setSelectedThemeName(newName);
      setThemeName(newName);
      showStatus(`Theme saved as "${newName}"`);
    } else {
      showStatus('Failed to save theme');
    }
  };

  const handleThemeDelete = async () => {
    if (isReadonlyTheme) { showStatus('Cannot delete a built-in theme'); return; }
    if (!confirm(`Delete theme "${selectedThemeName}"?`)) return;
    const ok = await deleteTheme(selectedThemeName);
    if (ok) {
      await refreshThemeList();
      await loadTheme('default-dark');
      showStatus(`Deleted theme "${selectedThemeName}"`);
    } else {
      showStatus('Failed to delete theme');
    }
  };

  // --- Shell tab handlers ---

  const refreshShellList = useCallback(async () => {
    const list = await fetchShells();
    setShellList(list);
  }, []);

  useEffect(() => {
    if (open) refreshShellList();
  }, [open, refreshShellList]);

  const shellEditReset = () => {
    setShellEditing(null);
    setShellEditName('');
    setShellEditCommand('');
    setShellEditEnv([]);
  };

  const handleShellEdit = (shell: ShellInfo) => {
    setShellEditing(shell.name);
    setShellEditName(shell.name);
    setShellEditCommand(shell.argv.join(' '));
    const envEntries = shell.env
      ? Object.entries(shell.env).map(([key, value]) => ({ key, value }))
      : [];
    setShellEditEnv(envEntries);
  };

  const handleShellSave = async () => {
    const trimmedName = shellEditName.trim();
    const trimmedCommand = shellEditCommand.trim();
    if (!trimmedName || !trimmedCommand) { showStatus('Name and command are required'); return; }
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(trimmedName)) { showStatus('Invalid shell name'); return; }
    const argv = trimmedCommand.split(/\s+/);
    const env: Record<string, string> = {};
    for (const entry of shellEditEnv) {
      const k = entry.key.trim();
      if (k) env[k] = entry.value;
    }
    const data: { name: string; argv: string[]; env?: Record<string, string> } = { name: trimmedName, argv };
    if (Object.keys(env).length > 0) data.env = env;
    const ok = await saveShell(trimmedName, data);
    if (ok) {
      shellEditReset();
      await refreshShellList();
      showStatus('Shell saved');
    } else {
      showStatus('Failed to save shell');
    }
  };

  const handleShellDelete = async (shellName: string) => {
    if (!confirm(`Delete shell "${shellName}"?`)) return;
    const ok = await deleteShell(shellName);
    if (ok) {
      if (shellEditing === shellName) shellEditReset();
      await refreshShellList();
      showStatus('Shell deleted');
    } else {
      showStatus('Failed to delete shell');
    }
  };

  const handleShellRediscover = async () => {
    const list = await rediscoverShells();
    setShellList(list);
    showStatus('Shells rediscovered');
  };

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-50 bg-background text-foreground flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="text-lg font-semibold">Settings</h2>
        <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
          &#215;
        </Button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <Tabs defaultValue="general">
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="shells">Shells</TabsTrigger>
            <TabsTrigger value="softkeys">Softkeys</TabsTrigger>
            <TabsTrigger value="gestures">Gestures</TabsTrigger>
            <TabsTrigger value="themes">Themes</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="space-y-4 mt-4">
            {/* Profile selector */}
            <div className="flex items-center gap-2">
              <Label className="min-w-[100px] text-xs text-muted-foreground">Profile</Label>
              <Select value={selectedName} onValueChange={handleProfileSelect}>
                <SelectTrigger className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {profileList.map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button variant="destructive" size="sm" onClick={handleDelete} disabled={isDefaultProfile}>Delete</Button>
            </div>

            {/* Name */}
            <div className="flex items-center gap-2">
              <Label className="min-w-[100px] text-xs text-muted-foreground">Name</Label>
              <Input
                value={name}
                onChange={e => { setName(e.target.value); clearFieldError('name'); }}
                placeholder="Profile name"
                disabled={isDefaultProfile}
                aria-invalid={fieldErrors.has('name') || undefined}
              />
            </div>
            <FieldError error={fieldErrors.get('name')} />

            {/* Font family */}
            <div className="flex items-center gap-2">
              <Label className="min-w-[100px] text-xs text-muted-foreground">Font Family</Label>
              <Select
                value={findFontOption(fontFamily)?.fontFamily ?? CUSTOM_FONT_VALUE}
                onValueChange={value => {
                  clearFieldError('fontFamily');
                  if (value === CUSTOM_FONT_VALUE) {
                    setFontFamily(customFontFamily);
                  } else {
                    setFontFamily(value);
                    const option = findFontOption(value);
                    if (option) loadFont(option);
                  }
                }}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FONT_OPTIONS.map(o => (
                    <SelectItem key={o.fontFamily} value={o.fontFamily}>{o.label}</SelectItem>
                  ))}
                  <SelectItem value={CUSTOM_FONT_VALUE}>Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {!findFontOption(fontFamily) && (
              <div className="flex items-center gap-2">
                <Label className="min-w-[100px] text-xs text-muted-foreground" />
                <Input
                  value={customFontFamily}
                  onChange={e => { setCustomFontFamily(e.target.value); setFontFamily(e.target.value); clearFieldError('fontFamily'); }}
                  placeholder="Custom font-family CSS value"
                  aria-invalid={fieldErrors.has('fontFamily') || undefined}
                />
              </div>
            )}
            <FieldError error={fieldErrors.get('fontFamily')} />

            {/* Device-specific settings */}
            <Tabs value={generalDeviceTab} onValueChange={v => setGeneralDeviceTab(v as 'mobile' | 'desktop')}>
              <TabsList>
                <TabsTrigger value="mobile">Mobile</TabsTrigger>
                <TabsTrigger value="desktop">Desktop</TabsTrigger>
              </TabsList>
            </Tabs>

            {/* Font size */}
            <div className="flex items-center gap-2">
              <Label className="min-w-[100px] text-xs text-muted-foreground">Font Size</Label>
              <Input
                type="number" min="8" max="72"
                value={generalDeviceTab === 'mobile' ? fontSizeMobile : fontSizeDesktop}
                onChange={e => {
                  if (generalDeviceTab === 'mobile') { setFontSizeMobile(e.target.value); clearFieldError('fontSizeMobile'); }
                  else { setFontSizeDesktop(e.target.value); clearFieldError('fontSizeDesktop'); }
                }}
                aria-invalid={fieldErrors.has(generalDeviceTab === 'mobile' ? 'fontSizeMobile' : 'fontSizeDesktop') || undefined}
              />
            </div>
            <FieldError error={fieldErrors.get(generalDeviceTab === 'mobile' ? 'fontSizeMobile' : 'fontSizeDesktop')} />

            {/* Padding */}
            <div className="flex items-center gap-2">
              <Label className="min-w-[100px] text-xs text-muted-foreground">Padding</Label>
              <Input
                type="number" min="0" max="48"
                value={generalDeviceTab === 'mobile' ? paddingMobile : paddingDesktop}
                onChange={e => {
                  if (generalDeviceTab === 'mobile') { setPaddingMobile(e.target.value); clearFieldError('paddingMobile'); }
                  else { setPaddingDesktop(e.target.value); clearFieldError('paddingDesktop'); }
                }}
                aria-invalid={fieldErrors.has(generalDeviceTab === 'mobile' ? 'paddingMobile' : 'paddingDesktop') || undefined}
              />
              <HelpTip>Left and right padding of the application in pixels.</HelpTip>
            </div>
            <FieldError error={fieldErrors.get(generalDeviceTab === 'mobile' ? 'paddingMobile' : 'paddingDesktop')} />

            {/* Key size */}
            <div className="flex items-center gap-2">
              <Label className="min-w-[100px] text-xs text-muted-foreground">Key Size</Label>
              <Input
                type="number" min="28" max="60" step="2"
                value={softkeySize}
                onChange={e => setSoftkeySize(e.target.value)}
                aria-invalid={fieldErrors.has('softkeySize') || undefined}
              />
            </div>
            <FieldError error={fieldErrors.get('softkeySize')} />

            {/* Scrollback */}
            <div className="flex items-center gap-2">
              <Label className="min-w-[100px] text-xs text-muted-foreground">Scrollback</Label>
              <Input
                type="number" min="100" max="50000" step="100" value={scrollback}
                onChange={e => { setScrollback(e.target.value); clearFieldError('scrollback'); }}
                aria-invalid={fieldErrors.has('scrollback') || undefined}
              />
              <HelpTip>Number of lines of terminal history to keep. Higher values use more memory. Range: 100–50,000.</HelpTip>
            </div>
            <FieldError error={fieldErrors.get('scrollback')} />

            {/* Image paste directory */}
            <div className="flex items-center gap-2">
              <Label className="min-w-[72px] text-xs text-muted-foreground">Img Paste Dir</Label>
              <Input
                value={imagePasteDir}
                onChange={e => { setImagePasteDir(e.target.value); clearFieldError('imagePasteDir'); }}
                placeholder="tmp"
                aria-invalid={fieldErrors.has('imagePasteDir') || undefined}
              />
              <HelpTip>Relative directory for image paste file fallback. Resolved from the shell's CWD at paste time.</HelpTip>
            </div>
            <FieldError error={fieldErrors.get('imagePasteDir')} />

            {/* Session switcher hotkey (desktop only) */}
            {!isMobile && (
              <>
                <div className="flex items-center gap-2">
                  <Label className="min-w-[100px] text-xs text-muted-foreground">Hotkey</Label>
                  <Input
                    value={sessionSwitcherHotkey}
                    onChange={e => { setSessionSwitcherHotkey(e.target.value); setHotkeyError(undefined); }}
                    placeholder="Ctrl+Shift+s"
                    aria-invalid={!!hotkeyError || undefined}
                  />
                  <HelpTip>Keyboard shortcut to toggle the session panel. Format: Ctrl+Shift+s. Leave empty to disable.</HelpTip>
                </div>
                {hotkeyError && (
                  <div className="flex items-start gap-2">
                    <span className="min-w-[100px]" />
                    <p className="text-destructive text-xs">{hotkeyError}</p>
                  </div>
                )}
              </>
            )}

            {/* Option as Meta (macOS) */}
            <div className="flex items-center gap-2">
              <Label className="min-w-[100px] text-xs text-muted-foreground">Option as Meta</Label>
              <input
                type="checkbox"
                checked={optionIsMeta}
                onChange={e => setOptionIsMeta(e.target.checked)}
                className="accent-primary"
              />
              <HelpTip>Send ESC+key for Option shortcuts (macOS)</HelpTip>
            </div>

            {/* Remote Editor */}
            <div className="flex items-center gap-2">
              <Label className="min-w-[100px] text-xs text-muted-foreground">Remote Editor</Label>
              <input
                type="checkbox"
                checked={remoteEditor}
                onChange={e => setRemoteEditor(e.target.checked)}
                className="accent-primary"
              />
              <HelpTip>Allow programs (e.g. Claude Code) to open files in the browser for editing via $EDITOR/$VISUAL. Applies to new sessions only.</HelpTip>
            </div>

            {/* Notification mode */}
            <div className="flex items-center gap-2">
              <Label className="min-w-[100px] text-xs text-muted-foreground">Notifications</Label>
              <Select value={notificationMode} onValueChange={v => setNotificationMode(v as 'iterm' | 'kitty' | 'ghostty' | 'off')}>
                <SelectTrigger className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="iterm">iTerm2 (OSC 9)</SelectItem>
                  <SelectItem value="kitty">Kitty (OSC 99)</SelectItem>
                  <SelectItem value="ghostty">Ghostty (OSC 777)</SelectItem>
                  <SelectItem value="off">Off</SelectItem>
                </SelectContent>
              </Select>
              <HelpTip>Terminal notification emulation. Sets TERM_PROGRAM so programs send notifications via the selected protocol. Applies to new sessions only.</HelpTip>
            </div>

          </TabsContent>

          <TabsContent value="shells" className="space-y-4 mt-4">
            {/* Shell list */}
            {shellList.length === 0 && (
              <p className="text-sm text-muted-foreground">No shells found</p>
            )}
            {shellList.map(shell => (
              <div key={shell.name} className="flex items-center gap-2 px-3 py-2 rounded-md border border-border">
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium">{shell.name}</span>
                  <div className="text-xs text-muted-foreground truncate">{shell.argv.join(' ')}</div>
                  {shell.env && Object.keys(shell.env).length > 0 && (
                    <div className="text-xs text-muted-foreground truncate">
                      env: {Object.entries(shell.env).map(([k, v]) => `${k}=${v}`).join(', ')}
                    </div>
                  )}
                </div>
                <Badge variant={shell.source === 'saved' ? 'default' : 'outline'} className="shrink-0 text-xs">
                  {shell.source === 'saved' ? 'saved' : 'auto'}
                </Badge>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs shrink-0" onClick={() => handleShellEdit(shell)}>
                  {shell.source === 'saved' ? 'Edit' : 'Save As'}
                </Button>
                {shell.source === 'saved' && (
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-destructive shrink-0" onClick={() => handleShellDelete(shell.name)}>
                    Delete
                  </Button>
                )}
              </div>
            ))}

            <Separator />

            {/* Add / Edit form */}
            <div className="space-y-2">
              <h3 className="text-sm font-medium">{shellEditing ? `Edit: ${shellEditing}` : 'Add Shell'}</h3>
              <div className="flex items-center gap-2">
                <Label className="min-w-[100px] text-xs text-muted-foreground">Name</Label>
                <Input
                  value={shellEditName}
                  onChange={e => setShellEditName(e.target.value)}
                  placeholder="e.g. bash"
                  disabled={!!shellEditing}
                />
              </div>
              <div className="flex items-center gap-2">
                <Label className="min-w-[100px] text-xs text-muted-foreground">Command</Label>
                <Input
                  value={shellEditCommand}
                  onChange={e => setShellEditCommand(e.target.value)}
                  placeholder="e.g. /bin/bash -i -l"
                />
              </div>

              {/* Env vars */}
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Label className="min-w-[100px] text-xs text-muted-foreground">Env Vars</Label>
                  <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => setShellEditEnv(prev => [...prev, { key: '', value: '' }])}>
                    + Add
                  </Button>
                </div>
                {shellEditEnv.map((entry, i) => (
                  <div key={i} className="flex items-center gap-1 ml-[108px]">
                    <Input
                      value={entry.key}
                      onChange={e => {
                        const next = [...shellEditEnv];
                        next[i] = { ...entry, key: e.target.value };
                        setShellEditEnv(next);
                      }}
                      placeholder="KEY"
                      className="flex-1 h-7 text-xs"
                    />
                    <span className="text-xs text-muted-foreground">=</span>
                    <Input
                      value={entry.value}
                      onChange={e => {
                        const next = [...shellEditEnv];
                        next[i] = { ...entry, value: e.target.value };
                        setShellEditEnv(next);
                      }}
                      placeholder="value"
                      className="flex-1 h-7 text-xs"
                    />
                    <Button variant="ghost" size="sm" className="h-7 px-1 text-xs text-destructive" onClick={() => setShellEditEnv(prev => prev.filter((_, j) => j !== i))}>
                      &#215;
                    </Button>
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleShellSave}>
                  {shellEditing ? 'Save' : 'Add'}
                </Button>
                {shellEditing && (
                  <Button variant="ghost" size="sm" onClick={shellEditReset}>Cancel</Button>
                )}
              </div>
            </div>

            <Separator />
            <Button variant="outline" size="sm" onClick={handleShellRediscover}>
              Rediscover Shells
            </Button>
          </TabsContent>

          <TabsContent value="softkeys" className="space-y-4 mt-4">
            <SoftkeyEditor
              softkeys={softkeys}
              isMobile={isMobile}
              onChange={handleSoftkeyConfigChange}
            />
            <Separator />
            <SoftkeySettingsEditor
              softkeySettings={softkeySettings}
              onChange={setSoftkeySettings}
            />
          </TabsContent>

          <TabsContent value="gestures" className="space-y-4 mt-4">
            <GestureEditor
              gestures={gestures}
              customKeys={softkeys[isMobile ? 'mobile' : 'desktop'].customKeys}
              onChange={setGestures}
            />
          </TabsContent>

          <TabsContent value="themes" className="space-y-4 mt-4">
            {/* Profile theme assignments */}
            <Label className="text-xs text-muted-foreground block">Profile Themes</Label>
            {([
              ['Desktop Light', themeDesktopLight, setThemeDesktopLight, 'themeDesktopLight'] as const,
              ['Desktop Dark', themeDesktopDark, setThemeDesktopDark, 'themeDesktopDark'] as const,
              ['Mobile Light', themeMobileLight, setThemeMobileLight, 'themeMobileLight'] as const,
              ['Mobile Dark', themeMobileDark, setThemeMobileDark, 'themeMobileDark'] as const,
            ]).map(([label, value, setter, field]) => (
              <div key={field}>
                <div className="flex items-center gap-2">
                  <Label className="min-w-[110px] text-xs text-muted-foreground">{label}</Label>
                  <Select value={value} onValueChange={v => { setter(v); clearFieldError(field); }}>
                    <SelectTrigger className="flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {themeList.map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {(() => {
                    const credit = getThemeCredit(value);
                    if (!credit) return null;
                    return (
                      <a href={credit.url} target="_blank" rel="noopener noreferrer" title={credit.label} className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
                        <ExternalLink className="size-3.5" />
                      </a>
                    );
                  })()}
                </div>
                <FieldError error={fieldErrors.get(field)} />
              </div>
            ))}

            <Separator />

            {/* Theme editor */}
            <Label className="text-xs text-muted-foreground block">Theme Editor</Label>
            <div className="flex items-center gap-2">
              <Label className="min-w-[110px] text-xs text-muted-foreground">Theme</Label>
              <Select value={selectedThemeName} onValueChange={handleThemeSelect}>
                <SelectTrigger className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {themeList.map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
              {(() => {
                const credit = getThemeCredit(selectedThemeName);
                if (!credit) return null;
                return (
                  <a href={credit.url} target="_blank" rel="noopener noreferrer" title={credit.label} className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
                    <ExternalLink className="size-3.5" />
                  </a>
                );
              })()}
              <Button variant="destructive" size="sm" onClick={handleThemeDelete} disabled={isReadonlyTheme}>Delete</Button>
            </div>

            {/* Theme name */}
            <div className="flex items-center gap-2">
              <Label className="min-w-[110px] text-xs text-muted-foreground">Name</Label>
              <Input
                value={themeName}
                onChange={e => setThemeName(e.target.value)}
                placeholder="Theme name"
                disabled={isReadonlyTheme}
              />
            </div>

            {/* Color grid */}
            <div>
              <Label className="text-xs text-muted-foreground mb-2 block">Colors</Label>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-1.5">
                {THEME_FIELDS.map(f => (
                  <div key={f.key} className="flex items-center gap-1.5">
                    <input
                      type="color"
                      className="w-7 h-5 border border-input rounded cursor-pointer bg-transparent [&::-webkit-color-swatch-wrapper]:p-0.5 [&::-webkit-color-swatch]:border-none [&::-webkit-color-swatch]:rounded-sm"
                      value={themeColors[f.key] ?? '#000000'}
                      onChange={e => setThemeColors(prev => ({ ...prev, [f.key]: e.target.value }))}
                      disabled={isReadonlyTheme}
                    />
                    <span className="text-[11px] text-muted-foreground">{f.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Theme action buttons */}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleThemeSaveAsNew}>Save As New</Button>
              <Button variant="outline" size="sm" onClick={handleThemeSave} disabled={isReadonlyTheme}>Save</Button>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
        {status && (
          <span className="text-xs text-primary mr-auto">{status}</span>
        )}
        <Button variant="outline" size="sm" onClick={handleSaveAsNew}>Save As New</Button>
        <Button variant="outline" size="sm" onClick={handleSave} disabled={isDefaultProfile}>Save</Button>
        <Button size="sm" onClick={handleApply}>Apply</Button>
      </div>
    </div>
  );
}
