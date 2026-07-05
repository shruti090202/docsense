import { useEffect, useRef, useState } from 'react';
import type { SampleInfo } from '@docsense/shared';
import { api } from './api/client.js';
import { CompareView } from './components/CompareView.jsx';
import { DocumentView } from './components/DocumentView.jsx';
import { Home } from './components/Home.jsx';
import { loadSample, uploadFile } from './state/actions.js';
import { useDispatch, useStore } from './state/store.js';

function SamplesMenu() {
  const dispatch = useDispatch();
  const [open, setOpen] = useState(false);
  const [samples, setSamples] = useState<SampleInfo[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    api.samples().then(setSamples).catch(() => setSamples([]));
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="menu" ref={ref}>
      <button className="btn" type="button" onClick={() => setOpen((o) => !o)}>
        Try a sample ▾
      </button>
      {open && (
        <div className="menu-list">
          {samples.map((s) => (
            <button
              key={s.slug}
              type="button"
              className="menu-item"
              onClick={() => {
                setOpen(false);
                void loadSample(dispatch, s.slug);
              }}
            >
              <span>{s.title}</span>
              <small>
                {s.kind} · {s.pageCount} pp
              </small>
            </button>
          ))}
          {samples.length === 0 && <div className="empty">Loading…</div>}
        </div>
      )}
    </div>
  );
}

function TopBar() {
  const { docs, order, view } = useStore();
  const dispatch = useDispatch();
  const input = useRef<HTMLInputElement>(null);

  return (
    <header className="topbar">
      <button type="button" className="brand" onClick={() => dispatch({ type: 'view', view: { kind: 'home' } })}>
        DocSense <small>loan &amp; contract intelligence</small>
      </button>
      <nav className="doc-tabs">
        {order.map((id) => {
          const d = docs[id]!;
          const active = view.kind === 'document' && view.id === id;
          return (
            <button key={id} type="button" className={`doc-tab${active ? ' active' : ''}`} onClick={() => dispatch({ type: 'view', view: { kind: 'document', id } })} title={d.title}>
              {d.title}
              <span
                className="close"
                role="button"
                aria-label="close"
                onClick={(e) => {
                  e.stopPropagation();
                  dispatch({ type: 'doc/remove', id });
                  if (!d.isSample) void api.remove(id).catch(() => undefined);
                }}
              >
                ×
              </span>
            </button>
          );
        })}
      </nav>
      <div className="topbar-actions">
        <input ref={input} type="file" accept=".pdf,.docx,application/pdf" hidden onChange={(e) => e.target.files?.[0] && void uploadFile(dispatch, e.target.files[0])} />
        <button className="btn" type="button" onClick={() => input.current?.click()}>
          Upload
        </button>
        <SamplesMenu />
        <button
          className={`btn${view.kind === 'compare' ? ' primary' : ''}`}
          type="button"
          disabled={order.filter((id) => docs[id]!.kind === 'loan').length < 2}
          title="Compare two loan agreements side by side"
          onClick={() => dispatch({ type: 'view', view: { kind: 'compare' } })}
        >
          Compare
        </button>
      </div>
    </header>
  );
}

function Toast() {
  const { toast } = useStore();
  const dispatch = useDispatch();
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => dispatch({ type: 'toast/clear' }), toast.kind === 'error' ? 9000 : 6000);
    return () => clearTimeout(t);
  }, [toast, dispatch]);
  if (!toast) return null;
  return (
    <div className={`toast ${toast.kind}`} role="status">
      <span>{toast.text}</span>
      <button type="button" onClick={() => dispatch({ type: 'toast/clear' })} aria-label="dismiss">
        ×
      </button>
    </div>
  );
}

export function App() {
  const { docs, view } = useStore();
  const activeDoc = view.kind === 'document' ? docs[view.id] : undefined;
  return (
    <div className="app">
      <TopBar />
      {view.kind === 'compare' ? <CompareView /> : activeDoc ? <DocumentView key={activeDoc.id} doc={activeDoc} /> : <Home />}
      <footer className="disclaimer">
        DocSense is an educational portfolio project, not financial or legal advice. Sample agreements are fictional. Uploaded text is
        masked before any AI call and deleted from the server after 24 hours; original files never leave your browser.
      </footer>
      <Toast />
    </div>
  );
}
