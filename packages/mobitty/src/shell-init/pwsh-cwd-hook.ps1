# Mobitty cwd reporting hook for PowerShell.
# Wraps the existing prompt to emit OSC 7 (file:// URI of cwd) before each
# prompt is drawn, so the mobitty server can keep the session list in sync.
# Idempotent: re-running the script does not double-wrap.

if (-not $global:__mobitty_orig_prompt) {
  $global:__mobitty_orig_prompt = $function:prompt
  function global:prompt {
    try {
      $loc = $executionContext.SessionState.Path.CurrentLocation
      if ($loc.Provider.Name -eq 'FileSystem') {
        $p = $loc.ProviderPath -replace '\\', '/'
        if ($p -notmatch '^/') { $p = '/' + $p }
        $encoded = [System.Uri]::EscapeUriString($p)
        $hostName = if ($env:COMPUTERNAME) { $env:COMPUTERNAME } else { '' }
        # [char]27 instead of `e — Windows PowerShell 5.1 lacks `e (PS 6.0+).
        $esc = [char]27
        [System.Console]::Write("$esc]7;file://${hostName}${encoded}$esc\")
      }
    } catch { }
    & $global:__mobitty_orig_prompt
  }
}
