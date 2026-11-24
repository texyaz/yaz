/**
 * How the AI writing tab looks.
 *
 * Every colour is one of the theme's tokens (ADR-0010): a user theme has to be
 * able to restyle everything, this tab included.
 */
export const WRITING_STYLE = `
.yaz-ai {
  font-family: var(--yaz-font-ui);
  font-size: var(--yaz-font-size-sm);
  color: var(--yaz-text-primary);
}
.yaz-ai-head {
  position: sticky;
  inset-block-start: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--yaz-space-2);
  padding: var(--yaz-space-2) var(--yaz-space-3);
  background: var(--yaz-bg-secondary);
  border-block-end: 1px solid var(--yaz-border);
  z-index: 1;
}
.yaz-ai-progress {
  font-weight: 600;
  margin-inline-end: auto;
}
.yaz-ai-filter,
.yaz-ai-button {
  font: inherit;
  color: var(--yaz-text-primary);
  background: var(--yaz-bg-primary);
  border: 1px solid var(--yaz-border);
  border-radius: var(--yaz-radius-sm);
  padding: var(--yaz-space-1) var(--yaz-space-2);
  cursor: pointer;
}
.yaz-ai-button:hover {
  background: var(--yaz-bg-hover);
}
.yaz-ai-primary {
  color: var(--yaz-text-on-accent);
  background: var(--yaz-accent);
  border-color: var(--yaz-accent);
}
.yaz-ai-primary:hover {
  background: var(--yaz-accent-hover);
}
.yaz-ai-danger {
  color: var(--yaz-error);
  border-color: var(--yaz-error);
}
.yaz-ai-empty,
.yaz-ai-note {
  margin: var(--yaz-space-2) var(--yaz-space-3);
  color: var(--yaz-text-muted);
}
.yaz-ai-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.yaz-ai-item {
  border-block-end: 1px solid var(--yaz-border);
  border-inline-start: 3px solid transparent;
}
.yaz-ai-item.yaz-ai-open {
  border-inline-start-color: var(--yaz-syntax-reference);
}
.yaz-ai-item.yaz-ai-edited {
  border-inline-start-color: var(--yaz-warning);
}
.yaz-ai-item.yaz-ai-proofed {
  border-inline-start-color: var(--yaz-success);
}
.yaz-ai-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: var(--yaz-space-2);
  align-items: baseline;
  inline-size: 100%;
  font: inherit;
  color: inherit;
  text-align: start;
  background: none;
  border: none;
  padding: var(--yaz-space-2) var(--yaz-space-3);
  cursor: pointer;
}
.yaz-ai-row:hover {
  background: var(--yaz-bg-hover);
}
.yaz-ai-line {
  color: var(--yaz-text-muted);
  font-variant-numeric: tabular-nums;
}
.yaz-ai-excerpt {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.yaz-ai-status {
  color: var(--yaz-text-secondary);
  font-size: 0.9em;
}
.yaz-ai-status-edited {
  color: var(--yaz-warning);
}
.yaz-ai-status-proofed {
  color: var(--yaz-success);
}
.yaz-ai-detail {
  padding: 0 var(--yaz-space-3) var(--yaz-space-3);
}
.yaz-ai-label {
  margin: var(--yaz-space-2) 0 var(--yaz-space-1);
  color: var(--yaz-text-secondary);
  font-weight: 600;
}
.yaz-ai-passage blockquote {
  margin: 0;
  padding: var(--yaz-space-2) var(--yaz-space-3);
  background: var(--yaz-bg-secondary);
  border-inline-start: 3px solid var(--yaz-syntax-reference);
  border-radius: var(--yaz-radius-sm);
  font-family: var(--yaz-font-prose);
}
.yaz-ai-comment {
  margin: var(--yaz-space-1) 0 0;
  color: var(--yaz-text-secondary);
  font-style: italic;
}
.yaz-ai-diff {
  margin: 0;
  font-family: var(--yaz-font-prose);
  line-height: var(--yaz-line-height);
}
.yaz-ai-diff del {
  color: var(--yaz-error);
}
.yaz-ai-diff ins {
  color: var(--yaz-success);
  text-decoration: underline;
}
.yaz-ai-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--yaz-space-2);
  margin-block-start: var(--yaz-space-2);
}
.yaz-ai-guide {
  margin: var(--yaz-space-3);
  padding: var(--yaz-space-2) var(--yaz-space-3);
  border: 1px solid var(--yaz-border);
  border-radius: var(--yaz-radius-md);
}
.yaz-ai-guide summary {
  font-weight: 600;
  cursor: pointer;
}
.yaz-ai-guide .yaz-ai-note {
  margin-inline: 0;
}
.yaz-ai-guide-text {
  white-space: pre-wrap;
  margin: 0;
  padding: var(--yaz-space-2);
  background: var(--yaz-bg-secondary);
  border-radius: var(--yaz-radius-sm);
  font-family: var(--yaz-font-ui);
}
.yaz-ai-guide-edit {
  box-sizing: border-box;
  inline-size: 100%;
  font: inherit;
  color: var(--yaz-text-primary);
  background: var(--yaz-bg-primary);
  border: 1px solid var(--yaz-border);
  border-radius: var(--yaz-radius-sm);
  padding: var(--yaz-space-2);
}
.yaz-ai-check {
  display: flex;
  gap: var(--yaz-space-2);
  align-items: center;
  margin-block-start: var(--yaz-space-2);
}
`;
