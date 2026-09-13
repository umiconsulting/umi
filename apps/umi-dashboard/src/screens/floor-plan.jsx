import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Stage, Layer, Group, Rect, Circle, Text, Transformer, Line } from 'react-konva';
import { Trans, useLingui } from '@lingui/react/macro';
import { FloorPlanDocument, FloorPlanState } from '@umi/contract/floor-plan';
import { useMerchant } from '@/lib/merchant-context.jsx';
import { fetchFloorPlan, changeFloorPlan } from '@/data.jsx';
import {
  createLayout,
  duplicateElement,
  fitElement,
  layoutHistory,
  nextTableLabel,
} from './floor-plan-model';
import './floor-plan.css';

const COLORS = {
  table: '#dcebe4',
  wall: '#64748b',
  counter: '#e8ddc9',
  door: '#bfd7e5',
  label: '#f1f5f9',
};

function PlanElement({ element, selected, disabled, onSelect, onChange, snap, area }) {
  const ref = useRef();
  const transform = useRef();
  useEffect(() => {
    if (selected && !disabled && transform.current) transform.current.nodes([ref.current]);
  }, [selected, disabled]);
  const endTransform = () => {
    const node = ref.current;
    let width = Math.max(8, Math.round(element.width * node.scaleX()));
    let height = Math.max(8, Math.round(element.height * node.scaleY()));
    if (element.shape !== 'rectangle') height = width = Math.max(width, height);
    node.scaleX(1);
    node.scaleY(1);
    onChange(
      fitElement(
        {
          ...element,
          width,
          height,
          x: node.x(),
          y: node.y(),
          rotation: ((Math.round(node.rotation()) % 360) + 360) % 360,
        },
        area,
        snap,
      ),
    );
  };
  return (
    <>
      <Group
        ref={ref}
        id={element.id}
        x={element.x}
        y={element.y}
        rotation={element.rotation}
        draggable={!disabled}
        onClick={onSelect}
        onTap={onSelect}
        onDragEnd={(event) =>
          onChange(fitElement({ ...element, x: event.target.x(), y: event.target.y() }, area, snap))
        }
        onTransformEnd={endTransform}
      >
        {element.shape === 'round' ? (
          <Circle
            radius={element.width / 2}
            fill={COLORS[element.kind]}
            stroke={selected ? '#25634d' : '#879b92'}
            strokeWidth={selected ? 3 : 1}
          />
        ) : (
          <Rect
            x={-element.width / 2}
            y={-element.height / 2}
            width={element.width}
            height={element.height}
            cornerRadius={element.kind === 'table' ? 8 : 2}
            fill={COLORS[element.kind]}
            stroke={selected ? '#25634d' : '#879b92'}
            strokeWidth={selected ? 3 : 1}
          />
        )}
        <Text
          x={-element.width / 2}
          y={-8}
          width={element.width}
          text={element.label}
          fontSize={14}
          align="center"
          fill="#172b22"
          listening={false}
        />
        {element.kind === 'table' && element.height >= 60 && (
          <Text
            x={-element.width / 2}
            y={12}
            width={element.width}
            text={String(element.capacity)}
            fontSize={11}
            align="center"
            fill="#4b6659"
            listening={false}
          />
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

export function FloorPlanEditor({ merchantId, locationId }) {
  const { t } = useLingui();
  const [remote, setRemote] = useState(null);
  const [history, dispatch] = useReducer(layoutHistory, { past: [], present: null, future: [] });
  const [saved, setSaved] = useState('');
  const [selectedArea, setSelectedArea] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const [snap, setSnap] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [viewportWidth, setViewportWidth] = useState(640);
  const [pendingCommand, setPendingCommand] = useState(null);
  const [initialName] = useState(() => t`Salón`);
  const recoveryKey = `umi:floor-plan:${merchantId}:${locationId}`;
  const alive = useRef(true);
  const canvas = useRef(null);

  const document = preview ? remote?.published : history.present;
  const area = document?.areas.find((item) => item.id === selectedArea) ?? document?.areas[0];
  const element = area?.elements.find((item) => item.id === selected);
  const serialized = JSON.stringify(history.present);
  const dirty = !!history.present && serialized !== saved;
  const valid = FloorPlanDocument.safeParse(history.present).success;
  const elementCount =
    history.present?.areas.reduce((count, item) => count + item.elements.length, 0) ?? 0;
  const disabled = preview || busy || !!pendingCommand || error === 'conflict';

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
      if (busy) return;
      const command = pendingCommand ?? {
        publish,
        payload: {
          locationId,
          expectedVersion: remote.version,
          idempotencyKey: crypto.randomUUID(),
          ...(publish ? {} : { document: history.present }),
        },
      };
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
        if (alive.current) setBusy(false);
      }
    },
    [busy, pendingCommand, locationId, remote, history.present, merchantId],
  );

  useEffect(() => {
    if (!dirty || !valid || busy || error || pendingCommand || preview) return;
    const timer = setTimeout(() => submit(false), 900);
    return () => clearTimeout(timer);
  }, [dirty, valid, serialized, busy, error, preview, pendingCommand, submit]);

  const editArea = (patch) => {
    if (disabled) return;
    dispatch({
      type: 'edit',
      document: {
        ...history.present,
        areas: history.present.areas.map((item) =>
          item.id === area.id ? { ...item, ...patch } : item,
        ),
      },
    });
  };
  const editElement = (next) => {
    editArea({ elements: area.elements.map((item) => (item.id === next.id ? next : item)) });
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
  const keyboard = (event) => {
    if (disabled || !element || /INPUT|SELECT|TEXTAREA/.test(event.target.tagName)) return;
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
            disabled={busy || !!pendingCommand || !remote.published}
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
              disabled ||
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
      <div className="fp-controls">
        <label>
          <Trans>Área</Trans>
          <select
            value={area?.id ?? ''}
            onChange={(event) => {
              setSelectedArea(event.target.value);
              setSelected(null);
            }}
          >
            {document?.areas.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn"
          disabled={disabled || history.present.areas.length >= 20}
          onClick={() => {
            const next = createLayout(`${t`Área`} ${history.present.areas.length + 1}`).areas[0];
            dispatch({
              type: 'edit',
              document: { ...history.present, areas: [...history.present.areas, next] },
            });
            setSelectedArea(next.id);
            setSelected(null);
          }}
        >
          <Trans>Agregar área</Trans>
        </button>
        <button
          className="btn"
          disabled={disabled || !history.past.length}
          onClick={() => dispatch({ type: 'undo' })}
        >
          <Trans>Deshacer</Trans>
        </button>
        <button
          className="btn"
          disabled={disabled || !history.future.length}
          onClick={() => dispatch({ type: 'redo' })}
        >
          <Trans>Rehacer</Trans>
        </button>
        <label className="fp-check">
          <input
            type="checkbox"
            checked={snap}
            onChange={(event) => setSnap(event.target.checked)}
          />
          <Trans>Ajustar a cuadrícula</Trans>
        </label>
        <label>
          <Trans>Zoom</Trans>
          <select value={zoom} onChange={(event) => setZoom(Number(event.target.value))}>
            {[0.5, 1, 1.5, 2].map((value) => (
              <option key={value} value={value}>
                {value * 100}%
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="fp-workspace">
        <aside className="card fp-palette">
          <h3>
            <Trans>Elementos</Trans>
          </h3>
          <fieldset
            disabled={disabled || !area || area.elements.length >= 500 || elementCount >= 1000}
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
          className="fp-canvas card"
          tabIndex={0}
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
              <Layer listening={false}>
                {Array.from(
                  { length: Math.floor(Math.max(200, Math.min(5000, area.width)) / 20) + 1 },
                  (_, index) => (
                    <Line
                      key={`x${index}`}
                      points={[index * 20, 0, index * 20, area.height]}
                      stroke="#e4eae6"
                      strokeWidth={1}
                    />
                  ),
                )}
                {Array.from(
                  { length: Math.floor(Math.max(200, Math.min(5000, area.height)) / 20) + 1 },
                  (_, index) => (
                    <Line
                      key={`y${index}`}
                      points={[0, index * 20, area.width, index * 20]}
                      stroke="#e4eae6"
                      strokeWidth={1}
                    />
                  ),
                )}
              </Layer>
              <Layer>
                {area.elements.map((item) => (
                  <PlanElement
                    key={item.id}
                    element={item}
                    selected={selected === item.id}
                    disabled={disabled}
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
          <fieldset disabled={disabled || !area}>
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
  const merchantId = context?.selectedMerchantId ?? context?.capabilities?.merchant?.id;
  const locationId = context?.selectedLocationId ?? context?.capabilities?.selectedLocation?.id;
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
