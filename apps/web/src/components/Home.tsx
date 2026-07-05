import { useEffect, useRef, useState, type DragEvent } from 'react';
import type { SampleInfo } from '@docsense/shared';
import { api } from '../api/client.js';
import { loadSample, uploadFile } from '../state/actions.js';
import { useDispatch } from '../state/store.js';

const KIND_LABEL: Record<SampleInfo['kind'], string> = { loan: 'Loan agreement', contract: 'Contract', general: 'Notes' };

export function Home() {
  const dispatch = useDispatch();
  const [samples, setSamples] = useState<SampleInfo[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.samples().then(setSamples).catch(() => setSamples([]));
  }, []);

  const handleFiles = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setBusy(file.name);
    await uploadFile(dispatch, file);
    setBusy(null);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void handleFiles(e.dataTransfer.files);
  };

  const pick = async (slug: string) => {
    setBusy(slug);
    await loadSample(dispatch, slug);
    setBusy(null);
  };

  return (
    <div className="home">
      <h1>Understand what you are about to sign.</h1>
      <p className="lede">
        Upload a loan agreement and DocSense extracts the key terms with page citations, computes what the loan really costs,
        and flags one-sided clauses. Upload any other contract for its key facts and risky clauses, or any document at all to
        ask questions and get answers that cite the exact lines.
      </p>
      <div
        className={`dropzone${over ? ' over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        onClick={() => input.current?.click()}
        role="button"
        tabIndex={0}
      >
        <input ref={input} type="file" accept=".pdf,.docx,application/pdf" hidden onChange={(e) => void handleFiles(e.target.files)} />
        <strong>{busy ? `Processing ${busy}…` : 'Drop a PDF or DOCX here, or click to choose'}</strong>
        <div className="hint">Up to 10 MB and 60 pages. Text-based PDFs only (scans are rejected). Your file stays in this browser.</div>
      </div>

      <h2 className="section">Or try a sample</h2>
      <div className="samples-grid">
        {samples.map((s) => (
          <button key={s.slug} type="button" className="sample-card" onClick={() => void pick(s.slug)} disabled={busy !== null}>
            <strong>{s.title}</strong>
            <small>
              {KIND_LABEL[s.kind]} · {s.pageCount} pages · fictional{s.loaded ? ' · already analysed' : ''}
            </small>
          </button>
        ))}
        {samples.length === 0 && <div className="empty">Samples unavailable — the server may be waking up.</div>}
      </div>

      <div className="how">
        <div>
          <b>Private by design</b>
          <p>Aadhaar, PAN, account, phone and e-mail values are replaced with placeholders before any AI call. Originals never leave your browser; text is deleted after 24 hours.</p>
        </div>
        <div>
          <b>Every answer is cited</b>
          <p>Answers come only from your document. Click a citation to jump to the exact clause and page. If it is not in the document, it says so.</p>
        </div>
        <div>
          <b>Knows what it is reading</b>
          <p>A loan gets terms, true cost and lender-risk review; a rental, employment or service contract gets key facts and contract-risk review; notes and reports get an outline. Detected from the text, no setup.</p>
        </div>
        <div>
          <b>Math done by code</b>
          <p>EMI, total interest and the effective annual rate (including upfront fees) are computed deterministically, not by the language model.</p>
        </div>
        <div>
          <b>Educational tool</b>
          <p>This is a portfolio project, not financial or legal advice. Sample documents are fictional; use your own judgement and a professional for real decisions.</p>
        </div>
      </div>
    </div>
  );
}
