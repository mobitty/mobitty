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

  // Re-use an existing <link> if a previous loadFont() already added it
  // (concurrent or repeat call); otherwise create one. We must NOT
  // early-return when the link exists — the second caller still has to
  // await its load if the stylesheet isn't parsed yet.
  let link = document.head.querySelector(
    `link[data-font="${option.cssFile}"]`,
  ) as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `${CDN_BASE}${option.cssFile}`;
    link.dataset.font = option.cssFile;
    document.head.appendChild(link);
    try { localStorage.setItem('mobitty-font-css', option.cssFile); } catch { /* unavailable */ }
  }

  const face = option.fontFamily.match(/"([^"]+)"|'([^']+)'|([^,]+)/)?.[0]?.replace(/["']/g, '').trim();

  // Single 5s deadline covering BOTH the stylesheet parse and the font
  // face decode. Awaiting link.onload first is required: document.fonts
  // .load(face) only matches @font-face rules already registered in
  // document.fonts. Calling it immediately after appendChild() resolves
  // with zero matches (the rule isn't parsed yet), so the gate silently
  // passes through and the terminal mounts with the monospace fallback —
  // which the WebGL atlas then bakes ("crisp but wrong" symptom).
  const deadline = new Promise<void>(r => setTimeout(r, 5_000));
  const ready = (async () => {
    if (!link!.sheet) {
      await new Promise<void>(resolve => {
        link!.addEventListener('load', () => resolve(), { once: true });
        link!.addEventListener('error', () => resolve(), { once: true });
      });
    }
    if (face) await document.fonts.load(`16px "${face}"`).catch(() => undefined);
  })();
  await Promise.race([ready, deadline]);
}
