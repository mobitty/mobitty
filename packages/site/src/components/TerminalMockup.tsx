import styles from './TerminalMockup.module.css';

const terminalLines = [
  { type: 'prompt' as const, text: '$ ai-agent "refactor auth module"' },
  { type: 'output' as const, text: '\u23F3 Thinking...' },
  { type: 'output' as const, text: '' },
  { type: 'output' as const, text: "I'll refactor the auth module to use" },
  { type: 'output' as const, text: 'JWT tokens with refresh rotation...' },
];

const softKeys = ['Tab', 'Ctrl+C', '\u2191', 'Esc'];

export default function TerminalMockup() {
  return (
    <div className={styles.phoneFrame}>
      {/* Notch */}
      <div className={styles.phoneNotch} />

      {/* Terminal screen */}
      <div className={styles.screen}>
        <div className={styles.terminalContent}>
          {terminalLines.map((line, i) => (
            <div
              key={i}
              className={styles.terminalLine}
              style={{ animationDelay: `${1000 + i * 600}ms` }}
            >
              {line.type === 'prompt' ? (
                <span className={styles.promptText}>{line.text}</span>
              ) : (
                <span className={styles.outputText}>{line.text}</span>
              )}
            </div>
          ))}
          <span className={styles.cursor}>_</span>
        </div>

        {/* Soft key bar */}
        <div className={styles.softKeyBar}>
          {softKeys.map((key) => (
            <span key={key} className={styles.softKey}>{key}</span>
          ))}
        </div>
      </div>

      {/* Home indicator */}
      <div className={styles.homeIndicator} />
    </div>
  );
}
