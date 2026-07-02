import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Citation } from '@docsense/shared';
import { unmask } from '../lib/pii.js';
import { askQuestion } from '../state/actions.js';
import { useDispatch, type LoadedDoc } from '../state/store.js';
import { CitationList, CitedText } from './Citations.jsx';

const SUGGESTIONS = [
  'What is the interest rate and is it fixed or floating?',
  'Can I prepay or foreclose this loan, and what does it cost?',
  'What is the true annual cost of this loan including all upfront fees?',
  'What happens if I miss an EMI?',
  'Can the lender change the interest rate on their own?',
  'What personal data am I agreeing to share?',
];

interface Props {
  doc: LoadedDoc;
  onCitation: (c: Citation) => void;
}

export function ChatPanel({ doc, onCitation }: Props) {
  const dispatch = useDispatch();
  const [text, setText] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const busy = doc.chat.some((m) => m.pending);
  const reveal = (s: string) => unmask(s, doc.piiMap);

  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [doc.chat.length, busy]);

  const submit = (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    setText('');
    void askQuestion(dispatch, doc, q);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(text);
  };

  return (
    <div className="chat">
      <div className="chat-messages" ref={list}>
        {doc.chat.length === 0 && (
          <div className="empty">
            Ask anything about this agreement. Answers only use the document and every claim links to the clause it came from.
          </div>
        )}
        {doc.chat.map((m) => (
          <div key={m.id} className={`msg ${m.role}${m.error ? ' error' : ''}`}>
            {m.pending ? (
              <span className="typing">Reading the document…</span>
            ) : m.error ? (
              m.error
            ) : m.role === 'user' ? (
              reveal(m.content)
            ) : (
              <>
                <CitedText text={reveal(m.content)} citations={m.citations ?? []} onSelect={onCitation} />
                <CitationList citations={m.citations ?? []} onSelect={onCitation} unmask={reveal} />
                {m.toolCalls && m.toolCalls.length > 0 && (
                  <details className="tools">
                    <summary>
                      {m.toolCalls.length} calculation{m.toolCalls.length > 1 ? 's' : ''} run by the server
                    </summary>
                    {m.toolCalls.map((t, i) => (
                      <pre key={i}>
                        {t.name}({JSON.stringify(t.args)})
                        {'\n→ '}
                        {JSON.stringify(t.result)}
                      </pre>
                    ))}
                  </details>
                )}
                <div className="meta">
                  {m.grounded === false && <span className="badge warn">no citation — treat with care</span>}
                  {m.cached && <span className="badge">cached</span>}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      {doc.chat.length === 0 && (
        <div className="suggestions">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" onClick={() => submit(s)} disabled={busy}>
              {s}
            </button>
          ))}
        </div>
      )}
      <form className="chat-form" onSubmit={onSubmit}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask about this document…"
          rows={1}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit(text);
            }
          }}
        />
        <button className="btn primary" type="submit" disabled={busy || !text.trim()}>
          Ask
        </button>
      </form>
    </div>
  );
}
