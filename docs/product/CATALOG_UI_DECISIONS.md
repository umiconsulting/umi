# UmiPOS Catalog UI Decisions

- Layout: desktop-first search, horizontal category rail, and a responsive two-to-six-column grid.
- Spacing: shared UMI spacing tokens; cards retain fixed media/content proportions to prevent shifts.
- Virtualization: `GridView.builder` creates only visible cards; cursor pages append near the viewport end.
- Images: lazy network loading, stable media area, bounded framework image cache, and broken-image fallback.
- Responsive behavior: tablet uses two-to-four columns; wide desktop uses five or six.
- Loading: bounded skeleton grid for initial/filter loads and an inline progress cell for later pages.
- Errors: public error categories map to permission, network, recoverable, or unexpected states.
- Empty states: branch-empty and search-empty states are distinct, localized, and accessible.
