/**
 * How this plugin's settings panel looks.
 *
 * Every colour is one of the theme's tokens. yaz rejects a literal colour in
 * its own components (ADR-0010) because a user theme has to be able to restyle
 * everything, and a plugin that painted itself would be the one thing on
 * screen ignoring the theme the user chose.
 */
export const SETTINGS_STYLE = `
.yaz-todoist-settings {
  border: 1px solid var(--yaz-border);
  border-radius: var(--yaz-radius-md);
  padding: var(--yaz-space-3);
  margin: 0;
  font-family: var(--yaz-font-sans);
  color: var(--yaz-text-primary);
}
.yaz-todoist-settings legend {
  padding-inline: var(--yaz-space-2);
  font-weight: 600;
}
.yaz-todoist-state {
  margin: 0 0 var(--yaz-space-2);
}
.yaz-todoist-note {
  margin: var(--yaz-space-2) 0 0;
  color: var(--yaz-text-muted);
  font-size: 0.9em;
  word-break: break-word;
}
.yaz-todoist-row {
  display: flex;
  gap: var(--yaz-space-2);
}
.yaz-todoist-field {
  flex: 1;
  min-inline-size: 0;
  font: inherit;
  padding: var(--yaz-space-1) var(--yaz-space-2);
  color: var(--yaz-text-primary);
  background: var(--yaz-bg-secondary);
  border: 1px solid var(--yaz-border);
  border-radius: var(--yaz-radius-sm);
}
.yaz-todoist-button {
  font: inherit;
  padding: var(--yaz-space-1) var(--yaz-space-3);
  color: var(--yaz-text-primary);
  background: var(--yaz-bg-secondary);
  border: 1px solid var(--yaz-border);
  border-radius: var(--yaz-radius-sm);
  cursor: pointer;
}
.yaz-todoist-button:hover {
  background: var(--yaz-bg-hover);
}
`;
