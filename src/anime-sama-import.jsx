import React, { useState } from 'react';
import { CalendarDays, Check, Download, LoaderCircle, Search, X } from 'lucide-react';

const BULK_CONCURRENCY = 12;

function sourceKey(value) {
  if (!value) return '';
  try {
    const parsed = new URL(value);
    return `${parsed.hostname}${parsed.pathname}`.replace(/\/+$/, '').toLowerCase();
  } catch {
    return String(value).replace(/\/+$/, '').toLowerCase();
  }
}

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

export default function AnimeSamaImport({ onClose, onImport, existingAnime = [] }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(null);

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
      const response = await fetch(isUrl ? `/api/anime-sama/import?url=${encodeURIComponent(value)}` : `/api/anime-sama/search?q=${encodeURIComponent(value)}`);
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
      const response = await fetch(`/api/anime-sama/import?url=${encodeURIComponent(selected.url)}`);
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

  const runBulkImport = async (kind) => {
    setBusy(true);
    setError('');
    setStatus('');
    setResults([]);
    setSelected(null);
    setProgress({ running: true, total: 0, completed: 0, imported: 0, skipped: 0, failed: 0, message: 'Lecture de la source Anime-Sama…' });
    try {
      const response = await fetch(`/api/anime-sama/${kind}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'La liste Anime-Sama est indisponible.');
      const entries = kind === 'planning' ? payload.entries || [] : payload.results || [];
      const known = new Set(existingAnime.flatMap((item) => [sourceKey(item.sourceUrl), `name:${item.name?.trim().toLocaleLowerCase('fr')}`]).filter(Boolean));
      const uniqueEntries = [];
      let skipped = 0;
      for (const entry of entries) {
        const key = sourceKey(entry.url);
        const nameKey = `name:${entry.title?.trim().toLocaleLowerCase('fr')}`;
        if (!key || known.has(key) || known.has(nameKey) || uniqueEntries.some((candidate) => sourceKey(candidate.url) === key)) {
          skipped += 1;
          continue;
        }
        uniqueEntries.push(entry);
      }
      setProgress({ running: true, total: entries.length, completed: skipped, imported: 0, skipped, failed: 0, message: `Import de ${uniqueEntries.length} anime…` });
      let cursor = 0;
      const worker = async () => {
        while (cursor < uniqueEntries.length) {
          const entry = uniqueEntries[cursor];
          cursor += 1;
          try {
            const importResponse = await fetch(`/api/anime-sama/import?url=${encodeURIComponent(entry.url)}`);
            const importPayload = await importResponse.json();
            if (!importResponse.ok) throw new Error(importPayload.error || 'Import impossible');
            const item = kind === 'planning'
              ? { ...importPayload.item, schedule: entry.date ? { date: entry.date, time: entry.time || '18:00', day: entry.day } : { day: entry.day, time: entry.time || '18:00' } }
              : importPayload.item;
            const wasImported = onImport(item, { skipExisting: true, silent: true });
            setProgress((current) => ({
              ...current,
              completed: current.completed + 1,
              imported: current.imported + (wasImported === false ? 0 : 1),
              skipped: current.skipped + (wasImported === false ? 1 : 0)
            }));
          } catch (importError) {
            setProgress((current) => ({ ...current, completed: current.completed + 1, failed: current.failed + 1 }));
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(BULK_CONCURRENCY, Math.max(uniqueEntries.length, 1)) }, worker));
      setProgress((current) => ({ ...current, running: false, message: 'Importation terminée.' }));
      setStatus(kind === 'planning' ? 'Les anime du planning ont été ajoutés au catalogue et au planning du site.' : 'Le catalogue Anime-Sama a été importé sans doublons.');
    } catch (bulkError) {
      setProgress(null);
      setError(bulkError.message || 'L’import automatique Anime-Sama a échoué.');
    } finally {
      setBusy(false);
    }
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
        <div className="bulk-import-note">L’import utilise plusieurs requêtes en parallèle avec une limite de sécurité. La vitesse réelle dépend du serveur Anime-Sama et du volume d’épisodes.</div>
        <div className="import-search-row">
          <div className="import-search-input"><Search size={17} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ex. Solo Leveling ou URL Anime-Sama" /></div>
          <button className="primary-button" type="submit" disabled={busy}><Search size={15} /> RECHERCHER</button>
        </div>
        {status && <div className="import-status"><Check size={16} /> {status}</div>}
        {error && <div className="form-error">{error}</div>}
        <ProgressPanel progress={progress} />
        {!!results.length && <div className="anime-import-results">{results.map((result) => <ImportRow key={result.url} result={result} selected={selected?.url === result.url} onSelect={() => setSelected(result)} />)}</div>}
        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>FERMER</button>
          <button type="button" className="primary-button" disabled={!selected || busy} onClick={importSelected}>{busy ? <LoaderCircle size={16} className="spin" /> : <Download size={16} />} IMPORTER LA FICHE</button>
        </div>
      </form>
    </div>
  );
}