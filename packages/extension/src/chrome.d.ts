/**
 * The two extension APIs this package uses, declared here rather than pulled
 * in from `@types/chrome`.
 *
 * The design's dependency table gives this package one dependency, `core`, and
 * a types package is still something to install, resolve and keep current for
 * a surface that is two calls wide. Writing it out is nine lines and it says
 * something the full typings cannot: this is the whole of the browser the
 * extension can see. A contributor reaching for `chrome.tabs` gets a type
 * error before they get to `dormant.test.ts`, which is the right order to find
 * out.
 *
 * A `.d.ts` rather than a module, because `chrome` is a global that the
 * browser supplies. Nothing imports this file; `tsconfig.json` includes it and
 * that is what puts the declaration in scope.
 */
declare const chrome: {
  action: {
    /**
     * The toolbar click. Manifest V3 requires this to be registered
     * synchronously at the worker's top level: Chrome reads the worker's
     * registrations when it starts it, and a listener added later is one it
     * has already decided the worker does not have.
     */
    onClicked: {
      addListener(handler: (tab: { id?: number }) => void): void;
    };
  };
  scripting: {
    /**
     * `func` is not sent. Its source is — the same text `String(func)`
     * returns — and the page evaluates that, so the function arrives with
     * none of its module around it. `panel.ts` says what that costs.
     */
    executeScript(injection: {
      target: { tabId: number };
      func: () => unknown;
    }): Promise<unknown>;
  };
};
