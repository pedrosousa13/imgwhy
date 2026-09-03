import { html } from './html.js';
import type { Html } from './html.js';

/**
 * The whole of the report's presentation, inlined.
 *
 * Everything here is a literal part of a template, so nothing from the page
 * reaches it. That is not a nicety: a `<style>` element parses CSS, not HTML,
 * where `&lt;` is not a `<` and an escape buys nothing, so the rule is that no
 * value is interpolated into this at all.
 *
 * The fonts are a system stack — the design's privacy constraint, stated as
 * "use a system font stack". There is no `@font-face` and no font host, so the
 * file names no origin to fetch a face from, and no third party learns that
 * someone opened a report.
 */
export const STYLE: Html = html`<style>
  :root {
    color-scheme: light;
    --ink: #17181a;
    --muted: #5c6066;
    --paper: #ffffff;
    --band: #f4f5f7;
    --line: #d7dae0;
  }

  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    padding: 2rem 1.25rem 4rem;
    background: var(--paper);
    color: var(--ink);
    font: 15px/1.55 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial,
      sans-serif;
  }

  main {
    max-width: 84rem;
    margin: 0 auto;
  }

  h1 {
    margin: 0 0 1.25rem;
    font-size: 1.5rem;
    letter-spacing: -0.01em;
  }

  h2 {
    margin: 2.5rem 0 0.75rem;
    font-size: 1.05rem;
  }

  code,
  .id,
  .url,
  .raw,
  .sizes,
  .sizes-input {
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 0.85em;
  }

  .head {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.2rem 1rem;
    margin: 0 0 1.75rem;
  }

  .head dt {
    color: var(--muted);
  }

  .head dd {
    margin: 0;
    overflow-wrap: anywhere;
  }

  .scroll {
    overflow-x: auto;
  }

  table {
    border-collapse: collapse;
    min-width: 100%;
  }

  caption {
    margin-bottom: 0.6rem;
    color: var(--muted);
    text-align: left;
  }

  th,
  td {
    border: 1px solid var(--line);
    padding: 0.5rem 0.65rem;
    text-align: left;
    vertical-align: top;
  }

  thead th {
    background: var(--band);
    white-space: nowrap;
  }

  th.device .name {
    display: block;
  }

  th.device .profile {
    display: block;
    color: var(--muted);
    font-size: 0.8rem;
    font-weight: 400;
  }

  th.image {
    max-width: 24rem;
    font-weight: 400;
  }

  th.image .id {
    display: block;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  th.image .flag,
  th.image .sizes,
  th.image .none {
    display: block;
    margin-top: 0.3rem;
    color: var(--muted);
    overflow-wrap: anywhere;
  }

  ul.candidates {
    margin: 0.4rem 0 0;
    padding: 0;
    list-style: none;
  }

  ul.candidates li {
    display: flex;
    gap: 0.5rem;
  }

  ul.candidates .raw {
    min-width: 4rem;
    font-weight: 600;
  }

  ul.candidates .url {
    color: var(--muted);
    overflow-wrap: anywhere;
  }

  td .picked {
    display: block;
    font-weight: 600;
  }

  td .bytes {
    display: block;
    color: var(--muted);
    font-size: 0.85rem;
    font-variant-numeric: tabular-nums;
  }

  td.absent {
    color: var(--muted);
  }

  .empty {
    padding: 1rem;
    border: 1px solid var(--line);
    background: var(--band);
  }

  .lead,
  .limit,
  .reason {
    max-width: 60rem;
  }

  .lead {
    margin: 0 0 1rem;
    color: var(--muted);
  }

  .panel {
    margin: 0 0 1rem;
    padding: 1rem 1.1rem;
    border: 1px solid var(--line);
  }

  .panel h3 {
    margin: 0 0 0.35rem;
    font-size: 0.95rem;
    overflow-wrap: anywhere;
  }

  .panel .from {
    margin: 0 0 0.9rem;
    color: var(--muted);
    font-size: 0.9rem;
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    padding: 0.75rem 0.8rem;
    background: var(--band);
  }

  .control {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    color: var(--muted);
    font-size: 0.8rem;
  }

  .control:first-child {
    flex: 1 1 24rem;
  }

  input,
  textarea {
    padding: 0.3rem 0.4rem;
    border: 1px solid var(--line);
    background: var(--paper);
    color: var(--ink);
    font: inherit;
  }

  textarea {
    resize: vertical;
  }

  .limit {
    margin: 0.6rem 0 0;
    color: var(--muted);
    font-size: 0.85rem;
  }

  .sums {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.2rem 1rem;
    margin: 1rem 0 0;
  }

  .sums dt {
    color: var(--muted);
  }

  .sums dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }

  .sums .picked {
    font-weight: 600;
  }

  .panel ul.candidates {
    margin-top: 0.9rem;
  }

  .panel .mark {
    color: var(--muted);
    white-space: nowrap;
  }

  .reason {
    margin: 0.9rem 0 0;
  }

  .notes ul {
    margin: 0;
    padding-left: 1.2rem;
    max-width: 60rem;
  }

  .notes li + li {
    margin-top: 0.5rem;
  }
</style>`;
