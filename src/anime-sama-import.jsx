import React, { useState } from 'react';
import { CalendarDays, Check, Download, LoaderCircle, Search, X } from 'lucide-react';

function ImportRow({ result, selected, onSelect }) {
  return (
    <button type="button" className={`anime-import-result ${selected ? 'selected' : ''}`} onClick={onSelect}>
      <span className="anime-import-result-main">
        <strong>{result.title}</strong>
        {result.alternateTitles && <small>{result.alternateTitles}</small>}
      </span>
      {selected && <Check size={16} />}
    </button>
  );
}

function ProgressPanel({ progress }) {
  if (!progress) return null;
  const percent = progress.total ? Math.min(100, Math.round((progress.completed / progress.total) * 100)) : 0;
  return (
    <div className="anime-bulk-progress" aria-live="polite">
      <div className="bulk-progress-heading">
        <strong>{progress.running ? 'Importation en cours…' : progress.message}</strong>
        <span>{progress.completed}/{progress.total}</span>
      </div>
      <div className="bulk-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax={progress.total} aria-valuenow={progress.completed}>
        <span style={{ width: `${percent}%` }} />
      </div>
      <div className="bulk-progress-stats">
        <span>{progress.imported} ajouté{progress.imported > 1 ? 's' : ''}</span>
        <span>{progress.skipped} déjà présent{progress.skipped > 1 ? 's' : ''}</span>
        {progress.failed > 0 && <span className="bulk-failed">{progress.failed} échec{progress.failed > 1 ? 's' : ''}</span>}
      </div>
    </div>
  );
}

export default function AnimeSamaImport({ onClose, onImport, onRefresh, adminToken = '' }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(null);
  const [jobId, setJobId] = useState('');

  const search = async (event) => {
    event?.preventDefault();
    const value = query.trim();
    if (!value) {
      setError('Saisissez un titre ou une URL Anime-Sama.');
      return;
    }
    setBusy(true);
    setError('');
    setStatus('');
    setProgress(null);
    setSelected(null);
    try {
      const isUrl = /^https?:\/\/[^/]+\/catalogue\//i.test(value);
      const response = await fetch(isUrl ? `/api/anime-sama/import?url=${encodeURIComponent(value)}` : `/api/anime-sama/search?q=${encodeURIComponent(value)}`, isUrl ? { headers: { 'x-mozilanim-admin': adminToken } } : undefined);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'La recherche Anime-Sama a échoué.');
      if (isUrl) {
        onImport(payload.item);
        return;
      }
      setResults(payload.results || []);
      if (!payload.results?.length) setError('Aucun résultat trouvé. Vérifiez le titre ou collez directement l’URL Anime-Sama.');
    } catch (searchError) {
      setError(searchError.message || 'La recherche Anime-Sama a échoué.');
    } finally {
      setBusy(false);
    }
  };

  const importSelected = async () => {
    if (!selected) return;
    setBusy(true);
    setError('');
    setStatus('Récupération des saisons, versions, épisodes et lecteurs…');
    try {
      const response = await fetch(`/api/anime-sama/import?url=${encodeURIComponent(selected.url)}`, { headers: { 'x-mozilanim-admin': adminToken } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'L’import Anime-Sama a échoué.');
      onImport(payload.item);
    } catch (importError) {
      setError(importError.message || 'L’import Anime-Sama a échoué.');
      setStatus('');
    } finally {
      setBusy(false);
    }
  };

  const readJob = async (id) => {
    const response = await fetch(`/api/import-jobs/${id}`, { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Impossible de lire l’import.');
    return payload.job;
  };

  const watchJob = async (id) => {
    const job = await readJob(id);
    setProgress({
      running: !['completed', 'completed_with_errors', 'failed'].includes(job.status),
      total: job.total,
      completed: job.completed,
      imported: job.imported,
      skipped: job.skipped,
      failed: job.failed,
      message: job.status === 'completed_with_errors' ? 'Import terminé avec des erreurs.' : job.status === 'failed' ? 'Import arrêté.' : 'Importation en cours…',
      errors: job.errors || []
    });
    if (!['completed', 'completed_with_errors', 'failed'].includes(job.status)) {
      window.setTimeout(() => watchJob(id).catch((watchError) => setError(watchError.message)), 750);
    } else {
      await onRefresh?.();
      setStatus(job.status === 'completed' ? 'Import terminé. Le catalogue public est à jour.' : 'Import terminé : réimportez les erreurs définitives ci-dessous.');
      setBusy(false);
    }
    return job;
  };

  const runBulkImport = async (kind) => {
    setBusy(true);
    setError('');
    setStatus('');
    setResults([]);
    setSelected(null);
    setProgress({ running: true, total: 0, completed: 0, imported: 0, skipped: 0, failed: 0, message: 'Mise en file de l’import…', errors: [] });
    try {
      const response = await fetch('/api/import-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-mozilanim-admin': adminToken },
        body: JSON.stringify({ kind })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Impossible de mettre l’import en file.');
      setJobId(payload.job.id);
      await watchJob(payload.job.id);
    } catch (bulkError) {
      setError(bulkError.message || 'L’import automatique Anime-Sama a échoué.');
      setBusy(false);
    }
  };

  const retryFailed = async () => {
    if (!jobId) return;
    setBusy(true);
    setError('');
    const response = await fetch(`/api/import-jobs/${jobId}/retry-failed`, { method: 'POST', headers: { 'x-mozilanim-admin': adminToken } });
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error || 'Impossible de relancer les erreurs.');
      setBusy(false);
      return;
    }
    await watchJob(jobId);
  };

  return (
    <div className="modal-backdrop">
      <form className="modal anime-import-modal" onSubmit={search}>
        <div className="modal-heading">
          <div><span className="eyebrow"><Download size={13} /> IMPORT ANIME-SAMA</span><h2>Importer un catalogue complet</h2></div>
          <button type="button" className="close-button" onClick={onClose} aria-label="Fermer"><X size={18} /></button>
        </div>
        <p className="import-description">Importez une fiche, tous les anime du planning ou le catalogue Anime-Sama complet. Les doublons sont automatiquement ignorés.</p>
        <div className="bulk-import-actions">
          <button type="button" className="secondary-button" disabled={busy} onClick={() => runBulkImport('planning')}><CalendarDays size={16} /> IMPORTER LE PLANNING</button>
          <button type="button" className="secondary-button" disabled={busy} onClick={() => runBulkImport('catalogue')}><Download size={16} /> IMPORTER TOUT LE CATALOGUE</button>
        </div>
        <div className="bulk-import-note">L’import est traité par le serveur : vous pouvez fermer cette fenêtre ou quitter le site, il continuera avec jusqu’à 5 tentatives par anime. Les erreurs définitives restent réimportables.</div>
        <div className="import-search-row">
          <div className="import-search-input"><Search size={17} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ex. Solo Leveling ou URL Anime-Sama" /></div>
          <button className="primary-button" type="submit" disabled={busy}><Search size={15} /> RECHERCHER</button>
        </div>
        {status && <div className="import-status"><Check size={16} /> {status}</div>}
        {error && <div className="form-error">{error}</div>}
        <ProgressPanel progress={progress} />
        {progress?.errors?.length > 0 && <div className="import-error-list"><strong>Erreurs à réimporter</strong>{progress.errors.map((entry) => <div key={entry.id}><span>{entry.title}</span><small>{entry.error}</small></div>)}<button type="button" className="secondary-button" disabled={busy} onClick={retryFailed}><Download size={15} /> IMPORTER LES ERREURS</button></div>}
        {!!results.length && <div className="anime-import-results">{results.map((result) => <ImportRow key={result.url} result={result} selected={selected?.url === result.url} onSelect={() => setSelected(result)} />)}</div>}
        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>FERMER</button>
          <button type="button" className="primary-button" disabled={!selected || busy} onClick={importSelected}>{busy ? <LoaderCircle size={16} className="spin" /> : <Download size={16} />} IMPORTER LA FICHE</button>
        </div>
      </form>
    </div>
  );
}