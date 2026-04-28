interface FontOption {
  label: string;
  fontFamily: string;
  cssFile?: string;
}

const CDN_BASE = "https://cdn.jsdelivr.net/gh/mshaugh/nerdfont-webfonts@latest/build/";

export const FONT_OPTIONS: FontOption[] = [
  { label: "System Default", fontFamily: "Consolas, Liberation Mono, Menlo, Courier, monospace" },
  { label: "0xProto Nerd Font", fontFamily: '"0xProto Nerd Font Mono", monospace', cssFile: "0xproto.css" },
  { label: "Cascadia Code Nerd Font", fontFamily: '"CaskaydiaCove NFM", monospace', cssFile: "cascadiacode.css" },
  { label: "DejaVu Sans Mono Nerd Font", fontFamily: '"DejaVuSansM Nerd Font Mono", monospace', cssFile: "dejavusansmono.css" },
  { label: "Fira Code Nerd Font", fontFamily: '"FiraCode Nerd Font Mono", monospace', cssFile: "firacode.css" },
  { label: "Geist Mono Nerd Font", fontFamily: '"GeistMono Nerd Font Mono", monospace', cssFile: "geistmono.css" },
  { label: "Hack Nerd Font", fontFamily: '"Hack Nerd Font Mono", monospace', cssFile: "hack.css" },
  { label: "Iosevka Term Nerd Font", fontFamily: '"IosevkaTerm NFM", monospace', cssFile: "iosevkaterm.css" },
  { label: "JetBrains Mono Nerd Font", fontFamily: '"JetBrainsMono NFM", monospace', cssFile: "jetbrainsmono.css" },
  { label: "Meslo LG S Nerd Font", fontFamily: '"MesloLGS Nerd Font Mono", monospace', cssFile: "meslo.css" },
  { label: "Source Code Pro Nerd Font", fontFamily: '"SauceCodePro NFM", monospace', cssFile: "sourcecodepro.css" },
  { label: "Ubuntu Mono Nerd Font", fontFamily: '"UbuntuMono Nerd Font Mono", monospace', cssFile: "ubuntumono.css" },
  { label: "Victor Mono Nerd Font", fontFamily: '"VictorMono Nerd Font Mono", monospace', cssFile: "victormono.css" },
];

export const CUSTOM_FONT_VALUE = "__custom__";

export function findFontOption(fontFamily: string): FontOption | undefined {
  return FONT_OPTIONS.find(o => o.fontFamily === fontFamily);
}

export async function loadFont(option: FontOption): Promise<void> {
  if (!option.cssFile) return;
  if (document.head.querySelector(`link[data-font="${option.cssFile}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `${CDN_BASE}${option.cssFile}`;
  link.dataset.font = option.cssFile;
  document.head.appendChild(link);
  try { localStorage.setItem('mobitty-font-css', option.cssFile); } catch { /* unavailable */ }
  // document.fonts.ready can resolve before a slow CDN face has actually
  // been decoded. Wait for the specific face via document.fonts.load(),
  // with a 5s ceiling so a broken CDN can't soft-lock the page.
  const face = option.fontFamily.match(/"([^"]+)"|'([^']+)'|([^,]+)/)?.[0]?.replace(/["']/g, '').trim();
  if (!face) { await document.fonts.ready; return; }
  await Promise.race([
    document.fonts.load(`16px "${face}"`).catch(() => undefined),
    new Promise<void>(r => setTimeout(r, 5_000)),
  ]);
}
