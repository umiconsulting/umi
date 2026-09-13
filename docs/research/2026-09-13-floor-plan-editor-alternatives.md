**Floor-plan editor alternatives — research date: 2026-09-13.** This note extends the [table-map proposal](2026-09-13-pos-table-map-and-order-traceability.md). The target is a dashboard editor for restaurant areas, table shapes, positions, and capacity. The Flutter POS will display published layouts and operational state. Documented facts below come from official documentation, source repositories, and package metadata. Recommendations are Umi-specific inferences. This research includes no installed dependency, prototype, or measured performance result.

**Decision — selected by the user, 2026-09-13.** Use Konva with React Konva for the dashboard editor. The library selection is complete. The comparisons below remain research evidence. They do not require another selection round. The [table-map proposal](2026-09-13-pos-table-map-and-order-traceability.md) records the selected stack and shared Flutter layout contract.

**Earlier assessment of alternatives.** The research shortlisted Fabric.js and tldraw as the main alternatives to Konva. Fabric offered a permissively licensed canvas foundation. tldraw offered a more complete editor under commercial terms. SVG with Moveable remained conditional on integration and maintenance checks. The user selected Konva after this comparison.

**Complete editors offer another route.** tldraw, Excalidraw, and GoJS supply more editor behavior than a drawing surface alone. Their product scope and license terms differ.

| Option | Documented capabilities | Umi-specific inference |
| --- | --- | --- |
| tldraw | React SDK; custom shapes; geometry controls; snapping; JSON snapshots | Strong candidate when a complete editor and commercial support justify the license expense |
| Excalidraw | React whiteboard; reusable shape collections; undo/redo; JSON and image export | Useful for a fast layout concept; requires careful restriction for operational table records |
| GoJS | Diagram library; React integration; floor-planner sample; data model and custom tools | Useful if detailed walls, rooms, doors, and measurements become product requirements |

**tldraw — documented facts.** A custom `ShapeUtil` defines a shape's appearance, geometry, and interaction behavior. Shape records have position, rotation, custom `props`, and JSON `meta`. These extension points can represent a restaurant table and its stable identifier. Bounds and gap snapping provide alignment and consistent spacing. The input system supports mouse, touch, pen, and pinch gestures. [Shape documentation](https://tldraw.dev/docs/shapes), [snapping](https://tldraw.dev/sdk-features/snapping), [input handling](https://tldraw.dev/sdk-features/input-handling)

Snapshots separate document state from session state, such as camera and selection. Umi can save snapshots through its backend. The default license permits development use. Commercial production requires an active commercial license key; a trial provides a limited evaluation period. Current terms differ from old articles about unrestricted production with a watermark. [Persistence](https://tldraw.dev/docs/persistence), [current license](https://tldraw.dev/community/license), [license keys](https://tldraw.dev/sdk-features/license-key)

**tldraw — Umi inference.** This is the strongest complete-editor candidate in this group. A table can have enforced behavior instead of an informal collection of shapes. The recurring license commitment must fit the feature's business value. Umi still needs permissions, publication rules, table identity validation, and conversion to its own layout contract.

**Excalidraw — documented facts.** The embedded package has an MIT license. It includes shapes, reusable libraries, undo/redo, zoom, and JSON, PNG, and SVG export. Elements accept `customData`, which can carry a table identifier. The `onChange` callback exposes scene changes for application storage. The official integration guide requires client-side rendering. [License](https://github.com/excalidraw/excalidraw/blob/master/LICENSE), [package features](https://github.com/excalidraw/excalidraw#features), [element metadata](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/), [integration](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/integration)

The official README distinguishes the embedded package from the hosted app. Hosted collaboration, offline PWA behavior, and browser autosave require additional integration in an embedded product. Documented `UIOptions` controls selected menu actions; its tool visibility option currently covers the image tool. These controls do not establish arbitrary replacement of the drawing tool system. [Hosted app distinction](https://github.com/excalidraw/excalidraw#excalidrawcom), [UI controls](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/ui-options)

**Excalidraw — Umi inference.** A table library can provide attractive presets quickly. However, metadata alone does not enforce a table's identity or permitted edits. Copy, paste, grouping, and deletion need explicit application rules. A table and its label must remain one logical record. Prefer Excalidraw if flexible sketches are the main requirement. A constrained restaurant editor needs a prototype before this choice.

**GoJS — documented facts.** The current floor-planner demo uses Svelte 5. It includes rooms, walls, dividers, measurements, doors, furniture, grid snapping, resize, rotation, undo/redo, and a JSON model. GoJS separately documents React integration. The sample therefore provides a design reference and reusable logic, rather than a complete React component for Umi. [Floor-planner demo](https://gojs.net/latest/projects/gojs-floorplanner/), [React integration](https://gojs.net/latest/learn/react)

The listed Team license costs USD 6,990 for up to three developers. It includes perpetual distribution rights and one year of support and updates. The vendor states that applications have no runtime fees or royalties. Deployment options and the license agreement determine the final scope. [Current pricing](https://gojs.net/latest/pricing)

**GoJS — Umi inference.** Detailed room geometry could justify this expense and integration work. A first release with table placement and simple walls provides a weaker business case.

**React compatibility — dated package facts.** Published package metadata reports these peer ranges. A compatible range is a preliminary check; it is not an integration test. [tldraw metadata](https://registry.npmjs.org/tldraw/5.4.2), [Excalidraw metadata](https://registry.npmjs.org/@excalidraw/excalidraw/0.18.1)

| Package | Version checked | React and React DOM peers |
| --- | --- | --- |
| tldraw | 5.4.2 | `^18.2.0 || ^19.2.1` |
| Excalidraw | 0.18.1 | `^17.0.2 || ^18.2.0 || ^19.0.0` |

**Common boundary — Umi inference.** Each option needs an adapter to a versioned Umi layout contract. Export table ID, shape, dimensions, position, rotation, and area membership. Save operational orders separately. Editor JSON supports draft recovery; it does not replace the shared contract. Validate stable IDs after duplication and import. Test touch gestures, keyboard operation, save/reload, and Flutter output with representative restaurant layouts before selection.

**Fabric.js — documented facts.** Fabric provides interactive canvas objects, editable text, groups, scale and rotation controls, viewport transforms, and SVG import/export. Its source uses the MIT license. These are useful primitives for table shapes and furniture. [Official features](https://www.fabricjs.com/), [license](https://github.com/fabricjs/fabric.js/blob/master/LICENSE)

Custom properties can hold stable IDs and participate in serialization. The documentation advises against using canvas objects as the application's data store. Fabric also documents events for application integration. [Custom properties](https://fabricjs.com/docs/using-custom-properties/), [events](https://www.fabricjs.com/docs/events/)

**Fabric.js — Umi inference.** This is the strongest direct canvas alternative in this comparison. It supplies object editing controls while Umi owns the table palette, property forms, and service rules. React integration needs an explicit lifecycle and event adapter around Fabric's object model. Keep that adapter isolated from the order domain.

Plan application work for snapping and spacing rules, command history, keyboard actions, accessible forms, and publication. Normalize scale and rotation into the shared layout geometry. Treat a drag as one undoable action. Prototype tablet gestures and simultaneous property edits before committing to the integration. A native React binding is useful, but it is not sufficient evidence that Konva is a better product fit.

**SVG with Moveable and Selecto — documented facts.** Moveable supports SVG elements, dragging, resize, rotation, group transforms, snapping, and pinch interactions. Selecto adds selection by mouse or touch. Both projects provide React packages and use MIT licenses. [Moveable](https://github.com/daybrush/moveable), [Selecto](https://github.com/daybrush/selecto)

**SVG approach — Umi inference.** React can render each table as a structured SVG element. Moveable can supply its transform controls. This gives Umi direct control over the markup and table appearance. Accessible names, keyboard commands, and ordinary property forms remain application responsibilities.

Umi must implement the viewport, undo history, object creation, table groups, and publication. Coordinate conversion needs particular care when the canvas is zoomed or a table is rotated. The libraries supply interactions rather than an editor application.

The maintenance snapshot gives a reason for caution. The latest registry releases for `react-moveable` and `react-selecto` date from 2023-12-03. Their default branches also returned latest commits from that date. This is a dated public signal, not proof of abandonment. Verify current-browser behavior and the team's capacity to maintain patches before selection. [Moveable release metadata](https://registry.npmjs.org/react-moveable), [Selecto release metadata](https://registry.npmjs.org/react-selecto), [Moveable commits](https://api.github.com/repos/daybrush/moveable/commits?per_page=1), [Selecto commits](https://api.github.com/repos/daybrush/selecto/commits?per_page=1)

**Other tools checked.** React Flow supports custom React nodes, a node resizer, and a rotation example. It can implement table placement. However, Umi would still need furniture shapes, geometric constraints, history, and publication rules. Its node-and-edge model offers limited additional value for this particular editor. [Custom nodes](https://reactflow.dev/learn/customization/custom-nodes), [resizer](https://reactflow.dev/api-reference/components/node-resizer), [rotation example](https://reactflow.dev/examples/nodes/rotatable-node)

PixiJS provides a graphics renderer. It becomes relevant if measured rendering requirements exceed the simpler approaches. It does not establish a complete floor-plan editing workflow. Umi has no such measurement yet. [PixiJS introduction](https://pixijs.com/8.x/guides/getting-started/intro)

**Release snapshot — documented facts.** Registry queries on 2026-09-13 returned the following versions. These are observations, not installation instructions. [Fabric metadata](https://registry.npmjs.org/fabric), [Moveable metadata](https://registry.npmjs.org/react-moveable), [Selecto metadata](https://registry.npmjs.org/react-selecto), [tldraw metadata](https://registry.npmjs.org/tldraw/5.4.2)

| Package | Latest version returned | Publication date | Integration note |
| --- | --- | --- | --- |
| `fabric` | 7.4.0 | 2026-05-18 | Node requirement is at least 20; React adapter remains application code. |
| `react-moveable` | 0.56.0 | 2023-12-03 | No React peer range was declared in the returned metadata. Test the integration. |
| `react-selecto` | 1.26.3 | 2023-12-03 | No React peer range was declared in the returned metadata. Test the integration. |
| `tldraw` | 5.4.2 | 2026-09-10 | Requires Node 22.12.0 or later. Verify the exact build runtime. |

Umi currently declares React 18.3.1 and Node 22.x. Those declarations support further evaluation, but the Node major alone does not satisfy tldraw's minimum minor version. [Dashboard package](../../apps/umi-dashboard/package.json)

**Selection matrix — Umi inference.** The effort column describes remaining categories of work. It is not a delivery estimate or measured comparison.

| Candidate | Best fit | Remaining editor work | Business condition |
| --- | --- | --- | --- |
| Fabric.js | Custom table editor with object controls | React adapter, snapping rules, history, forms, accessibility | Umi accepts responsibility for editor maintenance. |
| tldraw | Full editor behavior with custom table shapes | Restricted tools, table rules, UI adaptation, contract adapter | Commercial license and upgrade costs fit the feature's value. |
| SVG + Moveable + Selecto | Precise custom markup and interaction | Viewport, history, domain tools, integration maintenance | The prototype and maintenance review pass. |
| Excalidraw | Flexible plans and reusable drawing presets | Stronger table identity rules and restricted editing | Free-form drawing is a major requirement. |
| GoJS | Detailed rooms, walls, measurements, and furniture | React adaptation and restaurant-specific behavior | Architectural detail justifies license and integration costs. |
| React Flow | Table cards within a larger node-based product | Geometry behavior and restaurant editor controls | Umi also needs the node-and-edge features. |

All candidates still require table IDs, tenant permissions, occupancy checks, draft publication, and Flutter conversion. A complete editor reduces generic interaction work; it does not supply restaurant business rules.

**Business comparison.** Compare license cost plus implementation, accessibility, upgrades, support, and testing over the intended product lifetime. Fabric's MIT license removes an SDK license fee, but Umi still pays those engineering costs. tldraw advertises annual commercial licenses with pricing through sales. Its development availability must not be treated as unrestricted commercial production use. GoJS publishes developer-based licenses with perpetual distribution. [tldraw pricing](https://tldraw.dev/pricing), [GoJS pricing](https://gojs.net/latest/pricing)

**Implementation validation — selected Konva stack.** Validate the editor against these tasks:

1. Create round, square, and rectangular tables with a label and capacity.
2. Place 50 tables, plus walls and labels, in two areas. Treat this as a test fixture, not an expected merchant limit.
3. Select several tables, align them, rotate them, and undo the operation.
4. Change dimensions through a form and through touch controls.
5. Duplicate a table and assign a new stable ID.
6. Save a draft, reload it, and publish through a version check.
7. Render the same published geometry in Flutter.
8. Complete basic edits with a keyboard and verify an accessible list alternative.

Konva remains the selected library. Revisit this decision only if implementation reveals a material limitation or the product requirements change. No prototype or benchmark was run in this research round.
