export function openExternalUrl(url: string): void {
  if (!/^https?:\/\//i.test(url)) return;
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
