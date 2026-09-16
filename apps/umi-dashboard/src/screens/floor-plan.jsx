import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Stage, Layer, Group, Rect, Circle, Text, Transformer, Line } from 'react-konva';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { FloorPlanDocument, FloorPlanState } from '@umi/contract/floor-plan';
import { useMerchant } from '@/lib/merchant-context.jsx';
import { fetchFloorPlan, changeFloorPlan } from '@/data.jsx';
import { resolveTheme, subscribeTheme } from '@/lib/theme.js';
import {
  areaTableCount,
  createLayout,
  duplicateElement,
  elementLabelFontSize,
  fitElement,
  layoutHistory,
  nextTableLabel,
  seatDotLayout,
  tableShowsDetail,
} from './floor-plan-model';
import './floor-plan.css';

/**
 * Floor surfaces, in the same palette the POS draws the published plan with: a
 * pale neutral canvas, white card shapes with a hairline edge, a 1px divider
 * across the middle, and seat dots below it. Konva paints onto a canvas and
 * cannot read CSS custom properties, so the surface colors live here in one
 * place; floor-plan.css only resolves the console accent for the tab strip.
 */
const FLOOR_BASE = {
  light: {
    canvas: '#ededf2',
    grid: '#e2e2ea',
    table: '#ffffff',
    tableEdge: '#dfdfe7',
    divider: '#e6e6ec',
    seat: '#9ba1ab',
    ink: '#131f44',
    inkMuted: '#5c678f',
    wall: '#64748b',
    wallEdge: '#526075',
    counter: '#e8ddc9',
    counterEdge: '#cbbda2',
    door: '#bfd7e5',
    doorEdge: '#9dbece',
    shadow: 'rgba(16, 24, 40, 0.32)',
    // Mirrors the console accent floor-plan.css resolves for the tab strip:
    // --merchant-brand on the light theme, --umi-blue on the dark ones.
    select: '#25634d',
  },
  dark: {
    canvas: '#15161a',
    grid: '#23252c',
    table: '#25272e',
    tableEdge: '#3b3e47',
    divider: '#3b3e47',
    seat: '#a7adb8',
    ink: '#edf1f8',
    inkMuted: '#99a2b5',
    wall: '#5a6577',
    wallEdge: '#76829a',
    counter: '#4a4231',
    counterEdge: '#5e5440',
    door: '#2e4557',
    doorEdge: '#3d5a70',
    shadow: null,
    select: '#7692cb',
  },
};

/** Resolve the floor palette for a console theme name. */
function floorPalette(theme) {
  const dark = theme !== 'umi';
  const base = dark ? FLOOR_BASE.dark : FLOOR_BASE.light;
  return {
    ...base,
    fill: {
      table: base.table,
      wall: base.wall,
      counter: base.counter,
      door: base.door,
      label: 'transparent',
    },
    edge: {
      table: base.tableEdge,
      wall: base.wallEdge,
      counter: base.counterEdge,
      door: base.doorEdge,
      label: 'transparent',
    },
    ink: {
      table: base.ink,
      wall: '#ffffff',
      counter: base.ink,
      door: base.ink,
      label: base.inkMuted,
    },
  };
}

function useThemeName() {
  return useSyncExternalStore(subscribeTheme, resolveTheme, () => 'umi');
}

/** Theme-aware floor palette, refreshed when the console theme flips. */
function useFloorPalette() {
  const theme = useThemeName();
  return useMemo(() => floorPalette(theme), [theme]);
}

function PlanElement({
  element,
  selected,
  disabled,
  interacting,
  palette,
  onInteractionStart,
  onInteractionEnd,
  onSelect,
  onChange,
  snap,
  area,
}) {
  const ref = useRef();
  const transform = useRef();
  useEffect(() => {
    if (selected && !disabled && transform.current) transform.current.nodes([ref.current]);
  }, [selected, disabled]);
  const commit = (next) => {
    const fitted = fitElement(next, area, snap);
    const accepted = onChange(fitted);
    const position = accepted ? fitted : element;
    // Reconcile even when snapping produces the existing document coordinates.
    ref.current.setAttrs({
      x: position.x,
      y: position.y,
      rotation: position.rotation,
      scaleX: 1,
      scaleY: 1,
    });
    onInteractionEnd(element.id);
  };
  const endTransform = () => {
    const node = ref.current;
    let width = Math.max(8, Math.round(element.width * node.scaleX()));
    let height = Math.max(8, Math.round(element.height * node.scaleY()));
    if (element.shape !== 'rectangle') height = width = Math.max(width, height);
    commit({
      ...element,
      width,
      height,
      x: node.x(),
      y: node.y(),
      rotation: ((Math.round(node.rotation()) % 360) + 360) % 360,
    });
  };
  const round = element.shape === 'round';
  const detailed = tableShowsDetail(element);
  const bandHeight = detailed ? element.height / 2 : element.height;
  // A round table's lower band narrows toward the bottom, so the seat dots lay
  // out in a narrower band; the inset below keeps that band centered under the
  // label instead of hugging the left edge of the circle.
  const seatBandWidth = round ? element.width * 0.72 : element.width;
  const seatInset = (element.width - seatBandWidth) / 2;
  const seats = detailed
    ? seatDotLayout(element.capacity, { width: seatBandWidth, height: bandHeight })
    : null;
  const fill = palette.fill[element.kind] ?? palette.fill.table;
  const edge = selected ? palette.select : (palette.edge[element.kind] ?? palette.edge.table);
  const isText = element.kind === 'label';
  const shadow = element.kind === 'table' ? palette.shadow : null;
  const body = {
    fill,
    stroke: edge,
    strokeWidth: selected ? (isText ? 2 : 3) : isText ? 0 : 1,
    dash: selected && isText ? [8, 6] : undefined,
    shadowColor: shadow ?? undefined,
    shadowBlur: shadow ? 6 : 0,
    shadowOffsetY: shadow ? 2 : 0,
    shadowForStrokeEnabled: false,
  };
  const label = {
    x: -element.width / 2,
    y: -element.height / 2,
    width: element.width,
    height: bandHeight,
    text: element.label,
    fontSize: elementLabelFontSize(element),
    fontStyle: 'bold',
    align: 'center',
    verticalAlign: 'middle',
    wrap: 'none',
    ellipsis: true,
    fill: palette.ink[element.kind] ?? palette.ink.table,
    listening: false,
  };
  return (
    <>
      <Group
        _useStrictMode={!interacting}
        ref={ref}
        id={element.id}
        x={element.x}
        y={element.y}
        rotation={element.rotation}
        scaleX={1}
        scaleY={1}
        draggable={!disabled}
        onClick={onSelect}
        onTap={onSelect}
        onDragStart={() => onInteractionStart(element.id)}
        onDragEnd={() => commit({ ...element, x: ref.current.x(), y: ref.current.y() })}
        onTransformStart={() => onInteractionStart(element.id)}
        onTransformEnd={endTransform}
      >
        {round ? (
          <Circle radius={element.width / 2} {...body} />
        ) : (
          <Rect
            x={-element.width / 2}
            y={-element.height / 2}
            width={element.width}
            height={element.height}
            cornerRadius={element.kind === 'table' ? 8 : 2}
            {...body}
          />
        )}
        <Text {...label} />
        {detailed && (
          <>
            <Line
              points={[
                -element.width / 2,
                -element.height / 2 + bandHeight,
                element.width / 2,
                -element.height / 2 + bandHeight,
              ]}
              stroke={palette.divider}
              strokeWidth={1}
              // One device-independent hairline, whatever the canvas zoom is.
              strokeScaleEnabled={false}
              listening={false}
            />
            {seats.dots.map((dot, index) => (
              <Circle
                key={`seat-${index}`}
                x={-element.width / 2 + seatInset + dot.x}
                y={-element.height / 2 + bandHeight + dot.y}
                radius={dot.radius}
                fill={palette.seat}
                listening={false}
              />
            ))}
          </>
        )}
      </Group>
      {selected && !disabled && (
        <Transformer
          ref={transform}
          flipEnabled={false}
          keepRatio={element.shape !== 'rectangle'}
          rotationSnaps={snap ? [0, 45, 90, 135, 180, 225, 270, 315] : []}
          boundBoxFunc={(oldBox, box) =>
            Math.abs(box.width) < 8 || Math.abs(box.height) < 8 ? oldBox : box
          }
        />
      )}
    </>
  );
}

/**
 * The area strip is the editor's area navigation: one scrolling row of tabs, each
 * carrying the area name and its table count, with the active area marked by a
 * strong underline. It is a real tablist, so arrow keys move between areas and no
 * second control has to duplicate the choice.
 */
function AreaTabs({ areas, selectedId, panelId, disabled, onSelect, onAddArea, canAdd }) {
  const { t } = useLingui();
  const list = useRef(null);
  const move = (event, index) => {
    const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    const last = areas.length - 1;
    if (!step && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? last
          : (index + step + last + 1) % (last + 1);
    onSelect(areas[next].id);
    list.current?.querySelectorAll('[role="tab"]')[next]?.focus();
  };
  return (
    <div className="fp-areas card">
      <div className="fp-tabs" role="tablist" aria-label={t`Áreas`} ref={list}>
        {areas.map((item, index) => {
          const active = item.id === selectedId;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`fp-area-tab-${item.id}`}
              aria-selected={active}
              aria-controls={panelId}
              tabIndex={active ? 0 : -1}
              className={active ? 'fp-tab fp-tab-active' : 'fp-tab'}
              onClick={() => onSelect(item.id)}
              onKeyDown={(event) => move(event, index)}
            >
              <span className="fp-tab-name">{item.name}</span>
              <span className="fp-tab-count">
                <Plural value={areaTableCount(item)} one="# mesa" other="# mesas" />
              </span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="btn btn-sm fp-add-area"
        disabled={disabled || !canAdd}
        onClick={onAddArea}
      >
        <span aria-hidden="true">+</span>
        <Trans>Agregar área</Trans>
      </button>
    </div>
  );
}

export function FloorPlanEditor({ merchantId, locationId }) {
  const { t } = useLingui();
  const palette = useFloorPalette();
  const [remote, setRemote] = useState(null);
  const [history, dispatch] = useReducer(layoutHistory, { past: [], present: null, future: [] });
  const [saved, setSaved] = useState('');
  const [selectedArea, setSelectedArea] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [interactionId, setInteractionId] = useState(null);
  const [preview, setPreview] = useState(false);
  const [snap, setSnap] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [viewportWidth, setViewportWidth] = useState(640);
  const [pendingCommand, setPendingCommand] = useState(null);
  const [initialName] = useState(() => t`Salón`);
  const recoveryKey = `umi:floor-plan:${merchantId}:${locationId}`;
  const alive = useRef(true);
  const canvas = useRef(null);
  const interaction = useRef(null);
  const saveTimer = useRef(null);
  const saving = useRef(false);

  const document = preview ? remote?.published : history.present;
  const area = document?.areas.find((item) => item.id === selectedArea) ?? document?.areas[0];
  const element = area?.elements.find((item) => item.id === selected);
  const serialized = JSON.stringify(history.present);
  const dirty = !!history.present && serialized !== saved;
  const valid = FloorPlanDocument.safeParse(history.present).success;
  const elementCount =
    history.present?.areas.reduce((count, item) => count + item.elements.length, 0) ?? 0;
  const disabled = preview || busy || !!pendingCommand || error === 'conflict';
  const controlsDisabled = disabled || interactionId !== null;

  const startInteraction = (id) => {
    interaction.current = id;
    clearTimeout(saveTimer.current);
    setInteractionId(id);
  };
  const endInteraction = (id) => {
    if (interaction.current !== id) return;
    interaction.current = null;
    setInteractionId(null);
  };

  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    fetchFloorPlan(merchantId, locationId)
      .then((value) => {
        if (cancelled) return;
        const state = FloorPlanState.parse(value);
        setRemote(state);
        const draft = state.draft ?? createLayout(initialName);
        let recovery = null;
        try {
          const cached = JSON.parse(sessionStorage.getItem(recoveryKey));
          if (cached && FloorPlanDocument.safeParse(cached.document).success) recovery = cached;
        } catch {
          /* Storage can be unavailable. */
        }
        dispatch({ type: 'reset', document: recovery?.document ?? draft });
        setSaved(JSON.stringify(draft));
        if (recovery?.pending) {
          setPendingCommand(recovery.pending);
          setError('save');
        } else if (recovery && recovery.version !== state.version) setError('conflict');
      })
      .catch(() => {
        if (!cancelled) setError('load');
      });
    return () => {
      cancelled = true;
      alive.current = false;
    };
  }, [merchantId, locationId, initialName, recoveryKey]);

  useEffect(() => {
    if (!canvas.current) return;
    const observer = new ResizeObserver(([entry]) => setViewportWidth(entry.contentRect.width));
    observer.observe(canvas.current);
    return () => observer.disconnect();
  }, [remote]);

  useEffect(() => {
    if (!dirty && !pendingCommand) return;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, busy, error, pendingCommand]);

  useEffect(() => {
    if (!remote || !history.present) return;
    try {
      if ((dirty || pendingCommand) && valid) {
        sessionStorage.setItem(
          recoveryKey,
          JSON.stringify({
            version: remote.version,
            document: history.present,
            pending: pendingCommand,
          }),
        );
      } else if (!dirty && !pendingCommand) sessionStorage.removeItem(recoveryKey);
    } catch {
      /* The unload warning remains available when storage is full. */
    }
  }, [remote, history.present, dirty, pendingCommand, valid, recoveryKey]);

  const submit = useCallback(
    async (publish = false) => {
      if (saving.current || interaction.current !== null) return;
      if (publish && !pendingCommand && (disabled || dirty || !valid || !remote?.draft)) return;
      const command = pendingCommand ?? {
        publish,
        payload: {
          locationId,
          expectedVersion: remote.version,
          idempotencyKey: crypto.randomUUID(),
          ...(publish ? {} : { document: history.present }),
        },
      };
      saving.current = true;
      setPendingCommand(command);
      setBusy(true);
      setError(null);
      try {
        const state = FloorPlanState.parse(
          await changeFloorPlan(merchantId, command.payload, command.publish),
        );
        if (!alive.current) return;
        setPendingCommand(null);
        setRemote(state);
        dispatch({ type: 'canonical', document: state.draft });
        setSaved(JSON.stringify(state.draft));
      } catch (failure) {
        if (alive.current) setError(failure.status === 409 ? 'conflict' : 'save');
      } finally {
        saving.current = false;
        if (alive.current) setBusy(false);
      }
    },
    [pendingCommand, locationId, remote, history.present, merchantId, disabled, dirty, valid],
  );

  useEffect(() => {
    if (!dirty || !valid || busy || error || pendingCommand || preview || interactionId !== null)
      return;
    saveTimer.current = setTimeout(() => submit(false), 900);
    return () => clearTimeout(saveTimer.current);
  }, [dirty, valid, serialized, busy, error, preview, pendingCommand, submit, interactionId]);

  const editArea = (patch) => {
    if (disabled || saving.current) return false;
    dispatch({
      type: 'edit',
      document: {
        ...history.present,
        areas: history.present.areas.map((item) =>
          item.id === area.id ? { ...item, ...patch } : item,
        ),
      },
    });
    return true;
  };
  const editElement = (next) => {
    return editArea({ elements: area.elements.map((item) => (item.id === next.id ? next : item)) });
  };
  const add = (kind, shape = 'rectangle') => {
    const size =
      kind === 'wall'
        ? [200, 12]
        : kind === 'counter'
          ? [180, 60]
          : kind === 'door'
            ? [70, 16]
            : [100, shape === 'rectangle' ? 70 : 100];
    const labels = { wall: t`Muro`, counter: t`Barra`, door: t`Puerta`, label: t`Texto` };
    const next = {
      id: crypto.randomUUID(),
      kind,
      shape,
      label: kind === 'table' ? nextTableLabel(area.elements) : labels[kind],
      capacity: kind === 'table' ? 4 : 0,
      x: area.width / 2,
      y: area.height / 2,
      width: size[0],
      height: size[1],
      rotation: 0,
    };
    editArea({ elements: [...area.elements, next] });
    setSelected(next.id);
  };
  const addArea = () => {
    if (controlsDisabled || history.present.areas.length >= 20) return;
    const next = createLayout(`${t`Área`} ${history.present.areas.length + 1}`).areas[0];
    dispatch({
      type: 'edit',
      document: { ...history.present, areas: [...history.present.areas, next] },
    });
    setSelectedArea(next.id);
    setSelected(null);
  };
  const keyboard = (event) => {
    if (
      controlsDisabled ||
      !element ||
      /INPUT|SELECT|TEXTAREA/.test(event.target.tagName) ||
      // Arrow keys belong to the area tablist while a tab holds focus.
      event.target.closest?.('[role="tab"]')
    )
      return;
    const offsets = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (!offsets[event.key]) return;
    event.preventDefault();
    const [dx, dy] = offsets[event.key];
    const step = event.shiftKey ? 20 : 1;
    editElement(
      fitElement({ ...element, x: element.x + dx * step, y: element.y + dy * step }, area),
    );
  };
  if (!remote)
    return (
      <div className="card fp-message" role="status">
        {error ? (
          <>
            <Trans>No se pudo cargar el plano.</Trans>{' '}
            <button className="btn" onClick={() => window.location.reload()}>
              <Trans>Reintentar</Trans>
            </button>
          </>
        ) : (
          <Trans>Carga del plano…</Trans>
        )}
      </div>
    );
  const scale = Math.min(1, viewportWidth / Math.max(200, area?.width ?? 1200)) * zoom;
  return (
    <div className="floor-plan" onKeyDown={keyboard}>
      <div className="fp-toolbar card">
        <div>
          <strong>
            <Trans>Plano de mesas</Trans>
          </strong>
          <p>
            <Trans>Diseña tu espacio y publica el plano en el punto de venta.</Trans>
          </p>
        </div>
        <div className="fp-actions">
          <span role="status" className="fp-status">
            {busy
              ? t`Guardado en curso…`
              : dirty
                ? t`Cambios pendientes`
                : remote.draft
                  ? t`Borrador guardado`
                  : t`Nuevo borrador`}
          </span>
          <button
            className="btn"
            disabled={busy || !!pendingCommand || interactionId !== null || !remote.published}
            onClick={() => {
              setPreview(!preview);
              setSelected(null);
            }}
          >
            {preview ? t`Volver al borrador` : t`Ver publicado`}
          </button>
          <button
            className="btn btn-primary"
            disabled={
              controlsDisabled ||
              dirty ||
              !valid ||
              !remote.draft ||
              JSON.stringify(remote.published) === saved
            }
            onClick={() => submit(true)}
          >
            <Trans>Publicar</Trans>
          </button>
        </div>
      </div>
      {error && (
        <div role="alert" className="fp-alert">
          {error === 'conflict'
            ? t`Otro usuario cambió el plano. Recarga para obtener la versión actual.`
            : t`No se confirmó el guardado. Reintenta antes de continuar.`}
          {error !== 'conflict' && (
            <button className="btn" disabled={busy} onClick={() => submit()}>
              <Trans>Reintentar</Trans>
            </button>
          )}
          <button
            className="btn"
            onClick={() => {
              if (window.confirm(t`Se descartarán los cambios locales. ¿Recargar el plano?`)) {
                sessionStorage.removeItem(recoveryKey);
                window.location.reload();
              }
            }}
          >
            <Trans>Recargar</Trans>
          </button>
        </div>
      )}
      {!valid && !preview && (
        <p role="alert" className="fp-alert">
          <Trans>
            Revisa nombres únicos, capacidad y dimensiones. Los elementos deben quedar dentro del
            área.
          </Trans>
        </p>
      )}
      <AreaTabs
        areas={document?.areas ?? []}
        selectedId={area?.id}
        panelId="fp-area-panel"
        disabled={controlsDisabled}
        canAdd={history.present.areas.length < 20}
        onSelect={(id) => {
          setSelectedArea(id);
          setSelected(null);
        }}
        onAddArea={addArea}
      />
      <div className="fp-controls">
        <div className="fp-control-group" role="group" aria-label={t`Historial`}>
          <button
            className="btn btn-sm"
            disabled={controlsDisabled || !history.past.length}
            onClick={() => dispatch({ type: 'undo' })}
          >
            <Trans>Deshacer</Trans>
          </button>
          <button
            className="btn btn-sm"
            disabled={controlsDisabled || !history.future.length}
            onClick={() => dispatch({ type: 'redo' })}
          >
            <Trans>Rehacer</Trans>
          </button>
        </div>
        <div className="fp-control-group" role="group" aria-label={t`Cuadrícula y zoom`}>
          <label className="fp-check">
            <input
              type="checkbox"
              disabled={controlsDisabled}
              checked={snap}
              onChange={(event) => setSnap(event.target.checked)}
            />
            <Trans>Ajustar a cuadrícula</Trans>
          </label>
          <label className="fp-zoom">
            <Trans>Zoom</Trans>
            <select
              disabled={interactionId !== null}
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
            >
              {[0.5, 1, 1.5, 2].map((value) => (
                <option key={value} value={value}>
                  {value * 100}%
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <div className="fp-workspace">
        <aside className="card fp-palette">
          <h3>
            <Trans>Elementos</Trans>
          </h3>
          <fieldset
            disabled={
              controlsDisabled || !area || area.elements.length >= 500 || elementCount >= 1000
            }
          >
            <button className="btn" onClick={() => add('table', 'round')}>
              <span aria-hidden="true">◯</span>
              <Trans>Mesa redonda</Trans>
            </button>
            <button className="btn" onClick={() => add('table', 'square')}>
              <span aria-hidden="true">□</span>
              <Trans>Mesa cuadrada</Trans>
            </button>
            <button className="btn" onClick={() => add('table')}>
              <span aria-hidden="true">▭</span>
              <Trans>Mesa rectangular</Trans>
            </button>
            <button className="btn" onClick={() => add('wall')}>
              <Trans>Muro</Trans>
            </button>
            <button className="btn" onClick={() => add('counter')}>
              <Trans>Barra</Trans>
            </button>
            <button className="btn" onClick={() => add('door')}>
              <Trans>Puerta</Trans>
            </button>
            <button className="btn" onClick={() => add('label')}>
              <Trans>Texto</Trans>
            </button>
          </fieldset>
          <h3>
            <Trans>Lista de elementos</Trans>
          </h3>
          <div className="fp-element-list">
            {area?.elements.map((item) => (
              <button
                key={item.id}
                className={'btn' + (selected === item.id ? ' active' : '')}
                aria-pressed={selected === item.id}
                disabled={interactionId !== null}
                onClick={() => setSelected(item.id)}
              >
                {item.label}
                {item.kind === 'table' ? ` · ${item.capacity}` : ''}
              </button>
            ))}
          </div>
        </aside>
        <div
          ref={canvas}
          id="fp-area-panel"
          role="tabpanel"
          aria-labelledby={area ? `fp-area-tab-${area.id}` : undefined}
          className="fp-canvas card"
          tabIndex={0}
          style={{ background: palette.canvas }}
          aria-label={t`Plano. Selecciona un elemento de la lista para editarlo con el teclado.`}
        >
          {area && (
            <Stage
              width={Math.max(200, Math.min(5000, area.width)) * scale}
              height={Math.max(200, Math.min(5000, area.height)) * scale}
              scaleX={scale}
              scaleY={scale}
              onMouseDown={(event) => {
                if (event.target === event.target.getStage()) setSelected(null);
              }}
            >
              {/* The authoring grid belongs to the editor; the published preview
                  shows the POS surface as the POS draws it. */}
              {!preview && (
                <Layer listening={false}>
                  {Array.from(
                    { length: Math.floor(Math.max(200, Math.min(5000, area.width)) / 20) + 1 },
                    (_, index) => (
                      <Line
                        key={`x${index}`}
                        points={[index * 20, 0, index * 20, area.height]}
                        stroke={palette.grid}
                        strokeWidth={1}
                        strokeScaleEnabled={false}
                      />
                    ),
                  )}
                  {Array.from(
                    { length: Math.floor(Math.max(200, Math.min(5000, area.height)) / 20) + 1 },
                    (_, index) => (
                      <Line
                        key={`y${index}`}
                        points={[0, index * 20, area.width, index * 20]}
                        stroke={palette.grid}
                        strokeWidth={1}
                        strokeScaleEnabled={false}
                      />
                    ),
                  )}
                </Layer>
              )}
              <Layer>
                {area.elements.map((item) => (
                  <PlanElement
                    key={item.id}
                    element={item}
                    selected={selected === item.id}
                    disabled={disabled || (interactionId !== null && interactionId !== item.id)}
                    interacting={interactionId === item.id}
                    palette={palette}
                    onInteractionStart={startInteraction}
                    onInteractionEnd={endInteraction}
                    onSelect={() => setSelected(item.id)}
                    onChange={editElement}
                    snap={snap}
                    area={area}
                  />
                ))}
              </Layer>
            </Stage>
          )}
        </div>
        <aside className="card fp-properties">
          <h3>{element ? t`Propiedades` : t`Área`}</h3>
          <fieldset disabled={controlsDisabled || !area}>
            <label>
              <Trans>Nombre</Trans>
              <input
                maxLength={80}
                value={element?.label ?? area?.name ?? ''}
                onChange={(event) =>
                  element
                    ? editElement({ ...element, label: event.target.value })
                    : editArea({ name: event.target.value })
                }
              />
            </label>
            {element?.kind === 'table' && (
              <>
                <label>
                  <Trans>Forma</Trans>
                  <select
                    value={element.shape}
                    onChange={(event) =>
                      editElement(
                        fitElement(
                          {
                            ...element,
                            shape: event.target.value,
                            height:
                              event.target.value === 'rectangle' ? element.height : element.width,
                          },
                          area,
                        ),
                      )
                    }
                  >
                    <option value="rectangle">{t`Rectangular`}</option>
                    <option value="round">{t`Redonda`}</option>
                    <option value="square">{t`Cuadrada`}</option>
                  </select>
                </label>
                <label>
                  <Trans>Capacidad</Trans>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={element.capacity}
                    onChange={(event) =>
                      editElement({ ...element, capacity: Number(event.target.value) })
                    }
                  />
                </label>
              </>
            )}
            {(element ? ['width', 'height', 'x', 'y', 'rotation'] : ['width', 'height']).map(
              (field) => {
                const labels = {
                  width: t`Ancho`,
                  height: t`Alto`,
                  x: t`Posición X`,
                  y: t`Posición Y`,
                  rotation: t`Rotación`,
                };
                return (
                  <label key={field}>
                    {labels[field]}
                    <input
                      type="number"
                      min={
                        field === 'rotation' || field === 'x' || field === 'y'
                          ? 0
                          : element
                            ? 8
                            : 200
                      }
                      max={field === 'rotation' ? 359 : 5000}
                      value={(element ?? area)?.[field] ?? 0}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (!element) return editArea({ [field]: value });
                        const patch = { ...element, [field]: value };
                        if (
                          element.shape !== 'rectangle' &&
                          (field === 'width' || field === 'height')
                        )
                          patch.width = patch.height = value;
                        editElement(patch);
                      }}
                    />
                  </label>
                );
              },
            )}
            {element && (
              <>
                <button
                  className="btn"
                  disabled={area.elements.length >= 500 || elementCount >= 1000}
                  onClick={() => {
                    const copy = duplicateElement(element, area);
                    editArea({ elements: [...area.elements, copy] });
                    setSelected(copy.id);
                  }}
                >
                  <Trans>Duplicar</Trans>
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    editArea({ elements: area.elements.filter((item) => item.id !== selected) });
                    setSelected(null);
                  }}
                >
                  <Trans>Eliminar elemento</Trans>
                </button>
                <button className="btn" onClick={() => setSelected(null)}>
                  <Trans>Editar área</Trans>
                </button>
              </>
            )}
          </fieldset>
          <p>
            {preview
              ? t`Esta es la versión publicada en el punto de venta.`
              : t`El borrador se guarda automáticamente. Publica para actualizar el punto de venta.`}
          </p>
        </aside>
      </div>
    </div>
  );
}

export default function FloorPlanScreen() {
  const context = useMerchant();
  const merchantId = context?.selectedMerchantId || context?.capabilities?.merchant?.id;
  const locationId = context?.selectedLocationId || context?.capabilities?.selectedLocation?.id;
  if (!merchantId || !locationId)
    return (
      <div className="card fp-message">
        <Trans>Selecciona una sucursal para editar su plano.</Trans>
      </div>
    );
  return (
    <FloorPlanEditor
      key={`${merchantId}:${locationId}`}
      merchantId={merchantId}
      locationId={locationId}
    />
  );
}
