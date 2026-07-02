import type { Dispatch } from 'react';
import type { UploadResponse } from '@docsense/shared';
import { ApiError, api } from '../api/client.js';
import type { Action, LoadedDoc } from './store.js';

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.friendly : err instanceof Error ? err.message : 'Something went wrong';
}

export function toLoadedDoc(res: UploadResponse, file: Blob, isSample: boolean): LoadedDoc {
  return {
    id: res.documentId,
    title: res.title,
    sourceType: res.sourceType,
    pageCount: res.pageCount,
    chunkCount: res.chunkCount,
    isSample,
    piiMap: res.piiMap,
    file,
    warnings: res.warnings,
    terms: null,
    cost: null,
    risks: null,
    analysis: 'idle',
    chat: [],
    highlight: null,
  };
}

// Extraction then risk review: two model calls, run once per document and cached server-side.
export async function runAnalysis(dispatch: Dispatch<Action>, id: string): Promise<void> {
  dispatch({ type: 'doc/analysis', id, status: 'extracting' });
  try {
    const { terms, cost } = await api.extract(id);
    dispatch({ type: 'doc/terms', id, terms, cost });
    dispatch({ type: 'doc/analysis', id, status: 'reviewing' });
    const { riskFlags } = await api.risks(id);
    dispatch({ type: 'doc/risks', id, risks: riskFlags });
    dispatch({ type: 'doc/analysis', id, status: 'done' });
  } catch (err) {
    dispatch({ type: 'doc/analysis', id, status: 'error', error: errorText(err) });
  }
}

export async function uploadFile(dispatch: Dispatch<Action>, file: File): Promise<void> {
  try {
    const res = await api.upload(file);
    dispatch({ type: 'doc/add', doc: toLoadedDoc(res, file, false) });
    if (res.warnings.length) dispatch({ type: 'toast', kind: 'info', text: res.warnings.join(' ') });
    void runAnalysis(dispatch, res.documentId);
  } catch (err) {
    dispatch({ type: 'toast', kind: 'error', text: errorText(err) });
  }
}

export async function loadSample(dispatch: Dispatch<Action>, slug: string): Promise<void> {
  try {
    const [res, pdf] = await Promise.all([api.loadSample(slug), fetch(`/samples/${slug}.pdf`).then((r) => r.blob())]);
    dispatch({ type: 'doc/add', doc: toLoadedDoc(res, pdf, true) });
    void hydrateAnalysis(dispatch, res.documentId);
  } catch (err) {
    dispatch({ type: 'toast', kind: 'error', text: errorText(err) });
  }
}

// Samples may already have been analysed by an earlier visitor; reuse the stored result when present.
async function hydrateAnalysis(dispatch: Dispatch<Action>, id: string): Promise<void> {
  try {
    const summary = await api.document(id);
    if (summary.extraction && summary.cost) dispatch({ type: 'doc/terms', id, terms: summary.extraction, cost: summary.cost });
    if (summary.riskFlags) dispatch({ type: 'doc/risks', id, risks: summary.riskFlags });
    if (summary.extraction && summary.riskFlags) {
      dispatch({ type: 'doc/analysis', id, status: 'done' });
      return;
    }
  } catch {
    // fall through to a fresh analysis
  }
  await runAnalysis(dispatch, id);
}

export async function askQuestion(dispatch: Dispatch<Action>, doc: LoadedDoc, question: string): Promise<void> {
  const userId = `u-${Date.now()}`;
  const assistantId = `a-${Date.now()}`;
  dispatch({ type: 'chat/append', id: doc.id, message: { id: userId, role: 'user', content: question } });
  dispatch({ type: 'chat/append', id: doc.id, message: { id: assistantId, role: 'assistant', content: '', pending: true } });
  const history = doc.chat.filter((m) => !m.pending && !m.error).slice(-10).map((m) => ({ role: m.role, content: m.content }));
  try {
    const res = await api.ask(doc.id, { question, history, piiMap: doc.piiMap });
    dispatch({
      type: 'chat/update',
      id: doc.id,
      messageId: assistantId,
      patch: { content: res.answer, citations: res.citations, toolCalls: res.toolCalls, grounded: res.grounded, cached: res.cached, pending: false },
    });
  } catch (err) {
    dispatch({ type: 'chat/update', id: doc.id, messageId: assistantId, patch: { pending: false, error: errorText(err) } });
  }
}
