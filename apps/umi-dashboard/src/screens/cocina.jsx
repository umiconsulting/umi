import { DomainWorkspace } from './operations-workspace.jsx';

// Cocina — the kitchen routing surface for the owner. It reads the authorized
// kitchen model and configures station routes. Live cook status stays on the KDS
// and the overview; this screen owns the setup, not the live board.
export default function CocinaScreen() {
  return (
    <div className="fade-up" style={{ display: 'grid', gap: 16 }}>
      <DomainWorkspace domain="kitchen" />
    </div>
  );
}
