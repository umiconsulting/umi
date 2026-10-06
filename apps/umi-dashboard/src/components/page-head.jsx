/**
 * PageHead — the one band a screen may put under the masthead.
 *
 * The masthead already says the page name. Before this component, every screen
 * said it a second time, and some a third: `Catálogo e inventario` appeared in the
 * masthead, in the hub tab, and again as a card heading, and `Clientes` appeared
 * twice inside 100 pixels. The design audit measured the pattern on 16 screens and
 * called it fault F1.
 *
 * So a screen may hold ONE line here, and it must be one of three shapes:
 *
 *   <PageHead note="…" />        a sentence of orientation, when the screen needs it
 *   <PageHead count="128 artículos" />   a count, when the screen holds a set
 *   <PageHead state={<Badge/>} />        a live state, when the screen is a board
 *
 * `actions` holds the screen's ONE primary action and nothing else. A secondary
 * action belongs on the object it acts on.
 *
 * The rule is checkable: a screen that passes two of `note`, `count`, and `state`
 * is doing two jobs, and it should split.
 */
export function PageHead({ note, count, state, actions }) {
  const shapes = [note, count, state].filter(Boolean).length;
  if (shapes > 1) {
    // A development-time complaint, not a runtime error. The band still renders,
    // because a screen mid-migration must not blank itself out.
    console.warn(
      '[PageHead] A page head may hold one shape: note, count, or state. This one holds ' +
        `${shapes}.`,
    );
  }

  return (
    <div className="page-head">
      <div className="page-head-line">
        {note ? <span className="page-head-note">{note}</span> : null}
        {count ? <span className="page-head-count">{count}</span> : null}
        {state || null}
      </div>
      {actions ? <div className="page-head-actions">{actions}</div> : null}
    </div>
  );
}
