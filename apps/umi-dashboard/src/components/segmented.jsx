// Segmented — the one filter strip this console uses everywhere: order origin,
// customer filters, staff sections, the role filter, the product filter and the
// business open/closed switch.
//
// Why a component, and why `role="group"`:
//
// The strip was hand-rolled at six call sites, and every one of them was a `div`
// with `role="tablist"` wrapped around plain `<button>`s. A tablist with no tab
// inside is an ARIA lie — axe-core reports it as `aria-required-children` on four
// routes — and it also promised the tab pattern's arrow-key navigation, which was
// never implemented. Tab, then Enter, is what actually moves this control.
//
// A named group of toggle buttons says what is true: the strip has an accessible
// name, every option reports its own pressed state, and the keyboard behaviour
// the component already had is the keyboard behaviour it announces. The selected
// option keeps the `.on` class, so `.seg button.on` in styles.css still paints
// the thumb and nothing about the look changes.
const Segmented = ({ label, options, value, onChange, className = '' }) => (
  <div className={('seg ' + className).trim()} role="group" aria-label={label}>
    {options.map((option) => {
      const on = option.id === value;
      return (
        <button
          key={option.id}
          type="button"
          className={on ? 'on' : ''}
          aria-pressed={on}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      );
    })}
  </div>
);

export { Segmented };
