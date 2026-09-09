import React from 'react';
import { createPortal } from 'react-dom';
import { I } from '@/icons.jsx';

// Layout effect on the client, plain effect on the server — the popup only ever
// positions itself in the browser, so this keeps SSR (used in tests) quiet.
const useIsoLayoutEffect =
  typeof document !== 'undefined' ? React.useLayoutEffect : React.useEffect;

// Select — a custom, accessible drop-in replacement for the native <select>.
//
// Why it exists: a native <select> paints its open-list highlight with a
// browser-owned accent (a light blue in dark mode) that CSS cannot recolor in
// Chromium < 135. This control renders its own listbox, so the highlight is ours
// to theme — white in dark mode, a soft tint in light mode.
//
// It is a DROP-IN: it reads the same `<option>` children the native element took,
// and its `onChange` fires a native-shaped event `{ target: { value } }`, so the
// existing `(e) => setX(e.target.value)` handlers keep working unchanged. The
// caller's `className` (`.select`, `.topbar-select`, `.twk-field`) styles the
// trigger, so each site keeps its look.

// Flatten a React node to plain text — for the trigger label's aria text and for
// type-ahead. Rich label nodes still render as-is in the list.
function nodeToText(node) {
  if (node == null || node === false || node === true) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeToText).join('');
  if (React.isValidElement(node)) return nodeToText(node.props.children);
  return '';
}

// Pull the <option> descendants out of the children, in order. Handles arrays
// (`.map`), conditional `{cond && <option/>}` (React drops the false), and
// fragments. optgroup is not used anywhere in this app, so it is not supported.
function collectOptions(children) {
  const out = [];
  const walk = (nodes) => {
    React.Children.forEach(nodes, (child) => {
      if (!React.isValidElement(child)) return;
      if (child.type === 'option') {
        out.push({
          value: child.props.value == null ? '' : String(child.props.value),
          label: child.props.children,
          text: nodeToText(child.props.children),
          disabled: !!child.props.disabled,
        });
      } else if (child.type === React.Fragment) {
        walk(child.props.children);
      }
    });
  };
  walk(children);
  return out;
}

const Select = ({
  value,
  onChange,
  disabled = false,
  className = '',
  children,
  id,
  title,
  style,
  // Drop the leading checkmark column on the selected row. The row still bolds and
  // still carries aria-selected, so the choice reads without reserving that column.
  hideCheck = false,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
}) => {
  const options = collectOptions(children);
  const current = value == null ? '' : String(value);
  // Native <select> parity: when the value matches no option, the browser
  // displays the first option (state stays as-is). `effective` is the value the
  // control DISPLAYS; `current` stays the real value so choosing still fires
  // onChange even when the displayed fallback is picked.
  const hasMatch = options.some((o) => o.value === current);
  const effective = hasMatch || options.length === 0 ? current : options[0].value;
  const selected = options.find((o) => o.value === effective);

  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const [pos, setPos] = React.useState(null);
  const [tick, setTick] = React.useState(0); // bumps to re-measure on scroll/resize

  const triggerRef = React.useRef(null);
  const listRef = React.useRef(null);
  const listboxId = React.useId();
  const optionId = (i) => `${listboxId}-opt-${i}`;

  const firstEnabled = () => options.findIndex((o) => !o.disabled);

  const openList = () => {
    if (disabled || options.length === 0) return;
    const idx = options.findIndex((o) => o.value === effective && !o.disabled);
    setActiveIndex(idx >= 0 ? idx : firstEnabled());
    setPos(null);
    setOpen(true);
  };
  const closeList = (refocus = true) => {
    setOpen(false);
    setActiveIndex(-1);
    if (refocus) triggerRef.current?.focus();
  };

  const choose = (opt) => {
    if (!opt || opt.disabled) return;
    if (opt.value !== current) onChange?.({ target: { value: opt.value } });
    closeList();
  };

  const moveActive = (dir) =>
    setActiveIndex((i) => {
      let n = i;
      for (let step = 0; step < options.length; step += 1) {
        n = (n + dir + options.length) % options.length;
        if (!options[n].disabled) return n;
      }
      return i;
    });

  // Position the popup: clamp to the viewport's right edge and flip above when
  // there is more room there. Runs after the list is in the DOM so it can measure.
  useIsoLayoutEffect(() => {
    if (!open) return;
    const t = triggerRef.current?.getBoundingClientRect();
    const list = listRef.current;
    if (!t || !list) return;
    const m = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.max(t.width, list.offsetWidth);
    let left = t.left;
    if (left + width > vw - m) left = Math.max(m, vw - m - width);
    const spaceBelow = vh - t.bottom - m;
    const spaceAbove = t.top - m;
    const desired = list.scrollHeight;
    let top;
    let maxHeight;
    if (desired <= spaceBelow || spaceBelow >= spaceAbove) {
      top = t.bottom + 4;
      maxHeight = spaceBelow;
    } else {
      maxHeight = spaceAbove;
      top = t.top - Math.min(desired, maxHeight) - 4;
    }
    setPos({ left, top, width, maxHeight: Math.max(120, maxHeight) });
  }, [open, tick, options.length]);

  // While open: reposition on scroll/resize, close on outside pointer.
  React.useEffect(() => {
    if (!open) return undefined;
    const bump = () => setTick((n) => n + 1);
    const onDown = (e) => {
      if (triggerRef.current?.contains(e.target)) return;
      if (listRef.current?.contains(e.target)) return;
      closeList(false);
    };
    window.addEventListener('scroll', bump, true);
    window.addEventListener('resize', bump);
    document.addEventListener('mousedown', onDown, true);
    return () => {
      window.removeEventListener('scroll', bump, true);
      window.removeEventListener('resize', bump);
      document.removeEventListener('mousedown', onDown, true);
    };
  }, [open]);

  // Keep the active option in view during keyboard navigation.
  React.useEffect(() => {
    if (!open || activeIndex < 0) return;
    listRef.current
      ?.querySelector(`[data-idx="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  const onKeyDown = (e) => {
    if (disabled) return;
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        openList();
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        moveActive(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveActive(-1);
        break;
      case 'Home':
        e.preventDefault();
        setActiveIndex(firstEnabled());
        break;
      case 'End':
        e.preventDefault();
        for (let k = options.length - 1; k >= 0; k -= 1) {
          if (!options[k].disabled) {
            setActiveIndex(k);
            break;
          }
        }
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        choose(options[activeIndex]);
        break;
      case 'Escape':
        e.preventDefault();
        closeList();
        break;
      case 'Tab':
        closeList(false);
        break;
      default:
        break;
    }
  };

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        id={id}
        title={title}
        disabled={disabled}
        style={style}
        className={('ui-select-trigger ' + className).trim()}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        onClick={() => (open ? closeList() : openList())}
        onKeyDown={onKeyDown}
      >
        <span className="ui-select-value">{selected ? selected.label : ''}</span>
        <I.ChevronDown size={14} className="ui-select-caret" />
      </button>
      {open &&
        createPortal(
          <div
            ref={listRef}
            role="listbox"
            id={listboxId}
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledby}
            aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
            tabIndex={-1}
            className="ui-select-pop"
            style={{
              position: 'fixed',
              left: pos ? pos.left : -9999,
              top: pos ? pos.top : -9999,
              minWidth: pos ? pos.width : undefined,
              maxHeight: pos ? pos.maxHeight : undefined,
              visibility: pos ? 'visible' : 'hidden',
            }}
            onKeyDown={onKeyDown}
          >
            {options.map((o, idx) => (
              <div
                key={idx}
                id={optionId(idx)}
                data-idx={idx}
                role="option"
                aria-selected={o.value === effective}
                aria-disabled={o.disabled || undefined}
                className={
                  'ui-select-option' +
                  (o.value === effective ? ' selected' : '') +
                  (idx === activeIndex ? ' active' : '') +
                  (o.disabled ? ' disabled' : '')
                }
                onMouseEnter={() => !o.disabled && setActiveIndex(idx)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(o)}
              >
                {hideCheck ? null : (
                  <span className="ui-select-check" aria-hidden="true">
                    {o.value === effective ? <I.Check size={14} /> : null}
                  </span>
                )}
                <span className="ui-select-option-label">{o.label}</span>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
};

export { Select };
