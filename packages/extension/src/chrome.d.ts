/**
 * The two extension APIs this package uses, declared here rather than pulled
 * in from `@types/chrome`.
 *
 * The design's dependency table gives this package one dependency, `core`, and
 * a types package is still something to install, resolve and keep current for
 * a surface that is two calls wide. Writing it out says something the full
 * typings cannot: this is the whole of the browser the extension can see. A
 * contributor reaching for `chrome.tabs` gets a type error before they get to
 * `dormant.test.ts`, which is the right order to find out.
 *
 * A `.d.ts` rather than a module, because `chrome` is a global that the
 * browser supplies. Nothing imports this file; both `tsconfig.json` and
 * `tsconfig.test.json` include it and that is what puts the declaration in
 * scope. `programs.test.ts` holds that, because an ambient declaration a
 * project does not name is a declaration the project does not have.
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
     * none of its module around it. `read.ts` and `panel.ts` say what that
     * costs, and it is the whole reason core stays on this side of the call.
     *
     * `args` is the way back in. Chrome serialises the array and passes it to
     * the evaluated source, which is how a panel computed here reaches a page
     * that cannot import anything: data crosses, code does not. Serialised
     * means JSON — a function, an element or a class instance in there
     * arrives as nothing — and `Panel` is strings and booleans for that
     * reason.
     *
     * The result comes back one entry per frame, and this extension injects
     * into one. `Result` is the injected function's own return type, so the
     * worker reads what the page returned without a cast: `readPage` returns
     * a reading or null, and null is the click that closed a panel.
     *
     * Two type parameters rather than a loose `unknown`, because the
     * alternative is an assertion in `background.ts` — and an assertion is a
     * claim about a value that crossed a process boundary, which is the one
     * place a claim is worth nothing.
     */
    executeScript<Result, Args extends unknown[]>(injection: {
      target: { tabId: number };
      func: (...args: Args) => Result;
      args?: Args;
    }): Promise<{ result: Result }[]>;
  };
};
