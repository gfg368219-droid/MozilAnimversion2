import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowLeft, ArrowRight, ArrowUp, CalendarDays, Check, ChevronLeft, ChevronRight,
  Clock3, Film, Heart, Home as HomeIcon, Info, ListFilter, LogOut,
  Menu, MonitorPlay, Play, Plus, Search, Settings, ShieldCheck, Tv, UserCircle,
  X, Layers3, Trash2, Code2, Upload, Download, Users, Ban, Eye, BarChart3, TrendingUp
} from 'lucide-react';
import './styles.css';
import AnimeSamaImport from './anime-sama-import.jsx';
import siteIcon from '../attached_assets/Screenshot_20260905-184616_Chrome_1788698732133.jpg';

if (typeof document !== 'undefined') {
  const favicon = document.querySelector('#site-favicon');
  if (favicon) favicon.href = siteIcon;
}

const POSTER_POOL = [
  'https://images.unsplash.com/photo-1578632767115-351597cf2477?auto=format&fit=crop&w=720&q=80',
  'https://images.unsplash.com/photo-1541562232579-512a21360020?auto=format&fit=crop&w=720&q=80',
  'https://images.unsplash.com/photo-1534809027769-b00d750a6bac?auto=format&fit=crop&w=720&q=80',
  'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=720&q=80',
  'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?auto=format&fit=crop&w=720&q=80',
  'https://images.unsplash.com/photo-1594736797933-d0e501ba2fe7?auto=format&fit=crop&w=720&q=80'
];

const SEEDED_ANIME_IDS = new Set(['aishiteru-game', 'solo-leveling', 'one-piece', 'demon-slayer', 'blue-lock', 'jujutsu-kaisen']);
const DAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

const MAX_LOCAL_CACHE_BYTES = 750_000;

const readJson = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    if (raw && raw.length > MAX_LOCAL_CACHE_BYTES) {
      localStorage.removeItem(key);
      return fallback;
    }
    const parsed = JSON.parse(raw || 'null');
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

const writeJson = (key, value, maxBytes = MAX_LOCAL_CACHE_BYTES) => {
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length > maxBytes) {
      if (key === 'mozilanim-anime') localStorage.removeItem(key);
      return false;
    }
    localStorage.setItem(key, serialized);
    return true;
  } catch (error) {
    if (error?.name === 'QuotaExceededError' || error?.code === 22) {
      try { localStorage.removeItem(key); } catch {}
      return false;
    }
    return false;
  }
};

const readStoredAnime = () => {
  const saved = readJson('mozilanim-anime', []);
  return Array.isArray(saved) ? saved.filter((item) => !SEEDED_ANIME_IDS.has(item.id)) : [];
};

const slugify = (value) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const animeSourceKey = (value) => {
  if (!value) return '';
  try {
    const parsed = new URL(value);
    return `${parsed.hostname}${parsed.pathname}`.replace(/\/+$/, '').toLowerCase();
  } catch {
    return String(value).replace(/\/+$/, '').toLowerCase();
  }
};
const allEpisodes = (version) => version?.readers?.[0]?.episodes || [];
const episodeLabel = (version, index) => version?.episodeNames?.[index] || `Épisode ${index + 1}`;
const versionPresentation = (value = '') => {
  const name = String(value).toUpperCase();
  if (name.includes('VOSTFR')) return { flag: '🇯🇵', label: 'VO sous-titrée' };
  if (/\bVF\b/.test(name)) return { flag: '🇫🇷', label: 'Version française' };
  if (/\bVKR\b/.test(name)) return { flag: '🇰🇷', label: 'Coréen' };
  if (/\bVA\b/.test(name)) return { flag: '🇬🇧', label: 'Anglais' };
  if (/\bVO\b/.test(name)) return { flag: '🇯🇵', label: 'Japonais' };
  return { flag: '🌐', label: value || 'Version' };
};
const versionBadge = (item) => {
  const names = [...new Set(item?.seasons?.flatMap((season) => season.versions || [])
    .map((version) => String(version.name || '').toUpperCase()).filter(Boolean))];
  const flags = [...new Set(names.map((name) => versionPresentation(name).flag))];
  return flags.length ? flags.join(' / ') : '🇯🇵';
};
const isToday = (item, date = new Date()) => {
  const schedule = item.schedule;
  if (!schedule) return false;
  if (schedule.date) {
    const today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return schedule.date === today;
  }
  return schedule.day !== undefined && Number(schedule.day) === date.getDay();
};
const viewFromHash = (hash) => hash.replace(/^#\/?/, '') || 'home';
const viewFromLocation = () => {
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
  if (pathname === '/login') return 'login';
  if (pathname === '/register') return 'register';
  return viewFromHash(window.location.hash);
};
const dayFromDate = (date) => {
  if (!date) return null;
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getDay();
};

function parsePlayers(script) {
  const matches = [...script.matchAll(/var\s+([a-zA-Z0-9_]+)\s*=\s*\[([\s\S]*?)\]/g)];
  if (!matches.length) {
    const urls = [...script.matchAll(/https?:\/\/[^\s'"`,\]]+/g)].map((match) => match[0].replace(/['"`;,]+$/, ''));
    return urls.length ? [{ name: 'Lecteur 1', episodes: urls }] : [];
  }
  return matches.map((match, index) => ({
    name: `Lecteur ${index + 1}`,
    episodes: [...match[2].matchAll(/['"`](https?:\/\/[^'"`]+)['"`]/g)].map((item) => item[1])
  })).filter((reader) => reader.episodes.length);
}

const VIDEO_DB_NAME = 'mozilanim-video-storage';
const VIDEO_STORE_NAME = 'videos';

function openVideoDb() {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(VIDEO_DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(VIDEO_STORE_NAME, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Impossible d’ouvrir le stockage vidéo.'));
  });
}

async function saveVideoFile(file) {
  if (!file) throw new Error('Sélectionnez un fichier vidéo.');
  const id = `video-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const db = await openVideoDb();
  await new Promise((resolve, reject) => {
    const request = db.transaction(VIDEO_STORE_NAME, 'readwrite').objectStore(VIDEO_STORE_NAME).put({ id, blob: file, name: file.name, type: file.type, uploadedBytes: 0, uploadStatus: 'waiting' });
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error || new Error('Impossible d’enregistrer la vidéo.'));
  });
  db.close();
  queueVideoUpload(id);
  return { type: 'upload', videoId: id, fileName: file.name, mimeType: file.type };
}

async function loadVideoFile(videoId) {
  if (!videoId) return null;
  const db = await openVideoDb();
  const video = await new Promise((resolve, reject) => {
    const request = db.transaction(VIDEO_STORE_NAME, 'readonly').objectStore(VIDEO_STORE_NAME).get(videoId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return video?.blob ? URL.createObjectURL(video.blob) : null;
}

const uploadedEpisode = (episode) => episode && typeof episode === 'object' && episode.type === 'upload' && episode.videoId;

function queueVideoUpload(id) {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready.then((registration) => {
    registration.active?.postMessage({ type: 'UPLOAD_VIDEO', id });
    registration.sync?.register('mozilanim-video-uploads').catch(() => {});
  }).catch(() => {});
}

function App() {
  const [anime, setAnime] = useState(readStoredAnime);
  const [users, setUsers] = useState(() => readJson('mozilanim-users', []));
  const [applications, setApplications] = useState(() => readJson('mozilanim-studio-applications', []));
  const [progress, setProgress] = useState(() => readJson('mozilanim-progress', {}));
  const [stats, setStats] = useState(() => readJson('mozilanim-stats', {}));
  const [view, setView] = useState(viewFromLocation);
  const [selectedAnime, setSelectedAnime] = useState(null);
  const [selectedSeason, setSelectedSeason] = useState(null);
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [selectedReader, setSelectedReader] = useState(0);
  const [episodeIndex, setEpisodeIndex] = useState(0);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [adminToken, setAdminToken] = useState(() => sessionStorage.getItem('mozilanim-admin-token') || '');
  const [isAdmin, setIsAdmin] = useState(() => sessionStorage.getItem('mozilanim-admin') === 'true' && Boolean(sessionStorage.getItem('mozilanim-admin-token')));
  const [currentUser, setCurrentUser] = useState(() => {
    const id = sessionStorage.getItem('mozilanim-user');
    return id ? readJson('mozilanim-users', []).find((user) => user.id === id) || null : null;
  });
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginMode, setLoginMode] = useState('login');
  const [mobileMenu, setMobileMenu] = useState(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;
    let cancelled = false;
    navigator.serviceWorker.register('/upload-worker.js').then((registration) => {
      if (!cancelled) registration.sync?.register('mozilanim-video-uploads').catch(() => {});
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (catalogLoaded) {
      try { localStorage.removeItem('mozilanim-anime'); } catch {}
      return;
    }
    writeJson('mozilanim-anime', anime, 300_000);
  }, [anime, catalogLoaded]);
  useEffect(() => { writeJson('mozilanim-users', users, 200_000); }, [users]);
  useEffect(() => { writeJson('mozilanim-studio-applications', applications, 300_000); }, [applications]);
  useEffect(() => { writeJson('mozilanim-progress', progress, 300_000); }, [progress]);
  useEffect(() => { writeJson('mozilanim-stats', stats, 300_000); }, [stats]);

  const refreshCatalog = async () => {
    try {
      const response = await fetch('/api/catalog', { cache: 'no-store' });
      if (!response.ok) throw new Error('Catalogue indisponible');
      const payload = await response.json();
      if (Array.isArray(payload.anime)) setAnime(payload.anime);
      setCatalogLoaded(true);
    } catch {
      // Le cache local permet de continuer à consulter le site si l'API est momentanément indisponible.
    }
  };

  useEffect(() => {
    refreshCatalog();
    const timer = window.setInterval(refreshCatalog, 15_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!catalogLoaded || !adminToken) return;
    fetch('/api/catalog', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-mozilanim-admin': adminToken },
      body: JSON.stringify({ anime })
    }).catch(() => {});
  }, [anime, catalogLoaded, adminToken]);

  useEffect(() => {
    const onLocationChange = () => setView(viewFromLocation());
    const onHash = onLocationChange;
    window.addEventListener('hashchange', onHash);
    window.addEventListener('popstate', onLocationChange);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('popstate', onLocationChange);
    };
  }, []);

  const go = (nextView) => {
    if (nextView === 'login' || nextView === 'register') {
      window.history.pushState({}, '', `/${nextView}`);
    } else if (window.location.pathname === '/login' || window.location.pathname === '/register') {
      window.history.pushState({}, '', `/#${nextView}`);
    } else {
      window.location.hash = nextView;
    }
    setView(nextView);
    setMobileMenu(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const openAnime = (item) => { setSelectedAnime(item); go('detail'); };
  const openWatch = (item, season, version, episode = 0) => {
    setStats((current) => ({
      ...current,
      [item.id]: { ...(current[item.id] || {}), views: (current[item.id]?.views || 0) + 1, lastViewedAt: Date.now() }
    }));
    setSelectedAnime(item); setSelectedSeason(season); setSelectedVersion(version);
    setSelectedReader(0); setEpisodeIndex(episode); go('watch');
  };
  const toggleLike = (item) => {
    const viewerId = currentUser?.id || 'guest';
    setStats((current) => {
      const previous = current[item.id] || {};
      const likedBy = previous.likedBy || [];
      const liked = likedBy.includes(viewerId);
      return {
        ...current,
        [item.id]: {
          ...previous,
          likes: Math.max((previous.likes || 0) + (liked ? -1 : 1), 0),
          likedBy: liked ? likedBy.filter((id) => id !== viewerId) : [...likedBy, viewerId]
        }
      };
    });
  };
  const resumeAnime = (item) => {
    const saved = progress[`${currentUser?.id || 'guest'}:${item.id}`];
    const season = item.seasons.find((candidate) => candidate.id === saved?.seasonId) || item.seasons[0];
    const version = season?.versions.find((candidate) => candidate.name === saved?.versionName) || season?.versions[0];
    if (season && version) openWatch(item, season, version, saved?.episodeIndex || 0);
  };
  const saveProgress = (item, season, version, index) => {
    setProgress((current) => ({
      ...current,
      [`${currentUser?.id || 'guest'}:${item.id}`]: {
        animeId: item.id, seasonId: season.id, versionName: version.name,
        episodeIndex: index, updatedAt: Date.now()
      }
    }));
  };
  const logout = () => {
    setIsAdmin(false);
    setAdminToken('');
    setCurrentUser(null);
    sessionStorage.removeItem('mozilanim-admin');
    sessionStorage.removeItem('mozilanim-admin-token');
    sessionStorage.removeItem('mozilanim-user');
    go('home');
  };
  const onLogin = (account) => {
    setCurrentUser(account);
    sessionStorage.setItem('mozilanim-user', account.id);
    setLoginOpen(false);
    go(account.role === 'studio-maker' ? 'studio' : 'home');
  };

  return (
    <div className="app-shell">
      <Header view={view} go={go} isAdmin={isAdmin} currentUser={currentUser} onLogin={() => { setLoginMode('login'); setLoginOpen(true); }} logout={logout} mobileMenu={mobileMenu} setMobileMenu={setMobileMenu} />
      <main>
        {view === 'home' && <Home anime={anime} progress={progress} currentUser={currentUser} openAnime={openAnime} openWatch={openWatch} resumeAnime={resumeAnime} setProgress={setProgress} go={go} />}
        {view === 'login' && <AccountPage mode="login" users={users} onUserSuccess={onLogin} onAdminSuccess={(token) => { setAdminToken(token); setIsAdmin(true); sessionStorage.setItem('mozilanim-admin', 'true'); sessionStorage.setItem('mozilanim-admin-token', token); go('admin'); }} onRegister={() => go('register')} onBack={() => go('home')} />}
        {view === 'register' && <AccountPage mode="register" users={users} setUsers={setUsers} onUserSuccess={onLogin} onLogin={() => go('login')} onBack={() => go('home')} />}
        {view === 'catalog' && <Catalog anime={anime} openAnime={openAnime} />}
        {view === 'detail' && selectedAnime && <Detail item={selectedAnime} openWatch={openWatch} go={go} stats={stats} currentUser={currentUser} toggleLike={toggleLike} />}
        {view === 'watch' && selectedAnime && selectedSeason && selectedVersion && <Watch item={selectedAnime} season={selectedSeason} version={selectedVersion} readerIndex={selectedReader} setReaderIndex={setSelectedReader} episodeIndex={episodeIndex} setEpisodeIndex={setEpisodeIndex} onProgress={saveProgress} currentUser={currentUser} go={go} />}
        {view === 'planning' && <Planning anime={anime} openAnime={openAnime} />}
        {view === 'studio' && <Studio users={users} currentUser={currentUser} applications={applications} anime={anime} setAnime={setAnime} setApplications={setApplications} stats={stats} go={go} onLogin={() => { setLoginMode('login'); setLoginOpen(true); }} />}
        {view === 'admin' && isAdmin && <Admin anime={anime} setAnime={setAnime} adminToken={adminToken} refreshCatalog={refreshCatalog} openAnime={openAnime} users={users} setUsers={setUsers} applications={applications} setApplications={setApplications} />}
        {view === 'admin' && !isAdmin && <AccessDenied onLogin={() => { setLoginMode('login'); setLoginOpen(true); }} />}
      </main>
      <Footer go={go} />
      {view !== 'login' && view !== 'register' && <LoginModal open={loginOpen} mode={loginMode} setMode={setLoginMode} onRegisterPage={() => { setLoginOpen(false); go('register'); }} onClose={() => setLoginOpen(false)} onUserSuccess={onLogin} onAdminSuccess={(token) => { setAdminToken(token); setIsAdmin(true); sessionStorage.setItem('mozilanim-admin', 'true'); sessionStorage.setItem('mozilanim-admin-token', token); setLoginOpen(false); go('admin'); }} users={users} setUsers={setUsers} />}
    </div>
  );
}

function Header({ view, go, isAdmin, currentUser, onLogin, logout, mobileMenu, setMobileMenu }) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <button className="brand" onClick={() => go('home')} aria-label="Retour à l'accueil"><span className="brand-mark"><img src={siteIcon} alt="" /></span><span>MOZILANIM</span></button>
        <div className="header-divider" />
        <nav className={`main-nav ${mobileMenu ? 'open' : ''}`}>
          <button className={view === 'catalog' ? 'active' : ''} onClick={() => go('catalog')}><Film size={16} /> Catalogue</button>
          <button className={view === 'studio' ? 'active studio-nav-link' : 'studio-nav-link'} onClick={() => go('studio')}><Code2 size={16} /> Mozilanim studio</button>
          <button className={view === 'planning' ? 'active' : ''} onClick={() => go('planning')}><CalendarDays size={16} /> Planning</button>
          {isAdmin && <button className={view === 'admin' ? 'active admin-link' : 'admin-link'} onClick={() => go('admin')}><ShieldCheck size={16} /> Administration</button>}
          <button onClick={currentUser || isAdmin ? logout : onLogin}><UserCircle size={17} /> {isAdmin ? 'Déconnexion' : currentUser ? currentUser.name : 'Connexion'}</button>
        </nav>
        <div className="header-search"><Search size={17} /><input placeholder="Rechercher..." onKeyDown={(event) => event.key === 'Enter' && go('catalog')} /></div>
        <button className="mobile-toggle" onClick={() => setMobileMenu(!mobileMenu)} aria-label="Menu"><Menu size={23} /></button>
      </div>
    </header>
  );
}

function Home({ anime, progress, currentUser, openAnime, openWatch, resumeAnime, setProgress, go }) {
  const [featuredPool, setFeaturedPool] = useState([]);
  const [featuredIndex, setFeaturedIndex] = useState(0);
  const [today, setToday] = useState(new Date());
  useEffect(() => {
    const shuffled = [...anime].sort(() => Math.random() - 0.5).slice(0, 5);
    setFeaturedPool(shuffled);
    setFeaturedIndex(0);
  }, [anime]);
  useEffect(() => {
    if (featuredPool.length < 2) return undefined;
    const timer = window.setInterval(() => setFeaturedIndex((current) => (current + 1) % featuredPool.length), 7000);
    return () => window.clearInterval(timer);
  }, [featuredPool.length]);
  useEffect(() => {
    const timer = window.setInterval(() => setToday(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const progressItems = anime.map((item) => {
    const saved = progress[`${currentUser?.id || 'guest'}:${item.id}`];
    return saved ? { item, saved } : null;
  }).filter((entry) => entry && entry.item.seasons.length);
  const featured = featuredPool[featuredIndex] || anime[0];
  return (
    <div className="page home-page">
      {!featured ? <div className="empty-home"><section className="empty-home-card"><div className="empty-home-icon"><Film size={30} /></div><span className="eyebrow">MOZILANIM / CATALOGUE VIDE</span><h1>Votre catalogue commence ici</h1><p>Aucun anime de démonstration n’est installé. Connectez-vous à l’administration pour publier un projet.</p><div className="empty-home-actions"><button className="primary-button" onClick={() => go('admin')}><ShieldCheck size={16} /> OUVRIR L’ADMINISTRATION</button></div></section></div> : <>
        <section className="hero-wrap"><div className="hero" style={{ backgroundImage: `url(${featured.backdrop || featured.poster})` }}><div className="hero-shade" /><div className="hero-content"><span className="status-pill">ANIME</span><h1>{featured.name.toUpperCase()}</h1><div className="tag-row">{(featured.genres || []).map((genre) => <span key={genre}>{genre}</span>)}</div>{featured.isStudio && <p>{featured.description}</p>}<div className="hero-actions"><button className="primary-button" onClick={() => featured.seasons[0] && openWatch(featured, featured.seasons[0], featured.seasons[0].versions[0])}><Play size={14} fill="currentColor" /> VISIONNER</button></div></div><div className="hero-dots">{featuredPool.map((item, index) => <button key={item.id} className={index === featuredIndex ? 'selected' : ''} onClick={() => setFeaturedIndex(index)} aria-label={`Afficher ${item.name}`} />)}</div></div></section>
        {progressItems.length > 0 && <section className="resume-section">
          <div className="resume-heading"><h2><Clock3 size={20} /> REPRENEZ VOTRE VISIONNAGE</h2><div className="resume-line" /></div>
          <div className="resume-grid">{progressItems.map(({ item, saved }) => {
            const season = item.seasons.find((candidate) => candidate.id === saved.seasonId) || item.seasons[0];
            const version = season?.versions.find((candidate) => candidate.name === saved.versionName) || season?.versions[0];
            const episodeCount = allEpisodes(version).length;
            if (!season || !version || !episodeCount) return null;
            return <div className="resume-card" key={item.id}>
              <button className="resume-poster" style={{ backgroundImage: `url(${item.poster})` }} onClick={() => resumeAnime(item)} aria-label={`Reprendre ${item.name}`}><span className="resume-type">Anime</span><span className="resume-flag">{versionBadge(item)}</span><span className="resume-play"><Play size={22} fill="currentColor" /></span></button>
              <div className="resume-copy"><h3>{item.name}</h3><div className="resume-progress"><span style={{ width: `${Math.min(((saved.episodeIndex + 1) / episodeCount) * 100, 100)}%` }} /></div><button onClick={() => resumeAnime(item)}><MonitorPlay size={16} /> {season.name} {episodeLabel(version, saved.episodeIndex)}</button></div>
              <button className="resume-remove" onClick={() => setProgress((current) => { const next = { ...current }; delete next[`${currentUser?.id || 'guest'}:${item.id}`]; return next; })} aria-label="Retirer de la reprise"><X size={20} /></button>
            </div>;
          })}</div>
        </section>}
        <ContentRail title="SORTIES DU JOUR" icon={<CalendarDays size={20} />} anime={anime.filter((item) => isToday(item, today))} openAnime={openAnime} emptyMessage="Aucune sortie aujourd’hui." /><ContentRail title="DERNIERS ÉPISODES AJOUTÉS" icon={<Layers3 size={20} />} anime={[...anime].filter((item) => item.seasons?.some((season) => season.versions?.some((version) => allEpisodes(version).length))).sort((a, b) => Number(b.lastEpisodeAt || b.updatedAt || 0) - Number(a.lastEpisodeAt || a.updatedAt || 0)).slice(0, 12)} openAnime={openAnime} compact emptyMessage="Aucun épisode récent." />
      </>}
    </div>
  );
}

function ContentRail({ title, icon, anime, openAnime, compact = false, emptyMessage }) {
  return <section className="content-section"><div className="section-heading"><h2>{icon}{title}</h2><div className="section-arrows"><button aria-label="Précédent"><ArrowLeft size={18} /></button><button aria-label="Suivant"><ArrowRight size={18} /></button></div></div>{anime.length ? <div className={`anime-rail ${compact ? 'compact' : ''}`}>{anime.map((item, index) => <AnimeCard key={item.id} item={item} index={index} openAnime={openAnime} compact={compact} />)}</div> : <div className="rail-empty">{emptyMessage}</div>}</section>;
}

function AnimeCard({ item, index, openAnime, compact }) {
  const badge = versionBadge(item);
  return <button className={`anime-card ${compact ? 'card-compact' : ''}`} onClick={() => openAnime(item)}><div className="card-image" style={{ backgroundImage: `url(${item.poster})` }}><span className="card-type">{item.isStudio ? 'Studio' : 'Anime'}</span><span className="card-flag">{badge}</span><span className="card-overlay"><Play size={21} fill="currentColor" /></span></div><div className="card-body"><h3>{item.name}</h3><div className="card-meta"><span><Clock3 size={13} /> Publication</span><span><Tv size={13} /> {item.seasons.length} saison{item.seasons.length > 1 ? 's' : ''}</span></div></div></button>;
}

function Catalog({ anime, openAnime }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('Tous');
  const genres = ['Tous', 'Action', 'Aventure', 'Romance', 'Comédie', 'Fantastique', 'Sport'];
  const shown = useMemo(() => anime.filter((item) => item.name.toLowerCase().includes(query.toLowerCase()) && (filter === 'Tous' || (item.genres || []).includes(filter))), [anime, query, filter]);
  return <div className="page catalog-page"><div className="catalog-heading"><div><span className="eyebrow">MOZILANIM / CATALOGUE</span><h1>Le catalogue</h1><p>Retrouvez tous les anime ajoutés sur MOZILANIM.</p></div><div className="catalog-search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher un anime" /></div></div><div className="filter-row"><ListFilter size={16} /><span>Filtrer par genre</span>{genres.map((genre) => <button key={genre} className={filter === genre ? 'selected' : ''} onClick={() => setFilter(genre)}>{genre}</button>)}</div><div className="catalog-grid">{shown.map((item, index) => <AnimeCard key={item.id} item={item} index={index} openAnime={openAnime} />)}</div>{!shown.length && <div className="empty-state"><Search size={28} /><h3>Aucun anime trouvé</h3><p>Essayez un autre titre ou retirez le filtre sélectionné.</p></div>}</div>;
}

function Planning({ anime, openAnime }) {
  const [now, setNow] = useState(new Date());
  const [filter, setFilter] = useState('Tous');
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const days = [1, 2, 3, 4, 5, 6, 0];
  const entries = anime.map((item) => ({
    item,
    day: item.schedule?.day ?? dayFromDate(item.schedule?.date),
    time: item.schedule?.time || '18:00',
    season: item.seasons.find((season) => season.id === item.schedule?.seasonId) || item.seasons.at(-1)
  })).filter((entry) => (entry.item.schedule?.date || entry.item.schedule?.day !== undefined) && entry.day !== null && entry.season && (filter === 'Tous' || filter === 'Anime'));
  const monday = new Date(now);
  const currentDay = monday.getDay() || 7;
  monday.setDate(monday.getDate() - currentDay + 1);
  const dateLabel = (day) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + (day === 0 ? 6 : day - 1));
    return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  };
  return <div className="page planning-page">
    <div className="planning-intro"><span className="eyebrow"><CalendarDays size={14} /> MOZILANIM / PLANNING</span><h1>Planning des sorties</h1><p>Retrouvez les sorties organisées par jour, avec une vue claire de la semaine.</p></div>
    <div className="planning-notice"><CalendarDays size={18} /><span>Les sorties sont regroupées par journée et le planning se met à jour automatiquement.</span></div>
    <div className="planning-clock"><Clock3 size={22} /><strong>{now.toLocaleTimeString('fr-FR')}</strong><span>heure locale</span></div>
    <div className="planning-toolbar"><strong>FILTRER :</strong><button className={filter === 'Tous' ? 'selected' : ''} onClick={() => setFilter('Tous')}>TOUS</button><button className={filter === 'Anime' ? 'selected' : ''} onClick={() => setFilter('Anime')}><Tv size={14} /> ANIMES</button></div>
    <div className="planning-week">{days.map((day) => <section className={`planning-day ${day === (now.getDay()) ? 'today' : ''}`} key={day}><header><h2>{DAYS[day].toUpperCase()}</h2><span>{dateLabel(day)}</span></header><div className="planning-day-list">{entries.filter((entry) => entry.day === day).map((entry) => <button className="planning-card" key={entry.item.id} onClick={() => openAnime(entry.item)}><div className="planning-poster" style={{ backgroundImage: `url(${entry.item.poster})` }} /><div className="planning-card-copy"><strong>{entry.item.name}</strong><span><Clock3 size={12} /> {entry.time}</span><small>{entry.season.name}</small></div></button>)}{!entries.some((entry) => entry.day === day) && <div className="planning-empty">Aucune sortie</div>}</div></section>)}</div>
  </div>;
}

function Detail({ item, openWatch, go, stats, currentUser, toggleLike }) {
  const itemStats = stats[item.id] || {};
  const liked = (itemStats.likedBy || []).includes(currentUser?.id || 'guest');
  return <div className="page detail-page">
    <div className="breadcrumbs"><button onClick={() => go('home')}><HomeIcon size={14} /> Accueil</button><ChevronRight size={14} /><button onClick={() => go('catalog')}>Catalogue</button><ChevronRight size={14} /><span>{item.name}</span></div>
    <section className="detail-hero" style={{ backgroundImage: `url(${item.backdrop || item.poster})` }}>
      <div className="detail-shade" /><div className="detail-poster" style={{ backgroundImage: `url(${item.poster})` }} />
      <div className="detail-copy"><span className="status-pill">ANIME</span><h1>{item.name}</h1><div className="tag-row">{(item.genres || []).map((genre) => <span key={genre}>{genre}</span>)}</div>{item.isStudio && <p>{item.description}</p>}<div className="detail-data">{item.isStudio && <span><strong>Studio</strong>{item.studio}</span>}<span><strong>Vues</strong>{itemStats.views || 0}</span><span><strong>J'aime</strong>{itemStats.likes || 0}</span><span><strong>Saisons</strong>{item.seasons.length}</span></div><div className="detail-actions">{item.seasons[0] && <button className="primary-button" onClick={() => openWatch(item, item.seasons[0], item.seasons[0].versions[0])}><Play size={15} fill="currentColor" /> COMMENCER</button>}<button className={`icon-button ${liked ? 'is-favorite' : ''}`} onClick={() => toggleLike(item)} aria-label="J'aime"><Heart size={18} fill={liked ? 'currentColor' : 'none'} /><span className="like-count">{itemStats.likes || 0}</span></button></div></div>
    </section>
    <section className="seasons-section"><div className="section-heading"><h2><Layers3 size={20} /> SAISONS ET VERSIONS</h2><span className="muted">{item.seasons.length} saison{item.seasons.length > 1 ? 's' : ''}</span></div><div className="season-list">{item.seasons.map((season) => <div className="season-panel" key={season.id}><div className="season-title"><span>{season.name}</span><span className="episode-total">{Math.max(...season.versions.map((version) => allEpisodes(version).length), 0)} épisodes</span></div><div className="version-row">{season.versions.map((version) => { const presentation = versionPresentation(version.name); return <button key={version.name} className="version-button" onClick={() => openWatch(item, season, version)}><Play size={13} fill="currentColor" /> {presentation.flag} {presentation.label}<ChevronRight size={14} /></button>; })}</div></div>)}</div></section>
  </div>;
}

function Watch({ item, season, version, readerIndex, setReaderIndex, episodeIndex, setEpisodeIndex, onProgress, go }) {
  const readers = version.readers || [];
  const episodes = readers[readerIndex]?.episodes || [];
  const safeEpisodeIndex = episodes.length ? Math.min(Math.max(episodeIndex, 0), episodes.length - 1) : 0;
  const currentEpisode = episodes[safeEpisodeIndex];
  const currentUrl = typeof currentEpisode === 'string' ? currentEpisode : '';
  const isIframe = Boolean(currentUrl);
  const [videoSrc, setVideoSrc] = useState(null);
  const selectEpisode = (index) => { if (episodes.length) setEpisodeIndex(Math.min(Math.max(index, 0), episodes.length - 1)); };
  useEffect(() => {
    if (episodeIndex !== safeEpisodeIndex) setEpisodeIndex(safeEpisodeIndex);
    if (episodes.length) onProgress(item, season, version, safeEpisodeIndex);
  }, [episodeIndex, safeEpisodeIndex, item, season, version, episodes.length]);
  useEffect(() => {
    let active = true;
    let objectUrl = null;
    setVideoSrc(null);
    if (uploadedEpisode(currentEpisode)) {
      loadVideoFile(currentEpisode.videoId).then((url) => {
        if (active) {
          objectUrl = url;
          setVideoSrc(url);
        } else if (url) URL.revokeObjectURL(url);
      }).catch(() => { if (active) setVideoSrc(null); });
    } else if (typeof currentEpisode === 'string' && currentEpisode.startsWith('blob:')) {
      setVideoSrc(currentEpisode);
    }
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [currentEpisode]);
  const hasVideo = Boolean(videoSrc);
  return <div className="page watch-page"><div className="breadcrumbs"><button onClick={() => go('home')}><HomeIcon size={14} /> Accueil</button><ChevronRight size={14} /><button onClick={() => go('detail')}>{item.name}</button><ChevronRight size={14} /><span>{season.name} / {version.name}</span></div><div className="watch-layout"><section className="player-column"><div className="player-header"><div><span className="eyebrow">LECTURE EN COURS</span><h1>{item.name}</h1></div><div className="episode-nav"><button disabled={safeEpisodeIndex === 0 || !episodes.length} onClick={() => selectEpisode(safeEpisodeIndex - 1)}><ChevronLeft size={18} /></button><span>{episodes.length ? episodeLabel(version, safeEpisodeIndex) : 'Aucun épisode'}</span><button disabled={!episodes.length || safeEpisodeIndex >= episodes.length - 1} onClick={() => selectEpisode(safeEpisodeIndex + 1)}><ChevronRight size={18} /></button></div></div><div className="video-frame">{hasVideo ? <video key={`${readerIndex}-${currentEpisode?.videoId || currentEpisode}`} src={videoSrc} title={`${item.name} épisode ${safeEpisodeIndex + 1}`} controls playsInline /> : currentUrl ? (isIframe ? <iframe src={currentUrl} title={`${item.name} épisode ${safeEpisodeIndex + 1}`} allowFullScreen /> : <div className="external-player"><Film size={38} /><strong>Lecteur externe</strong><span>Ce lecteur s’ouvre dans un nouvel onglet.</span><a href={currentUrl} target="_blank" rel="noreferrer">OUVRIR LE LECTEUR <ArrowRight size={15} /></a></div>) : uploadedEpisode(currentEpisode) ? <div className="external-player"><Info size={38} /><strong>Vidéo en cours de chargement</strong><span>Le lecteur direct prépare votre épisode.</span></div> : <div className="external-player"><Info size={38} /><strong>Aucune vidéo disponible</strong><span>Importez une vidéo depuis l’administration.</span></div>}</div><div className="player-tools"><div className="reader-select"><span>VERSION</span>{readers.map((reader, index) => <button key={reader.name} className={readerIndex === index ? 'selected' : ''} onClick={() => { setReaderIndex(index); setEpisodeIndex(0); }}>{reader.name}</button>)}</div><div className="watch-info"><span>{season.name}</span><span>{version.name}</span><span>{episodes.length} épisodes</span></div></div></section><aside className="episode-sidebar"><div className="sidebar-heading"><h2>Épisodes</h2><span>{episodes.length}</span></div><div className="episode-list">{episodes.map((_, index) => <button key={`${readerIndex}-${index}`} className={safeEpisodeIndex === index ? 'current' : ''} onClick={() => selectEpisode(index)}><span>{String(index + 1).padStart(2, '0')}</span><span>{episodeLabel(version, index)}</span>{safeEpisodeIndex === index && <Play size={13} fill="currentColor" />}</button>)}</div></aside></div></div>;
}

function Admin({ anime, setAnime, adminToken, refreshCatalog, openAnime, users, setUsers, applications, setApplications }) {
  const [showAnimeForm, setShowAnimeForm] = useState(false);
  const [showAnimeImport, setShowAnimeImport] = useState(false);
  const [seasonEditor, setSeasonEditor] = useState(null);
  const [publicationEditor, setPublicationEditor] = useState(null);
  const [episodeAppender, setEpisodeAppender] = useState(null);
  const [previewApplication, setPreviewApplication] = useState(null);
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({ name: '', poster: '', genres: 'Action, Aventure', year: '2026', publicationDate: '', publicationTime: '18:00' });
  const notify = (message) => { setNotice(message); setTimeout(() => setNotice(''), 3000); };
  const importAnime = (item, options = {}) => {
    let imported = true;
    setAnime((current) => {
      const itemKey = animeSourceKey(item.sourceUrl);
      const existing = current.find((candidate) => candidate.id === item.id || (itemKey && animeSourceKey(candidate.sourceUrl) === itemKey));
      if (existing && options.skipExisting) {
        imported = false;
        return current;
      }
      return existing
        ? current.map((candidate) => candidate.id === existing.id ? { ...candidate, ...item, id: candidate.id } : candidate)
        : [item, ...current];
    });
    if (!options.silent) {
      setShowAnimeImport(false);
      notify(`${item.name} ${imported ? 'importé' : 'déjà présent'} avec ses saisons, épisodes et lecteurs.`);
    }
    return imported;
  };
  const addAnime = (event) => {
    event.preventDefault();
    const name = form.name.trim();
    if (!name) return;
    const poster = form.poster.trim() || POSTER_POOL[anime.length % POSTER_POOL.length];
    const schedule = form.publicationDate ? { date: form.publicationDate, time: form.publicationTime || '18:00', day: dayFromDate(form.publicationDate) } : undefined;
    const item = { id: `${slugify(name)}-${Date.now()}`, name, poster, backdrop: poster, description: '', genres: form.genres.split(',').map((value) => value.trim()).filter(Boolean), year: form.year, studio: '', isStudio: false, status: 'En cours', seasons: [], ...(schedule ? { schedule } : {}) };
    setAnime((current) => [item, ...current]); setForm({ name: '', poster: '', genres: 'Action, Aventure', year: '2026', publicationDate: '', publicationTime: '18:00' }); setShowAnimeForm(false); notify('Anime ajouté au catalogue.');
  };
  const saveSeason = (animeId, season, editingSeasonId) => {
    setAnime((current) => current.map((item) => item.id !== animeId ? item : { ...item, seasons: editingSeasonId ? item.seasons.map((saved) => saved.id === editingSeasonId ? season : saved) : [...item.seasons, season] }));
    setSeasonEditor(null); notify(editingSeasonId ? 'Saison modifiée.' : 'Saison enregistrée.');
  };
  const deleteSeason = (animeId, seasonId, seasonName) => {
    if (!window.confirm(`Supprimer ${seasonName} et toutes ses versions ?`)) return;
    setAnime((current) => current.map((item) => item.id === animeId ? { ...item, seasons: item.seasons.filter((season) => season.id !== seasonId) } : item));
    notify('Saison supprimée.');
  };
  const savePublication = (animeId, schedule) => {
    setAnime((current) => current.map((item) => {
      if (item.id !== animeId) return item;
      if (schedule) return { ...item, schedule };
      const { schedule: removedSchedule, ...withoutSchedule } = item;
      return withoutSchedule;
    }));
    setPublicationEditor(null);
    notify(schedule ? 'Date de publication enregistrée.' : 'Date de publication supprimée.');
  };
  const deletePublication = (item) => {
    if (!window.confirm(`Supprimer la date de publication de ${item.name} ?`)) return;
    savePublication(item.id, null);
  };
  const appendEpisodes = (animeId, seasonId, versionIndex, readerIndex, episodes) => {
    setAnime((current) => current.map((item) => item.id !== animeId ? item : {
      ...item,
      seasons: item.seasons.map((season) => season.id !== seasonId ? season : {
        ...season,
        versions: season.versions.map((version, index) => {
          if (index !== versionIndex) return version;
          const readers = version.readers?.length ? version.readers : [{ name: 'Lecteur 1', episodes: [] }];
          return {
            ...version,
            readers: readers.map((reader, indexInVersion) => indexInVersion === readerIndex ? { ...reader, episodes: [...(reader.episodes || []), ...episodes] } : reader)
          };
        })
      })
    }));
    setEpisodeAppender(null);
    notify(`${episodes.length} épisode${episodes.length > 1 ? 's' : ''} ajouté${episodes.length > 1 ? 's' : ''}.`);
  };
  const reviewApplication = (application, status) => {
    const action = status === 'accepted' ? 'accepter' : 'refuser';
    if (!window.confirm(`Voulez-vous ${action} la candidature de ${application.studioName} ?`)) return;
    setApplications((current) => current.map((entry) => entry.id === application.id ? { ...entry, status, reviewedAt: Date.now() } : entry));
    if (status === 'accepted') setUsers((current) => current.map((user) => user.id === application.userId ? { ...user, role: 'studio-maker', studioApplicationId: application.id } : user));
    notify(status === 'accepted' ? 'Candidature acceptée. Le compte est maintenant Studio Maker.' : 'Candidature refusée.');
  };
  const clearAllCatalog = async () => {
    if (!anime.length) {
      notify('Le catalogue est déjà vide.');
      return;
    }
    if (!window.confirm(`Cette action supprimera définitivement ${anime.length} anime et toutes leurs dates du planning. Les comptes et candidatures seront conservés. Continuer ?`)) return;
    if (window.prompt('Pour confirmer, écrivez exactement SUPPRIMER') !== 'SUPPRIMER') {
      notify('Suppression annulée.');
      return;
    }
    try {
      const response = await fetch('/api/catalog', { method: 'DELETE', headers: { 'x-mozilanim-admin': adminToken } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'La suppression a échoué.');
      setAnime([]);
      notify('Tous les anime et le planning ont été supprimés.');
    } catch (error) {
      notify(error.message || 'La suppression a échoué.');
    }
  };
  const totalEpisodes = anime.reduce((sum, item) => sum + item.seasons.reduce((seasonSum, season) => seasonSum + season.versions.reduce((versionSum, version) => versionSum + allEpisodes(version).length, 0), 0), 0);
  return <div className="page admin-page"><div className="admin-top"><div><span className="eyebrow"><ShieldCheck size={13} /> ESPACE SÉCURISÉ</span><h1>Administration</h1><p>Gérez le catalogue, les candidatures et les publications Studio Maker.</p></div><div className="admin-top-actions"><button className="secondary-button" onClick={() => setShowAnimeImport(true)}><Download size={17} /> IMPORTER ANIME-SAMA</button><button className="primary-button" onClick={() => setShowAnimeForm(true)}><Plus size={17} /> AJOUTER UN ANIME</button><button className="ghost-button danger-button" onClick={clearAllCatalog} disabled={!anime.length}><Trash2 size={16} /> SUPPRIMER TOUT</button></div></div>{notice && <div className="notice"><Check size={16} /> {notice}</div>}<div className="stat-grid"><div className="stat-card"><span>ANIME</span><strong>{anime.length}</strong></div><div className="stat-card"><span>COMPTES</span><strong>{users.length}</strong></div><div className="stat-card"><span>ÉPISODES</span><strong>{totalEpisodes}</strong><MonitorPlay size={25} /></div></div><section className="manage-card application-admin-card"><div className="manage-heading"><div><h2>Candidatures Mozilanim studio</h2><p>Acceptez ou refusez les projets et regardez leur extrait directement ici.</p></div><span className="admin-badge"><Code2 size={14} /> {applications.filter((entry) => entry.status === 'pending').length} EN ATTENTE</span></div><div className="application-list">{applications.length === 0 && <div className="admin-empty">Aucune candidature pour le moment.</div>}{applications.map((application) => <div className="application-admin-item" key={application.id}><div className="application-admin-main"><div className="application-mini-poster" style={{ backgroundImage: `url(${application.animePhoto})` }} /><div><strong>{application.animeName}</strong><span>{application.studioName} · {application.email}</span><small>{application.status === 'pending' ? 'En attente de décision' : application.status === 'accepted' ? 'Acceptée · Studio Maker' : 'Refusée'}</small><button className="text-button excerpt-toggle" onClick={() => setPreviewApplication(previewApplication === application.id ? null : application.id)}><Eye size={14} /> {previewApplication === application.id ? 'MASQUER L’EXTRAIT' : 'VOIR L’EXTRAIT'}</button></div></div>{application.status === 'pending' && <div className="application-actions"><button className="primary-button" onClick={() => reviewApplication(application, 'accepted')}><Check size={14} /> ACCEPTER</button><button className="ghost-button danger-button" onClick={() => reviewApplication(application, 'refused')}><Ban size={14} /> REFUSER</button></div>}{previewApplication === application.id && <ApplicationExcerpt url={application.excerpt} title={`Extrait de ${application.animeName}`} />}</div>)}</div></section><section className="manage-card"><div className="manage-heading"><div><h2>Catalogue partagé</h2><p>Seuls les administrateurs ajoutent des anime. Les visiteurs voient automatiquement tout le catalogue publié.</p></div><span className="admin-badge"><ShieldCheck size={14} /> ADMINISTRATEUR</span></div><div className="manage-list">{anime.map((item) => <div className="manage-item" key={item.id}><div className="manage-row"><div className="manage-poster" style={{ backgroundImage: `url(${item.poster})` }} /><div className="manage-name"><strong>{item.name}</strong><span>{item.isStudio ? `${item.studio} · Studio Maker` : `${item.seasons.length} saison${item.seasons.length > 1 ? 's' : ''}`}</span>{item.schedule?.date ? <small>Publication : {item.schedule.date} à {item.schedule.time || '18:00'}</small> : <small>Pas de date de publication</small>}</div><button className="text-button" onClick={() => setPublicationEditor(item)}><CalendarDays size={14} /> {item.schedule?.date ? 'MODIFIER LA DATE' : 'AJOUTER UNE DATE'}</button>{item.schedule?.date && <button className="text-button danger-button" onClick={() => deletePublication(item)}><CalendarDays size={14} /> SUPPRIMER LA DATE</button>}<button className="ghost-button" onClick={() => setSeasonEditor({ item, season: null })}><Plus size={15} /> AJOUTER UNE SAISON</button><button className="round-action" onClick={() => openAnime(item)} aria-label="Ouvrir"><ArrowRight size={17} /></button></div>{item.seasons.length > 0 && <div className="manage-season-list">{item.seasons.map((season) => <div className="manage-season" key={season.id}><div><strong>{season.name}</strong><span>{season.versions.length} version{season.versions.length > 1 ? 's' : ''} · {Math.max(...season.versions.map((version) => allEpisodes(version).length), 0)} épisodes</span></div><div className="season-actions"><button className="text-button" onClick={() => setEpisodeAppender({ item, season })}><Plus size={14} /> AJOUTER DES ÉPISODES</button><button className="text-button" onClick={() => setSeasonEditor({ item, season })}><Settings size={14} /> MODIFIER</button><button className="text-button danger-button" onClick={() => deleteSeason(item.id, season.id, season.name)}><Trash2 size={16} /> SUPPRIMER</button></div></div>)}</div>}</div>)}</div></section>{showAnimeForm && <AnimeForm form={form} setForm={setForm} onSubmit={addAnime} onClose={() => setShowAnimeForm(false)} />}{showAnimeImport && <AnimeSamaImport existingAnime={anime} adminToken={adminToken} onClose={() => setShowAnimeImport(false)} onRefresh={refreshCatalog} onImport={importAnime} />}{publicationEditor && <PublicationForm item={publicationEditor} onClose={() => setPublicationEditor(null)} onSave={(schedule) => savePublication(publicationEditor.id, schedule)} />}{episodeAppender && <AppendEpisodesForm item={episodeAppender.item} season={episodeAppender.season} onClose={() => setEpisodeAppender(null)} onSave={(versionIndex, readerIndex, episodes) => appendEpisodes(episodeAppender.item.id, episodeAppender.season.id, versionIndex, readerIndex, episodes)} />}{seasonEditor && <SeasonForm item={seasonEditor.item} existingSeason={seasonEditor.season} onClose={() => setSeasonEditor(null)} onSave={(season) => saveSeason(seasonEditor.item.id, season, seasonEditor.season?.id)} />}</div>;
}

function ApplicationExcerpt({ url, title }) {
  if (!url) return <div className="excerpt-preview missing">Aucun extrait fourni.</div>;
  return <div className="excerpt-preview">{uploadedEpisode(url) ? <StoredVideo video={url} title={title} /> : <><div className="legacy-video-note">Cet ancien extrait utilise encore un lien externe. Les nouveaux extraits sont importés directement dans le site.</div><a href={url} target="_blank" rel="noreferrer">Ouvrir l’ancien extrait dans un nouvel onglet <TrendingUp size={13} /></a></>}</div>;
}

function StoredVideo({ video, title }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let active = true;
    let objectUrl = null;
    loadVideoFile(video.videoId).then((url) => {
      if (active) {
        objectUrl = url;
        setSrc(url);
      } else if (url) URL.revokeObjectURL(url);
    }).catch(() => {});
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [video.videoId]);
  return src ? <video className="excerpt-video" src={src} title={title} controls playsInline /> : <div className="legacy-video-note">Chargement de l’extrait…</div>;
}

function PublicationForm({ item, onClose, onSave }) {
  const [date, setDate] = useState(item.schedule?.date || '');
  const [time, setTime] = useState(item.schedule?.time || '18:00');
  const save = (event) => {
    event.preventDefault();
    onSave(date ? { date, time: time || '18:00', day: dayFromDate(date) } : null);
  };
  return <div className="modal-backdrop"><form className="modal" onSubmit={save}><div className="modal-heading"><div><span className="eyebrow">PLANNING</span><h2>{item.name}</h2></div><button type="button" className="close-button" onClick={onClose}><X size={18} /></button></div><Field label="Date de publication" hint="Sans date, cet anime ne sera pas affiché dans le planning."><input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field><Field label="Heure de publication"><input required type="time" value={time} onChange={(event) => setTime(event.target.value)} /></Field><div className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>ANNULER</button><button className="primary-button" type="submit"><CalendarDays size={16} /> ENREGISTRER LA DATE</button></div></form></div>;
}

function AppendEpisodesForm({ item, season, onClose, onSave }) {
  const versions = season.versions || [];
  const [versionIndex, setVersionIndex] = useState(0);
  const [readerIndex, setReaderIndex] = useState(0);
  const [script, setScript] = useState('');
  const [error, setError] = useState('');
  const selectedVersion = versions[versionIndex];
  const readers = selectedVersion?.readers?.length ? selectedVersion.readers : [{ name: 'Lecteur 1', episodes: [] }];
  const detectedEpisodes = parsePlayers(script).flatMap((reader) => reader.episodes);
  useEffect(() => setReaderIndex(0), [versionIndex]);
  const save = (event) => {
    event.preventDefault();
    if (!detectedEpisodes.length) {
      setError('Ajoutez au moins un lien d’épisode.');
      return;
    }
    onSave(versionIndex, Math.min(readerIndex, readers.length - 1), detectedEpisodes);
  };
  return <div className="modal-backdrop"><form className="modal season-modal" onSubmit={save}><div className="modal-heading"><div><span className="eyebrow">AJOUTER DES ÉPISODES</span><h2>{item.name} · {season.name}</h2></div><button type="button" className="close-button" onClick={onClose}><X size={18} /></button></div>{versions.length > 1 && <Field label="Version"><select value={versionIndex} onChange={(event) => setVersionIndex(Number(event.target.value))}>{versions.map((version, index) => <option value={index} key={`${version.name}-${index}`}>{version.name}</option>)}</select></Field>}<Field label="Lecteur"><select value={readerIndex} onChange={(event) => setReaderIndex(Number(event.target.value))}>{readers.map((reader, index) => <option value={index} key={`${reader.name}-${index}`}>{reader.name}</option>)}</select></Field><Field label="Liens des épisodes" hint="Collez vos liens ou vos tableaux var eps1 = [ ... ]. Ils seront ajoutés à cette saison sans remplacer les épisodes existants."><textarea required rows="8" value={script} onChange={(event) => { setScript(event.target.value); setError(''); }} placeholder="var eps1 = [ 'https://video.sibnet.ru/...' ];" /></Field><div className="reader-hint">{detectedEpisodes.length} épisode(s) détecté(s)</div>{error && <div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>ANNULER</button><button className="primary-button" type="submit"><Plus size={16} /> AJOUTER LES ÉPISODES</button></div></form></div>;
}

function Studio({ users, currentUser, applications, anime, setAnime, setApplications, stats, go, onLogin }) {
  const application = applications.find((entry) => entry.userId === currentUser?.id);
  const ownedAnime = anime.find((item) => item.ownerId === currentUser?.id);
  const [form, setForm] = useState({ studioName: '', animeName: '', animePhoto: '', description: '', excerpt: null, day: '5', time: '18:00' });
  const [showSeason, setShowSeason] = useState(false);
  const [episodeSeason, setEpisodeSeason] = useState(null);
  const [notice, setNotice] = useState('');
  const [createForm, setCreateForm] = useState({ name: '', poster: '', genres: 'Action, Aventure' });
  const notify = (message) => { setNotice(message); setTimeout(() => setNotice(''), 3500); };
  if (!currentUser) return <div className="page studio-page"><StudioHero /><AccessDenied onLogin={onLogin} studio /></div>;
  const submitApplication = async (event) => {
    event.preventDefault();
    try {
      const excerpt = await saveVideoFile(form.excerpt);
      const entry = { ...form, excerpt, id: `application-${Date.now()}`, userId: currentUser.id, email: currentUser.email, status: 'pending', createdAt: Date.now() };
      setApplications((current) => [...current.filter((candidate) => candidate.userId !== currentUser.id), entry]);
      notify('Candidature envoyée à l’administration.');
    } catch (submitError) {
      notify(submitError.message || 'La candidature n’a pas pu être envoyée.');
    }
  };
  if (currentUser.role !== 'studio-maker') return <div className="page studio-page"><StudioHero /><section className="studio-application-layout"><div className="studio-intro"><span className="eyebrow">DEVENEZ CRÉATEUR</span><h1>Proposez votre anime</h1><p>Votre candidature sera vérifiée par l’administrateur. Après acceptation, votre compte devient Studio Maker.</p>{application && <div className={`application-status ${application.status}`}><strong>{application.status === 'pending' ? 'Candidature en attente' : 'Candidature refusée'}</strong><span>{application.status === 'pending' ? 'L’administrateur doit encore examiner votre projet.' : 'Vous pouvez corriger votre projet et envoyer une nouvelle candidature.'}</span></div>}</div><StudioApplicationForm form={form} setForm={setForm} disabled={application?.status === 'pending'} onSubmit={submitApplication} /></section>{notice && <div className="notice">{notice}</div>}</div>;
  const studioAnime = ownedAnime;
  const applicationData = application || {};
  const createAnime = (event) => {
    event.preventDefault();
    if (studioAnime || !createForm.name.trim()) return;
    const poster = createForm.poster.trim() || applicationData.animePhoto || POSTER_POOL[anime.length % POSTER_POOL.length];
    setAnime((current) => [{ id: `studio-${slugify(createForm.name)}-${Date.now()}`, name: createForm.name.trim(), poster, backdrop: poster, description: applicationData.description, excerpt: applicationData.excerpt, genres: createForm.genres.split(',').map((value) => value.trim()).filter(Boolean), year: String(new Date().getFullYear()), studio: applicationData.studioName, isStudio: true, ownerId: currentUser.id, schedule: { day: Number(applicationData.day), time: applicationData.time }, status: 'En cours', seasons: [] }, ...current]);
    notify('Votre anime Studio Maker a été créé.');
  };
  const saveStudioSeason = (season) => {
    if (!studioAnime || studioAnime.seasons.length >= 5) return;
    setAnime((current) => current.map((item) => item.id === studioAnime.id ? { ...item, seasons: [...item.seasons, season] } : item));
    setShowSeason(false); notify('Saison Studio enregistrée.');
  };
  const publishEpisode = async (event, season, data) => {
    event.preventDefault();
    try {
      const video = await saveVideoFile(data.file);
      setAnime((current) => current.map((item) => {
        if (item.id !== studioAnime.id) return item;
        return { ...item, seasons: item.seasons.map((candidate) => candidate.id !== season.id ? candidate : {
          ...candidate, versions: candidate.versions.map((version, index) => index !== 0 ? version : {
            ...version, episodeNames: [...(version.episodeNames || []), data.name.trim()], readers: (version.readers || [{ name: 'Vidéos importées', episodes: [] }]).map((reader, readerIndex) => readerIndex === 0 ? { ...reader, episodes: [...(reader.episodes || []), video] } : reader)
          })
        })};
      }));
      setEpisodeSeason(null); notify('Nouvel épisode vidéo publié.');
    } catch (publishError) {
      notify(publishError.message || 'La vidéo n’a pas pu être publiée.');
    }
  };
  const ownStats = studioAnime ? stats[studioAnime.id] || {} : {};
  const ownEpisodes = studioAnime ? studioAnime.seasons.reduce((total, season) => total + allEpisodes(season.versions[0]).length, 0) : 0;
  return <div className="page studio-page"><StudioHero maker /><div className="studio-dashboard-heading"><div><span className="eyebrow"><Code2 size={13} /> ESPACE STUDIO MAKER</span><h1>Bonjour {currentUser.name}</h1><p>Votre planning : {DAYS[Number(applicationData.day)]} à {applicationData.time}.</p></div><span className="studio-maker-badge"><Check size={14} /> STUDIO MAKER</span></div>{notice && <div className="notice"><Check size={16} /> {notice}</div>}{studioAnime && <StudioStats stats={ownStats} seasons={studioAnime.seasons.length} episodes={ownEpisodes} />}{!studioAnime ? <section className="studio-panel create-studio-panel"><div className="panel-heading"><div><h2>Créer votre anime</h2><p>Votre compte peut créer un seul anime et jusqu’à 5 saisons.</p></div><span className="limit-badge">1 ANIME</span></div><form onSubmit={createAnime}><div className="form-grid"><Field label="Nom de l'anime"><input required value={createForm.name} onChange={(event) => setCreateForm({ ...createForm, name: event.target.value })} /></Field><Field label="Photo de l'anime" hint="L’image de votre candidature est utilisée par défaut"><input value={createForm.poster} onChange={(event) => setCreateForm({ ...createForm, poster: event.target.value })} placeholder="https://..." /></Field><Field label="Genres"><input value={createForm.genres} onChange={(event) => setCreateForm({ ...createForm, genres: event.target.value })} /></Field></div><button className="primary-button" type="submit"><Plus size={16} /> CRÉER MON ANIME</button></form></section> : <StudioAnimePanel item={studioAnime} setShowSeason={setShowSeason} setEpisodeSeason={setEpisodeSeason} />}{showSeason && studioAnime && <StudioSeasonForm item={studioAnime} onClose={() => setShowSeason(false)} onSave={saveStudioSeason} />}{episodeSeason && studioAnime && <EpisodeForm season={episodeSeason} onClose={() => setEpisodeSeason(null)} onSubmit={publishEpisode} />}</div>;
}

function StudioHero({ maker = false }) {
  return <section className="studio-hero"><div className="studio-hero-glow" /><div className="studio-hero-copy"><h1>Mozilanim <strong>studio</strong></h1><p>Un espace pour présenter vos anime, organiser vos saisons et publier vos épisodes.</p>{!maker && <div className="studio-benefits"><span><Check size={14} /> 1 anime par créateur</span><span><Check size={14} /> Jusqu’à 5 saisons</span><span><Check size={14} /> Planning de publication</span></div>}</div><div className="studio-hero-mark"><Code2 size={52} /></div></section>;
}

function StudioApplicationForm({ form, setForm, disabled, onSubmit }) {
  const update = (key) => (event) => setForm({ ...form, [key]: event.target.value });
  return <form className="studio-form" onSubmit={onSubmit}><div className="form-grid"><Field label="Nom du studio"><input required disabled={disabled} value={form.studioName} onChange={update('studioName')} /></Field><Field label="Nom de l'anime"><input required disabled={disabled} value={form.animeName} onChange={update('animeName')} /></Field><Field label="Photo de l'anime" hint="URL publique de l'affiche"><input required disabled={disabled} value={form.animePhoto} onChange={update('animePhoto')} placeholder="https://..." /></Field><Field label="Jour de publication"><select required disabled={disabled} value={form.day} onChange={update('day')}>{DAYS.map((day, index) => <option value={index} key={day}>{day}</option>)}</select></Field><Field label="Heure de publication"><input required disabled={disabled} type="time" value={form.time} onChange={update('time')} /></Field><Field label="Extrait vidéo" hint="Importez directement un fichier vidéo, sans lien externe."><input required disabled={disabled} type="file" accept="video/*" onChange={(event) => setForm({ ...form, excerpt: event.target.files?.[0] || null })} />{form.excerpt?.name && <small className="selected-files">{form.excerpt.name}</small>}</Field><Field label="Description de l'anime"><textarea required disabled={disabled} className="full-field" rows="6" value={form.description} onChange={update('description')} /></Field></div><button className="primary-button" disabled={disabled} type="submit"><Upload size={16} /> ENVOYER MA CANDIDATURE</button></form>;
}

function StudioAnimePanel({ item, setShowSeason, setEpisodeSeason }) {
  return <section className="studio-panel"><div className="studio-anime-heading"><div className="studio-anime-cover" style={{ backgroundImage: `url(${item.poster})` }} /><div><span className="eyebrow">VOTRE PROJET</span><h2>{item.name}</h2><p>{item.seasons.length} saison{item.seasons.length > 1 ? 's' : ''} · {item.studio}</p></div><button className="primary-button" disabled={item.seasons.length >= 5} onClick={() => setShowSeason(true)}><Plus size={16} /> AJOUTER UNE SAISON</button></div><div className="schedule-callout"><CalendarDays size={19} /><div><strong>Planning choisi</strong><span>{item.schedule ? `${DAYS[item.schedule.day]} à ${item.schedule.time}` : 'Planning non défini'}</span></div></div><div className="studio-season-grid">{item.seasons.length === 0 && <div className="admin-empty">Créez votre première saison pour commencer à publier.</div>}{item.seasons.map((season) => <div className="studio-season-card" key={season.id}><div><strong>{season.name}</strong><span>{allEpisodes(season.versions[0]).length} épisode(s) publié(s)</span></div><button className="ghost-button" onClick={() => setEpisodeSeason(season)}><Plus size={14} /> PUBLIER UN ÉPISODE</button></div>)}</div></section>;
}

function StudioStats({ stats, seasons, episodes }) {
  return <section className="studio-stats"><div className="studio-stats-heading"><div><span className="eyebrow"><BarChart3 size={14} /> STATISTIQUES DE L’ANIME</span><h2>Les performances de votre projet</h2></div><span className="muted">Mise à jour pendant les lectures et les j'aime</span></div><div className="studio-stats-grid"><div className="studio-stat-card"><Eye size={19} /><span>VUES</span><strong>{stats.views || 0}</strong><small>Total des ouvertures du lecteur</small></div><div className="studio-stat-card"><Heart size={19} /><span>J'AIME</span><strong>{stats.likes || 0}</strong><small>Appréciations enregistrées</small></div><div className="studio-stat-card"><Layers3 size={19} /><span>SAISONS</span><strong>{seasons}</strong><small>Dans votre projet</small></div><div className="studio-stat-card"><MonitorPlay size={19} /><span>ÉPISODES</span><strong>{episodes}</strong><small>Épisodes publiés</small></div></div></section>;
}

function StudioSeasonForm({ item, onClose, onSave }) {
  const [name, setName] = useState(`Saison ${item.seasons.length + 1}`);
  const save = (event) => { event.preventDefault(); onSave({ id: `studio-season-${Date.now()}`, name, versions: [{ name: 'VOSTFR', readers: [{ name: 'Lecteur Studio', episodes: [] }], episodeNames: [] }] }); };
  return <div className="modal-backdrop"><form className="modal" onSubmit={save}><div className="modal-heading"><div><span className="eyebrow">NOUVELLE SAISON</span><h2>{item.name}</h2></div><button type="button" className="close-button" onClick={onClose}><X size={18} /></button></div><Field label="Nom de la saison"><input required value={name} onChange={(event) => setName(event.target.value)} /></Field><div className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>ANNULER</button><button className="primary-button" type="submit"><Check size={16} /> CRÉER LA SAISON</button></div></form></div>;
}

function EpisodeForm({ season, onClose, onSubmit }) {
  const [data, setData] = useState({ name: '', file: null });
  const [error, setError] = useState('');
  const submit = (event) => { if (!data.file) { event.preventDefault(); setError('Sélectionnez un fichier vidéo avant de publier.'); return; } onSubmit(event, season, data); };
  return <div className="modal-backdrop"><form className="modal" onSubmit={submit}><div className="modal-heading"><div><span className="eyebrow">PUBLICATION</span><h2>{season.name}</h2></div><button type="button" className="close-button" onClick={onClose}><X size={18} /></button></div><Field label="Nom de l'épisode"><input required value={data.name} onChange={(event) => setData({ ...data, name: event.target.value })} placeholder="Ex. Le commencement" /></Field><Field label="Vidéo de l'épisode" hint="Importez directement un fichier vidéo. Aucun compte ou lecteur externe n’est nécessaire."><input required type="file" accept="video/*" onChange={(event) => setData({ ...data, file: event.target.files?.[0] || null })} />{data.file?.name && <small className="selected-files">{data.file.name}</small>}</Field>{error && <div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>ANNULER</button><button className="primary-button" type="submit"><Upload size={16} /> PUBLIER L'ÉPISODE</button></div></form></div>;
}

function Field({ label, children, hint }) { return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }

function AnimeForm({ form, setForm, onSubmit, onClose }) {
  const update = (key) => (event) => setForm({ ...form, [key]: event.target.value });
  return <div className="modal-backdrop"><form className="modal admin-modal" onSubmit={onSubmit}><div className="modal-heading"><div><span className="eyebrow">NOUVELLE FICHE</span><h2>Ajouter un anime</h2></div><button type="button" className="close-button" onClick={onClose}><X size={18} /></button></div><div className="form-grid"><Field label="Nom de l'anime"><input required value={form.name} onChange={update('name')} placeholder="Ex. Solo Leveling" /></Field><Field label="Année"><input value={form.year} onChange={update('year')} placeholder="2026" /></Field><Field label="Photo / URL de l'affiche"><input value={form.poster} onChange={update('poster')} placeholder="https://..." /></Field><Field label="Genres" hint="Séparez les genres par une virgule"><input value={form.genres} onChange={update('genres')} placeholder="Action, Romance" /></Field><Field label="Date de publication" hint="Optionnel. Sans date, l’anime n’apparaît pas dans le planning."><input type="date" value={form.publicationDate} onChange={update('publicationDate')} /></Field><Field label="Heure de publication"><input type="time" value={form.publicationTime} onChange={update('publicationTime')} /></Field></div><div className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>ANNULER</button><button className="primary-button" type="submit"><Plus size={16} /> AJOUTER L'ANIME</button></div></form></div>;
}

function SeasonForm({ item, existingSeason, onClose, onSave }) {
  const [name, setName] = useState(existingSeason?.name || `Saison ${item.seasons.length + 1}`);
  const [versions, setVersions] = useState(() => existingSeason?.versions?.map((version) => ({ name: version.name, script: '', existingReaders: version.readers, episodeNames: version.episodeNames })) || [{ name: 'VOSTFR', script: '' }]);
  const addVersion = () => setVersions([...versions, { name: 'VF', script: '' }]);
  const save = (event) => {
    event.preventDefault();
    onSave({
      id: existingSeason?.id || `${slugify(name)}-${Date.now()}`,
      name,
      versions: versions.map((version) => ({
        name: version.name || 'AUTRE',
        readers: parsePlayers(version.script).length ? parsePlayers(version.script) : (version.existingReaders || []),
        episodeNames: version.episodeNames || []
      }))
    });
  };
  return <div className="modal-backdrop"><form className="modal season-modal" onSubmit={save}><div className="modal-heading"><div><span className="eyebrow">{existingSeason ? 'MODIFIER LE CONTENU' : 'AJOUTER DU CONTENU'}</span><h2>{item.name}</h2></div><button type="button" className="close-button" onClick={onClose}><X size={18} /></button></div><Field label="Nom de la saison"><input required value={name} onChange={(event) => setName(event.target.value)} /></Field><div className="version-heading"><span>VERSIONS ET LECTEURS</span><button type="button" className="text-button" onClick={addVersion}><Plus size={14} /> AJOUTER UNE VERSION</button></div>{versions.map((version, index) => <div className="version-form" key={index}><div className="version-line"><Field label={`Nom de la version ${index + 1}`}><input value={version.name} onChange={(event) => setVersions(versions.map((v, i) => i === index ? { ...v, name: event.target.value } : v))} placeholder="VOSTFR, VF, VKR..." /></Field><span className="reader-hint">{parsePlayers(version.script).length ? parsePlayers(version.script).reduce((sum, reader) => sum + reader.episodes.length, 0) : allEpisodes({ readers: version.existingReaders || [] }).length} épisode(s) détecté(s)</span></div><Field label="Script des épisodes" hint={existingSeason && version.existingReaders?.length ? 'Laissez vide pour conserver les épisodes actuels' : 'Collez vos tableaux var eps1 = [ ... ]'}><textarea rows="7" value={version.script} onChange={(event) => setVersions(versions.map((v, i) => i === index ? { ...v, script: event.target.value } : v))} placeholder="var eps1 = [ 'https://...' ];" /></Field></div>)}<div className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>ANNULER</button><button className="primary-button" type="submit"><Check size={16} /> {existingSeason ? 'ENREGISTRER LES MODIFICATIONS' : 'ENREGISTRER LA SAISON'}</button></div></form></div>;
}

function LoginModal({ open, mode, setMode, onRegisterPage, onClose, onUserSuccess, onAdminSuccess, users, setUsers }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { if (open) setError(''); }, [open, mode]);
  if (!open) return null;
  const submit = async (event) => {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (mode === 'register') {
      if (password.length < 6) return setError('Le mot de passe doit contenir au moins 6 caractères.');
      if (!name.trim()) return setError('Indiquez votre nom.');
      if (users.some((user) => user.email === normalizedEmail)) return setError('Un compte existe déjà avec cet email.');
      const account = { id: `user-${Date.now()}`, name: name.trim(), email: normalizedEmail, password, role: 'user', createdAt: Date.now() };
      setUsers((current) => [...current, account]); onUserSuccess(account); return;
    }
    try {
      const adminResponse = await fetch('/api/admin/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail, password })
      });
      const adminPayload = await adminResponse.json().catch(() => ({}));
      if (adminResponse.ok) {
        onAdminSuccess(adminPayload.token);
        return;
      }
      if (adminResponse.status >= 500) {
        return setError('Connexion administrateur indisponible. Vérifiez SESSION_SECRET, ADMIN_EMAIL et ADMIN_PASSWORD dans Railway.');
      }
      if (adminResponse.status === 403) {
        return setError(adminPayload.error || 'Connexion administrateur bloquée temporairement. Réessayez plus tard.');
      }
    } catch {
      return setError('API administrateur inaccessible. Vérifiez que Railway démarre bien la commande npm start.');
    }
    const account = users.find((user) => user.email === normalizedEmail && user.password === password);
    if (!account) return setError('Email ou mot de passe incorrect.');
    onUserSuccess(account);
  };
  return <div className="modal-backdrop"><form className="modal login-modal" onSubmit={submit}><button type="button" className="close-button" onClick={onClose}><X size={18} /></button><div className="login-mark"><UserCircle size={25} /></div><span className="eyebrow">COMPTE MOZILANIM</span><h2>{mode === 'register' ? 'Créer un compte' : 'Se connecter'}</h2>{mode === 'register' && <Field label="Votre nom"><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Votre nom" /></Field>}<Field label="Adresse email"><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="votre@email.com" /></Field><Field label="Mot de passe"><input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" /></Field>{error && <div className="form-error">{error}</div>}<button className="primary-button login-button" type="submit">{mode === 'register' ? 'CRÉER MON COMPTE' : 'SE CONNECTER'} <ArrowRight size={16} /></button><button className="switch-login" type="button" onClick={() => mode === 'login' && onRegisterPage ? onRegisterPage() : setMode('login')}>{mode === 'register' ? 'J’ai déjà un compte' : 'Créer un compte'}</button></form></div>;
}

function AccountPage({ mode, users, setUsers, onUserSuccess, onAdminSuccess, onRegister, onLogin, onBack }) {
  const isRegister = mode === 'register';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (isRegister) {
      if (password.length < 6) return setError('Le mot de passe doit contenir au moins 6 caractères.');
      if (!name.trim()) return setError('Indiquez votre nom.');
      if (users.some((user) => user.email === normalizedEmail)) return setError('Un compte existe déjà avec cet email.');
      const account = { id: `user-${Date.now()}`, name: name.trim(), email: normalizedEmail, password, role: 'user', createdAt: Date.now() };
      setUsers((current) => [...current, account]);
      onUserSuccess(account);
      return;
    }
    try {
      const response = await fetch('/api/admin/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail, password })
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) {
        onAdminSuccess(payload.token);
        return;
      }
      if (response.status >= 500) {
        setError('Connexion administrateur indisponible. Vérifiez la configuration serveur.');
        return;
      }
      if (response.status === 403) {
        setError(payload.error || 'Connexion bloquée temporairement. Réessayez plus tard.');
        return;
      }
    } catch {
      setError('API administrateur inaccessible. Réessayez dans un instant.');
      return;
    }
    const account = users.find((user) => user.email === normalizedEmail && user.password === password);
    if (!account) setError('Email ou mot de passe incorrect.');
    else onUserSuccess(account);
  };

  return <div className="page account-page">
    <form className="account-card" onSubmit={submit}>
      <button type="button" className="account-back" onClick={onBack}><ArrowLeft size={16} /> Retour au catalogue</button>
      <div className="login-mark"><UserCircle size={25} /></div>
      <span className="eyebrow">COMPTE MOZILANIM</span>
      <h1>{isRegister ? 'Créer un compte' : 'Se connecter'}</h1>
      <p>{isRegister ? 'Créez votre compte pour suivre vos animés et rejoindre Mozilanim studio.' : 'Retrouvez vos favoris et accédez à votre espace Mozilanim.'}</p>
      {isRegister && <Field label="Votre nom"><input required autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Votre nom" /></Field>}
      <Field label="Adresse email"><input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="votre@email.com" /></Field>
      <Field label="Mot de passe"><input required type="password" autoComplete={isRegister ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" /></Field>
      {error && <div className="form-error">{error}</div>}
      <button className="primary-button login-button" type="submit">{isRegister ? 'CRÉER MON COMPTE' : 'SE CONNECTER'} <ArrowRight size={16} /></button>
      {isRegister ? <button className="switch-login" type="button" onClick={onLogin}>J’ai déjà un compte</button> : <button className="switch-login" type="button" onClick={onRegister}>Créer un compte</button>}
    </form>
  </div>;
}

function AccessDenied({ onLogin, studio = false }) {
  return <div className="access-page"><div className="access-box"><ShieldCheck size={42} /><h1>{studio ? 'Connectez-vous pour créer' : 'Accès administration'}</h1><p>{studio ? 'Un compte MOZILANIM est nécessaire pour déposer une candidature Studio Maker.' : 'Connectez-vous avec un compte autorisé pour gérer le catalogue.'}</p><button className="primary-button" onClick={onLogin}>OUVRIR LA CONNEXION <ArrowRight size={16} /></button></div></div>;
}

function Footer({ go }) {
  return <footer id="footer"><div className="footer-inner"><div className="footer-brand"><span className="brand-mark"><img src={siteIcon} alt="" /></span><strong>MOZILANIM</strong><p>Votre catalogue d’animés, simplement.</p></div><div className="footer-links"><button onClick={() => go('catalog')}>Catalogue</button><button onClick={() => go('studio')}>Mozilanim studio</button><button onClick={() => go('planning')}>Planning</button><span>Signaler un lien</span><span>Conditions</span></div><div className="footer-copy">© 2026 MOZILANIM</div></div><button className="back-top" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}><ArrowUp size={17} /></button></footer>;
}

createRoot(document.getElementById('root')).render(<App />);