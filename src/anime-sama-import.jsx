import React, { useState } from 'react';
import { Check, Download, LoaderCircle, Search, X } from 'lucide-react';

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

export default function AnimeSamaImport({ onClose, onImport }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

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

  return (
    <div className="modal-backdrop">
      <form className="modal anime-import-modal" onSubmit={search}>
        <div className="modal-heading">
          <div><span className="eyebrow"><Download size={13} /> IMPORT ANIME-SAMA</span><h2>Importer un catalogue complet</h2></div>
          <button type="button" className="close-button" onClick={onClose} aria-label="Fermer"><X size={18} /></button>
        </div>
        <p className="import-description">L’import récupère la fiche, les saisons, les versions (VOSTFR, VF…), les épisodes et tous les lecteurs disponibles. Les liens restent référencés comme lecteurs externes.</p>
        <div className="import-search-row">
          <div className="import-search-input"><Search size={17} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ex. Solo Leveling ou URL Anime-Sama" /></div>
          <button className="primary-button" type="submit" disabled={busy}><Search size={15} /> RECHERCHER</button>
        </div>
        {status && <div className="import-status"><LoaderCircle size={16} className="spin" /> {status}</div>}
        {error && <div className="form-error">{error}</div>}
        {!!results.length && <div className="anime-import-results">{results.map((result) => <ImportRow key={result.url} result={result} selected={selected?.url === result.url} onSelect={() => setSelected(result)} />)}</div>}
        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>ANNULER</button>
          <button type="button" className="primary-button" disabled={!selected || busy} onClick={importSelected}>{busy ? <LoaderCircle size={16} className="spin" /> : <Download size={16} />} IMPORTER TOUT</button>
        </div>
      </form>
    </div>
  );
}