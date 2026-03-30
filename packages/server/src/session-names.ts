const ADJECTIVES = [
  'quiet', 'blue', 'swift', 'bright', 'calm', 'dark', 'eager', 'fair',
  'gentle', 'happy', 'idle', 'keen', 'light', 'mild', 'neat', 'odd',
  'plain', 'quick', 'rare', 'soft', 'tall', 'bold', 'warm', 'young',
  'amber', 'broad', 'cool', 'deep', 'dusty', 'fresh', 'grand', 'hazy',
  'jolly', 'late', 'merry', 'noble', 'pale', 'rapid', 'sharp', 'tidy',
  'vivid', 'wise', 'agile', 'brief', 'crisp', 'dense', 'faint', 'glad',
  'hardy', 'ivory',
];

const NOUNS = [
  'falcon', 'river', 'cloud', 'stone', 'flame', 'frost', 'cedar', 'hawk',
  'maple', 'ocean', 'pearl', 'raven', 'solar', 'tiger', 'viper', 'whale',
  'badge', 'crane', 'delta', 'ember', 'forge', 'grove', 'haven', 'inlet',
  'jewel', 'knoll', 'lotus', 'marsh', 'nexus', 'orbit', 'plume', 'quill',
  'ridge', 'spark', 'trail', 'unity', 'vault', 'willow', 'creek', 'blaze',
  'coral', 'dune', 'eagle', 'field', 'glade', 'heron', 'isle', 'jade',
  'brook', 'cliff',
];

export function generateSessionName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]!;
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]!;
  return `${adj}_${noun}`;
}

export function generateUniqueSessionName(existing: Set<string>): string {
  for (let i = 0; i < 10; i++) {
    const name = generateSessionName();
    if (!existing.has(name)) return name;
  }
  // Append random digits after 10 failed attempts
  for (;;) {
    const name = generateSessionName() + Math.floor(Math.random() * 1000);
    if (!existing.has(name)) return name;
  }
}
