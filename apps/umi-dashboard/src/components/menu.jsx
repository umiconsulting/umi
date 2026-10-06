import React from 'react';
import { createPortal } from 'react-dom';

// Layout effect on the client, plain effect on the server — the popup only ever
// positions itself in the browser, so this keeps SSR (used in tests) quiet.
const useIsoLayoutEffect =
  typeof document !== 'undefined' ? React.useLayoutEffect : React.useEffect;

// Menu — our custom dropdown ACTION menu, the twin of `Select` (components/select.jsx).
//
// Where Select is a listbox that tracks one chosen value and paints a checkmark,
// Menu is a `role="menu"` of one-shot commands: an item runs its `onSelect` and the
// menu closes. It borrows Select's whole shell — the same `.ui-select-pop` popup,
// portalled onto <body>, clamped to the viewport's edge and flipped above when the
// space below is short, closed on outside pointer, on Escape, and on Tab — so the
// two controls read as one family.
//
// The trigger is the caller's, through `renderTrigger({ ref, open, props })`: attach
// `ref` to a real <button> and spread `props` (onClick, onKeyDown, aria-haspopup,
// aria-expanded, aria-controls) onto it. `items` is an array of
// { key, label, icon?, onSelect, danger?, disabled? }. `align` pins the menu's left
// ('start') or right ('end') edge to the trigger; a topbar control on the right
// wants 'end'.

// `widthFactor` pins the popup width to a multiple of the trigger's own width, so
// the menu reads as an extension of the button (e.g. 1.15 = 15% wider than it).
// Without it, the popup sizes to its content, at least as wide as the trigger.
const Menu = ({ items = [], renderTrigger, align = 'start', label, widthFactor }) => {
  const usable = items.filter(Boolean);

  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const [pos, setPos] = React.useState(null);
  const [tick, setTick] = React.useState(0); // bumps to re-measure on scroll/resize

  const triggerRef = React.useRef(null);
  const listRef = React.useRef(null);
  const menuId = React.useId();
  const itemId = (i) => `${menuId}-item-${i}`;

  const firstEnabled = () => usable.findIndex((it) => !it.disabled);

  const openMenu = () => {
    if (usable.length === 0) return;
    setActiveIndex(firstEnabled());
    setPos(null);
    setOpen(true);
  };
  const closeMenu = (refocus = true) => {
    setOpen(false);
    setActiveIndex(-1);
    if (refocus) triggerRef.current?.focus();
  };

  const run = (it) => {
    if (!it || it.disabled) return;
    closeMenu();
    it.onSelect?.();
  };

  const moveActive = (dir) =>
    setActiveIndex((i) => {
      let n = i;
      for (let step = 0; step < usable.length; step += 1) {
        n = (n + dir + usable.length) % usable.length;
        if (!usable[n].disabled) return n;
      }
      return i;
    });

  // Position the popup: pin to the aligned edge, clamp inside the viewport and flip
  // above when there is more room there. Runs after the list is in the DOM so it can
  // measure. Mirrors Select's placement so both popups sit the same way.
  useIsoLayoutEffect(() => {
    if (!open) return;
    const t = triggerRef.current?.getBoundingClientRect();
    const list = listRef.current;
    if (!t || !list) return;
    const m = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = widthFactor
      ? Math.round(t.width * widthFactor)
      : Math.max(t.width, list.offsetWidth);
    let left = align === 'end' ? t.right - width : t.left;
    if (left + width > vw - m) left = vw - m - width;
    if (left < m) left = m;
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
  }, [open, tick, usable.length, align, widthFactor]);

  // While open: reposition on scroll/resize, close on outside pointer.
  React.useEffect(() => {
    if (!open) return undefined;
    const bump = () => setTick((n) => n + 1);
    const onDown = (e) => {
      if (triggerRef.current?.contains(e.target)) return;
      if (listRef.current?.contains(e.target)) return;
      closeMenu(false);
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

  // Keep the active item in view during keyboard navigation.
  React.useEffect(() => {
    if (!open || activeIndex < 0) return;
    listRef.current
      ?.querySelector(`[data-idx="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  const onKeyDown = (e) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        openMenu();
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
        for (let k = usable.length - 1; k >= 0; k -= 1) {
          if (!usable[k].disabled) {
            setActiveIndex(k);
            break;
          }
        }
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        run(usable[activeIndex]);
        break;
      case 'Escape':
        e.preventDefault();
        closeMenu();
        break;
      case 'Tab':
        closeMenu(false);
        break;
      default:
        break;
    }
  };

  const triggerProps = {
    onClick: () => (open ? closeMenu() : openMenu()),
    onKeyDown,
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': open ? menuId : undefined,
  };

  return (
    <>
      {renderTrigger({ ref: triggerRef, open, props: triggerProps })}
      {open &&
        createPortal(
          <div
            ref={listRef}
            role="menu"
            id={menuId}
            aria-label={label}
            aria-activedescendant={activeIndex >= 0 ? itemId(activeIndex) : undefined}
            tabIndex={-1}
            className="ui-select-pop ui-menu-pop"
            style={{
              position: 'fixed',
              left: pos ? pos.left : -9999,
              top: pos ? pos.top : -9999,
              minWidth: pos ? pos.width : undefined,
              // A width factor pins the popup to an exact width; otherwise it may
              // grow past the trigger to fit its content.
              maxWidth: widthFactor && pos ? pos.width : undefined,
              maxHeight: pos ? pos.maxHeight : undefined,
              visibility: pos ? 'visible' : 'hidden',
            }}
            onKeyDown={onKeyDown}
          >
            {usable.map((it, idx) => {
              const Glyph = it.icon;
              return (
                <button
                  type="button"
                  key={it.key ?? idx}
                  id={itemId(idx)}
                  data-idx={idx}
                  role="menuitem"
                  disabled={it.disabled || undefined}
                  className={
                    'ui-select-option ui-menu-item' +
                    (idx === activeIndex ? ' active' : '') +
                    (it.danger ? ' danger' : '') +
                    (it.disabled ? ' disabled' : '')
                  }
                  onMouseEnter={() => !it.disabled && setActiveIndex(idx)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => run(it)}
                >
                  {Glyph ? (
                    <span className="ui-menu-item-icon" aria-hidden="true">
                      <Glyph size={16} />
                    </span>
                  ) : null}
                  <span className="ui-select-option-label">{it.label}</span>
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
};

export { Menu };
