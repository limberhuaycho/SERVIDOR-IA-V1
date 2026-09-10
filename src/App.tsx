import { type ReactNode, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Link, Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import {
  ArrowUpRight, AudioLines, Check, CheckCircle2, ChevronRight, Clipboard, Code2, Copy, Download,
  FileArchive, FileCode2, FileImage, FileText, FileVideo, FolderOpen, Gauge, Grid2X2, HardDrive,
  History, Image as ImageIcon, Info, LayoutDashboard, Menu, Music2, PlaySquare, RefreshCcw, ScanLine,
  Settings, ShieldCheck, Sparkles, Trash2, Upload, Video, X, Zap,
  type LucideIcon,
} from 'lucide-react';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

type Toast = { id: number; kind: 'ok' | 'error' | 'info'; message: string };
type HistoryItem = {
  id: string; name: string; tool: string; size: string; date: string; status: 'Completado' | 'Limitado';
  hash?: string; report?: string;
};

const navGroups = [
  { label: 'Espacio de trabajo', items: [
    { href: '/', label: 'Inicio', icon: LayoutDashboard },
    { href: '/galeria', label: 'Galería', icon: Grid2X2 },
    { href: '/historial', label: 'Historial', icon: History },
  ]},
  { label: 'Herramientas locales', items: [
    { href: '/analizador-imagenes', label: 'Analizador de imágenes', icon: FileImage },
    { href: '/analizador-audio', label: 'Analizador de audio', icon: AudioLines },
    { href: '/analizador-video', label: 'Analizador de video', icon: FileVideo },
    { href: '/analizador-texto', label: 'Analizador de texto', icon: FileText },
    { href: '/analizador-codigo', label: 'Analizador de código', icon: FileCode2 },
    { href: '/convertidor', label: 'Convertidor', icon: RefreshCcw },
  ]},
  { label: 'Servicios externos', items: [
    { href: '/descargar-video', label: 'Descargar video', icon: Video },
    { href: '/descargar-musica', label: 'Descargar música', icon: Music2 },
    { href: '/tiktok', label: 'TikTok', icon: PlaySquare },
    { href: '/generador-imagenes', label: 'Generador de imágenes', icon: Sparkles },
  ]},
];

const toolConfig: Record<string, {
  title: string; eyebrow: string; description: string; accept: string; icon: LucideIcon;
  checks: string[]; resultLabel: string;
}> = {
  '/analizador-imagenes': { title: 'Analizador de imágenes', eyebrow: 'Lectura local / imagen', description: 'Inspecciona dimensiones, formato, peso y metadatos básicos sin subir el archivo a ningún servidor.', accept: 'image/*', icon: FileImage, resultLabel: 'Informe visual', checks: ['Dimensiones y relación de aspecto', 'Tipo MIME y tamaño exacto', 'Hash SHA-256 del archivo'] },
  '/analizador-audio': { title: 'Analizador de audio', eyebrow: 'Lectura local / audio', description: 'Obtén una ficha técnica honesta de tus archivos de audio. El navegador lee lo que el contenedor expone, sin inventar señales.', accept: 'audio/*', icon: AudioLines, resultLabel: 'Informe acústico', checks: ['Duración y tipo de contenedor', 'Tamaño y nombre de archivo', 'Hash SHA-256 del archivo'] },
  '/analizador-video': { title: 'Analizador de video', eyebrow: 'Lectura local / video', description: 'Revisa duración, dimensiones y compatibilidad del navegador con una vista previa local.', accept: 'video/*', icon: FileVideo, resultLabel: 'Informe de video', checks: ['Resolución y relación de aspecto', 'Duración leída por el navegador', 'Hash SHA-256 del archivo'] },
  '/analizador-texto': { title: 'Analizador de texto', eyebrow: 'Lectura local / texto', description: 'Cuenta líneas, caracteres, palabras y estructura básica de archivos de texto manteniendo el contenido en tu dispositivo.', accept: '.txt,.md,.csv,.json,.xml,.log,text/*', icon: FileText, resultLabel: 'Informe de texto', checks: ['Conteo de caracteres y palabras', 'Detección de líneas vacías', 'Hash SHA-256 del archivo'] },
  '/analizador-codigo': { title: 'Analizador de código', eyebrow: 'Lectura local / código', description: 'Una lectura rápida de estructura, comentarios y densidad. Es heurística: no reemplaza una auditoría de seguridad.', accept: '.js,.ts,.tsx,.jsx,.css,.html,.py,.json,.sql,.java,.go,.rs,.php', icon: Code2, resultLabel: 'Informe de código', checks: ['Líneas y densidad de comentarios', 'Extensión y tipo de archivo', 'Hash SHA-256 del archivo'] },
};

function readHistory(): HistoryItem[] {
  try { return JSON.parse(localStorage.getItem('lc-history') || '[]') as HistoryItem[]; } catch { return []; }
}

function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(entries: { name: string; data: string }[]) {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  const write16 = (view: DataView, at: number, value: number) => view.setUint16(at, value, true);
  const write32 = (view: DataView, at: number, value: number) => view.setUint32(at, value, true);
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = encoder.encode(entry.data);
    const checksum = crc32(data);
    const local = new Uint8Array(30 + name.length + data.length);
    const localView = new DataView(local.buffer);
    write32(localView, 0, 0x04034b50); write16(localView, 4, 20); write16(localView, 6, 0);
    write16(localView, 8, 0); write16(localView, 10, 0); write16(localView, 12, 0);
    write32(localView, 14, checksum); write32(localView, 18, data.length); write32(localView, 22, data.length);
    write16(localView, 26, name.length); write16(localView, 28, 0);
    local.set(name, 30); local.set(data, 30 + name.length); locals.push(local);
    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    write32(centralView, 0, 0x02014b50); write16(centralView, 4, 20); write16(centralView, 6, 20);
    write16(centralView, 8, 0); write16(centralView, 10, 0); write16(centralView, 12, 0); write16(centralView, 14, 0);
    write32(centralView, 16, checksum); write32(centralView, 20, data.length); write32(centralView, 24, data.length);
    write16(centralView, 28, name.length); write16(centralView, 30, 0); write16(centralView, 32, 0);
    write16(centralView, 34, 0); write16(centralView, 36, 0); write32(centralView, 38, 0); write32(centralView, 42, offset);
    central.set(name, 46); centrals.push(central); offset += local.length;
  }
  const centralSize = centrals.reduce((sum, item) => sum + item.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  write32(endView, 0, 0x06054b50); write16(endView, 4, 0); write16(endView, 6, 0);
  write16(endView, 8, entries.length); write16(endView, 10, entries.length); write32(endView, 12, centralSize);
  write32(endView, 16, offset); write16(endView, 20, 0);
  const all = [...locals, ...centrals, end];
  const output = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0));
  let cursor = 0; for (const part of all) { output.set(part, cursor); cursor += part.length; }
  return output;
}

async function hashFile(file: File) {
  if (!crypto?.subtle) return 'No disponible en este contexto';
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function makeReport(file: File, path: string, hash: string, extra = '') {
  const now = new Date().toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
  return `LC SYSTEMS / INFORME LOCAL
================================
Herramienta: ${toolConfig[path]?.title || 'Lectura local'}
Archivo: ${file.name}
Tipo MIME: ${file.type || 'no declarado'}
Tamaño: ${formatBytes(file.size)}
Procesado: ${now}
SHA-256: ${hash}

NOTA DE ALCANCE
Este informe fue creado en el navegador. No se enviaron datos a un servidor.
Los resultados son descriptivos y heurísticos; no constituyen una conclusión forense.
${extra}`;
}

function getExtension(name: string) { return name.includes('.') ? name.split('.').pop()?.toUpperCase() : 'ARCHIVO'; }

function AppShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const current = navGroups.flatMap((group) => group.items).find((item) => item.href === location);
  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <Link href="/" className="brand" data-testid="link-brand" onClick={() => setMenuOpen(false)}>
          <span className="brand-mark">L</span>
          <span><span className="brand-name">LC Systems</span><span className="brand-sub">media intelligence</span></span>
        </Link>
        <nav aria-label="Navegación principal">
          {navGroups.map((group) => <div key={group.label}>
            <div className="nav-label">{group.label}</div>
            <div className="nav">
              {group.items.map((item) => {
                const Icon = item.icon;
                return <Link key={item.href} href={item.href} className={`nav-link ${location === item.href ? 'active' : ''}`} data-testid={`link-nav-${item.label}`} onClick={() => setMenuOpen(false)}>
                  <Icon /><span>{item.label}</span>
                </Link>;
              })}
            </div>
          </div>)}
        </nav>
        <div className="sidebar-foot">
          <strong>100% local-first</strong>
          Tus archivos permanecen en este navegador. No conectamos con plataformas ni servidores externos.
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="top-actions">
            <button className="icon-btn mobile-menu" aria-label="Abrir menú" data-testid="button-open-menu" onClick={() => setMenuOpen((value) => !value)}><Menu size={17} /></button>
            <div className="crumb"><strong>{current?.label || (location === '/' ? 'Inicio' : 'LC Systems')}</strong> <span>/ navegador local</span></div>
          </div>
          <div className="top-actions">
            <div className="status-pill"><span className="status-dot" /> entorno local activo</div>
            <Link href="/configuracion" className="icon-btn" aria-label="Configuración" data-testid="link-settings"><Settings size={16} /></Link>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}

function ToastStack({ toasts, remove }: { toasts: Toast[]; remove: (id: number) => void }) {
  return <div className="toast-stack" aria-live="polite">{toasts.map((toast) => <div className="toast" key={toast.id} data-testid={`status-toast-${toast.id}`}>
    {toast.kind === 'ok' ? <CheckCircle2 size={16} /> : toast.kind === 'error' ? <X size={16} /> : <Info size={16} />}
    <span>{toast.message}</span>
    <button className="icon-btn" style={{ width: 24, height: 24, marginLeft: 'auto', border: 0, background: 'transparent', color: 'inherit' }} aria-label="Cerrar aviso" data-testid={`button-close-toast-${toast.id}`} onClick={() => remove(toast.id)}><X size={13} /></button>
  </div>)}</div>;
}

function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const notify = (message: string, kind: Toast['kind'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, kind, message }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4200);
  };
  return { toasts, notify, remove: (id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)) };
}

function Home() {
  const history = readHistory();
  const toolCards = [
    { href: '/analizador-imagenes', title: 'Imágenes', desc: 'Dimensiones, formato y metadatos', icon: FileImage },
    { href: '/analizador-audio', title: 'Audio', desc: 'Duración y ficha del contenedor', icon: AudioLines },
    { href: '/analizador-video', title: 'Video', desc: 'Resolución, duración y vista previa', icon: FileVideo },
    { href: '/analizador-texto', title: 'Texto', desc: 'Conteo, estructura y lectura local', icon: FileText },
    { href: '/analizador-codigo', title: 'Código', desc: 'Estructura y señales heurísticas', icon: Code2 },
    { href: '/convertidor', title: 'Convertidor', desc: 'Prepara flujos compatibles', icon: RefreshCcw },
    { href: '/galeria', title: 'Galería', desc: 'Revisa tus archivos procesados', icon: Grid2X2 },
    { href: '/historial', title: 'Historial', desc: 'Informes guardados en este navegador', icon: History },
  ];
  return <Page>
    <div className="hero-grid">
      <section className="hero-panel">
        <div><div className="eyebrow" style={{ color: 'hsl(var(--mint))' }}>LC / estación de trabajo 01</div><h2>Ver primero.<br />Concluir después.</h2><p>Un espacio preciso para inspeccionar medios locales, entender sus límites y dejar una pista técnica que puedas volver a revisar.</p></div>
        <div className="hero-foot"><div className="hero-metric"><span>PRIVACIDAD</span>sin subidas</div><div className="hero-metric"><span>RESPUESTA</span>en tu navegador</div><div className="hero-metric"><span>RIGOR</span>heurístico, explícito</div></div>
      </section>
      <section className="signal-card"><div><div className="eyebrow" style={{ color: 'hsl(var(--paper) / .65)' }}>actividad local</div><div className="big-number">{String(history.length).padStart(2, '0')}</div><div className="small">informes creados en este dispositivo. Se guardan únicamente en localStorage.</div></div><div className="scanline" aria-hidden="true">{Array.from({ length: 10 }).map((_, index) => <i key={index} />)}</div></section>
    </div>
    <div className="section-heading"><div><h2>Herramientas a mano</h2><p>Selecciona un archivo y empieza sin configurar nada.</p></div><Link href="/ayuda" className="btn btn-ghost" data-testid="link-home-help">Cómo funciona <ArrowUpRight size={14} /></Link></div>
    <div className="tool-grid">{toolCards.map((tool) => { const Icon = tool.icon; return <Link className="tool-card" href={tool.href} key={tool.href} data-testid={`card-tool-${tool.title}`}><span className="tool-icon"><Icon size={17} /></span><span><h3>{tool.title}</h3><p>{tool.desc}</p></span><span className="arrow"><ChevronRight size={15} /></span></Link>; })}</div>
    <div className="info-strip"><ShieldCheck size={18} /><span><strong>Alcance claro.</strong> Las descargas desde plataformas externas, la generación de imágenes y cualquier conclusión forense requieren servicios o modelos que esta versión local no conecta.</span></div>
    <div className="section-heading"><div><h2>Tu pulso local</h2><p>Una vista rápida de lo que ya procesaste.</p></div><Link href="/historial" className="btn btn-ghost" data-testid="link-home-history">Ver historial <ArrowUpRight size={14} /></Link></div>
    <div className="metrics"><div className="metric-card"><div className="metric-label">Informes guardados</div><div className="metric-value">{history.length}</div><div className="metric-note">persistidos en este navegador</div></div><div className="metric-card"><div className="metric-label">Último procesamiento</div><div className="metric-value" style={{ fontSize: 17 }}>{history[0]?.date || 'aún no hay datos'}</div><div className="metric-note">sin actividad en red</div></div><div className="metric-card"><div className="metric-label">Archivos en sesión</div><div className="metric-value">{history.filter((item) => item.status === 'Completado').length}</div><div className="metric-note">resultados descriptivos</div></div></div>
  </Page>;
}

function Page({ children }: { children: ReactNode }) { return <div className="content">{children}</div>; }

function LocalFileTool({ path }: { path: string }) {
  const config = toolConfig[path];
  const Icon = config.icon;
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [hash, setHash] = useState('');
  const [report, setReport] = useState('');
  const [state, setState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [dragging, setDragging] = useState(false);
  const [extra, setExtra] = useState('');
  const { toasts, notify, remove } = useToasts();
  const selectFile = async (selected: File | undefined) => {
    if (!selected) return;
    setFile(selected); setState('loading'); setReport(''); setExtra('');
    try {
      const newHash = await hashFile(selected);
      let details = '';
      if (path === '/analizador-texto' || path === '/analizador-codigo') {
        const text = await selected.text();
        const lines = text.split(/\r?\n/);
        const words = text.trim() ? text.trim().split(/\s+/).length : 0;
        const blank = lines.filter((line) => !line.trim()).length;
        const comments = lines.filter((line) => /^\s*(\/\/|#|\/\*|\*|<!--)/.test(line)).length;
        details = `\nLíneas: ${lines.length}\nPalabras: ${words}\nCaracteres: ${text.length}\nLíneas vacías: ${blank}${path === '/analizador-codigo' ? `\nLíneas con comentario: ${comments}\nDensidad de comentario: ${lines.length ? ((comments / lines.length) * 100).toFixed(1) : '0.0'}%` : ''}`;
      } else if (path === '/analizador-video') {
        details = '\nLa duración y resolución pueden consultarse desde la vista previa del navegador.';
      } else if (path === '/analizador-imagenes') {
        details = '\nLos metadatos EXIF no se interpretan automáticamente en esta versión local.';
      } else {
        details = '\nLa información avanzada del códec depende del contenedor y de lo que exponga el navegador.';
      }
      setHash(newHash); setExtra(details); setReport(makeReport(selected, path, newHash, details)); setState('success');
      const item: HistoryItem = { id: crypto.randomUUID?.() || String(Date.now()), name: selected.name, tool: config.title, size: formatBytes(selected.size), date: new Date().toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }), status: 'Completado', hash: newHash, report: makeReport(selected, path, newHash, details) };
      const next = [item, ...readHistory()].slice(0, 40); localStorage.setItem('lc-history', JSON.stringify(next));
      window.dispatchEvent(new Event('lc-history-updated'));
      notify('Archivo procesado localmente. El informe ya está disponible.', 'ok');
    } catch (error) {
      setState('error'); notify(error instanceof Error ? error.message : 'No se pudo leer el archivo.', 'error');
    }
  };
  const onChange = (event: ChangeEvent<HTMLInputElement>) => void selectFile(event.target.files?.[0]);
  const onDrop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setDragging(false); void selectFile(event.dataTransfer.files?.[0]); };
  const copyHash = async () => { if (!hash) return; await navigator.clipboard?.writeText(hash); notify('Hash SHA-256 copiado al portapapeles.', 'ok'); };
  const exportReport = () => { if (file && report) { downloadBlob(new Blob([report], { type: 'text/plain;charset=utf-8' }), `lc-informe-${file.name}.txt`); notify('Informe exportado como archivo de texto.', 'ok'); } };
  return <Page>
    <div className="eyebrow">{config.eyebrow}</div><h1 className="page-title">{config.title}</h1><p className="page-lead">{config.description}</p>
    <div className="tool-layout">
      <section className="panel">
        <h2>Entrada local</h2><p className="panel-sub">Suelta un archivo o selecciónalo. El procesamiento ocurre en esta pestaña.</p>
        <div className={`dropzone ${dragging ? 'dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop} data-testid="dropzone-file">
          <input ref={inputRef} type="file" accept={config.accept} onChange={onChange} data-testid="input-file" />
          <Upload size={28} /><h3>{file ? 'Archivo listo para revisar' : 'Suelta tu archivo aquí'}</h3><p>{file ? 'Puedes reemplazarlo seleccionando otro archivo.' : `Formatos aceptados según el navegador · ${config.accept}`}</p>
          <button className="btn btn-primary" onClick={() => inputRef.current?.click()} data-testid="button-select-file"><FolderOpen size={15} /> {file ? 'Elegir otro archivo' : 'Seleccionar archivo'}</button>
        </div>
        {file && <div className="file-chip" data-testid="text-selected-file"><Icon size={20} /><div><strong>{file.name}</strong><span>{formatBytes(file.size)} · {file.type || 'tipo no declarado'}</span></div><CheckCircle2 size={16} style={{ marginLeft: 'auto', color: 'hsl(var(--mint-deep))' }} /></div>}
        {state === 'loading' && <div className="process-box loading" role="status" data-testid="status-processing">Calculando hash y leyendo señales del archivo…<div className="progress-track"><div className="progress-fill" /></div></div>}
        {state === 'error' && <div className="process-box error" role="alert" data-testid="status-error">No pudimos procesar este archivo. Comprueba el formato e inténtalo otra vez.</div>}
        {state === 'success' && <div className="process-box" role="status" data-testid="status-success"><strong>Lectura completada.</strong> No se realizó ninguna subida.</div>}
      </section>
      <aside className="panel">
        <h2>Qué vamos a comprobar</h2><p className="panel-sub">Señales descriptivas, no una sentencia sobre el origen o autenticidad del archivo.</p>
        <div className="check-list">{config.checks.map((check) => <div className="check-item" key={check}><Check size={15} />{check}</div>)}</div>
        {file && state === 'success' && <><div className="metadata"><div className="meta-item"><span>Extensión</span><strong>{getExtension(file.name)}</strong></div><div className="meta-item"><span>Tamaño</span><strong>{formatBytes(file.size)}</strong></div><div className="meta-item"><span>Tipo MIME</span><strong>{file.type || 'n/d'}</strong></div><div className="meta-item"><span>Resultado</span><strong style={{ color: 'hsl(var(--mint-deep))' }}>LOCAL</strong></div></div><div className="button-row"><button className="btn btn-secondary" onClick={copyHash} data-testid="button-copy-hash"><Copy size={14} /> Copiar hash</button><button className="btn btn-primary" onClick={exportReport} data-testid="button-export-report"><Download size={14} /> Exportar informe</button></div></>}
      </aside>
    </div>
    {report && <section className="panel" style={{ marginTop: 18 }}><div className="section-heading" style={{ margin: 0 }}><div><h2>Informe listo</h2><p>Guárdalo para documentar qué leyó el navegador.</p></div><span className="badge">SHA-256 calculado</span></div><pre className="report" data-testid="text-report">{report}</pre><div className="button-row"><button className="btn btn-ghost" onClick={copyHash} data-testid="button-copy-hash-bottom"><Clipboard size={14} /> {hash.slice(0, 18)}…</button></div></section>}
    <ToastStack toasts={toasts} remove={remove} />
  </Page>;
}

function ExternalTool({ type }: { type: 'video' | 'music' | 'tiktok' | 'generator' }) {
  const details = {
    video: { title: 'Descargar video', eyebrow: 'Servicio externo / video', icon: Download, text: 'No conectamos con plataformas protegidas ni extraemos contenido de terceros. Puedes trabajar con un archivo que ya tengas en tu dispositivo.', bullets: ['Pega una URL solo para identificar el servicio, no para descargar.', 'El navegador no recibe ni guarda la URL en un servidor.', 'Usa el analizador local cuando tengas el archivo con permiso.'] },
    music: { title: 'Descargar música', eyebrow: 'Servicio externo / audio', icon: Music2, text: 'La descarga desde servicios externos no está disponible en esta estación local. Evitamos presentar un botón que prometa algo que no puede hacer.', bullets: ['No se simulan enlaces de descarga.', 'No se accede a catálogos ni cuentas de terceros.', 'Los archivos propios sí pueden analizarse localmente.'] },
    tiktok: { title: 'TikTok', eyebrow: 'Servicio externo / plataforma', icon: PlaySquare, text: 'Este módulo documenta el límite: no descarga, no elimina marcas de agua y no consulta perfiles externos.', bullets: ['Sin scraping de perfiles o publicaciones.', 'Sin almacenamiento de URLs externas.', 'Puedes analizar un video local autorizado.'] },
    generator: { title: 'Generador de imágenes', eyebrow: 'Modelo externo / creación', icon: Sparkles, text: 'La generación de imágenes necesita un modelo o servicio externo. Esta versión no inventa una imagen ni finge que la ha generado.', bullets: ['No se realiza ninguna llamada a una API de IA.', 'Puedes preparar un prompt y copiarlo para usarlo en tu herramienta.', 'La salida debe revisarse y atribuirse fuera de LC Systems.'] },
  }[type];
  const [input, setInput] = useState('');
  const [copied, setCopied] = useState(false);
  const Icon = details.icon;
  const copy = async () => { await navigator.clipboard?.writeText(input || 'LC Systems: flujo externo no disponible en modo local.'); setCopied(true); window.setTimeout(() => setCopied(false), 1800); };
  return <Page><div className="eyebrow">{details.eyebrow}</div><h1 className="page-title">{details.title}</h1><p className="page-lead">{details.text}</p><div className="tool-layout"><section className="panel"><div className="dropzone" style={{ minHeight: 230, borderStyle: 'solid', borderColor: 'hsl(var(--yellow) / .7)', background: 'hsl(var(--yellow) / .14)' }}><Icon size={30} color="hsl(var(--signal-deep))" /><h3>Función bloqueada con transparencia</h3><p>El módulo está presente para explicar el alcance real del producto, no para simular una integración.</p><span className="badge" style={{ marginTop: 15 }}>SERVICIO NO CONECTADO</span></div><label className="input-label" htmlFor="external-note">{type === 'generator' ? 'Prompt de trabajo (opcional)' : 'Referencia local (opcional)'}</label><input id="external-note" className="input" value={input} onChange={(event) => setInput(event.target.value)} placeholder={type === 'generator' ? 'Describe lo que quieres crear…' : 'Pega una URL o nota para tu registro…'} data-testid="input-external-reference" /><div className="button-row"><button className="btn btn-secondary" onClick={copy} data-testid="button-copy-reference"><Copy size={14} /> {copied ? 'Copiado' : 'Copiar referencia'}</button><Link href={type === 'generator' ? '/ayuda' : '/analizador-video'} className="btn btn-primary" data-testid="link-external-alternative">{type === 'generator' ? 'Ver límites' : 'Analizar archivo local'} <ArrowUpRight size={14} /></Link></div></section><aside className="panel"><h2>Por qué</h2><div className="check-list">{details.bullets.map((bullet) => <div className="check-item" key={bullet}><ShieldCheck size={15} />{bullet}</div>)}</div><div className="process-box" style={{ marginTop: 24 }}>Estado: <strong>capacidad no disponible</strong><br />No hay llamada de red, descarga ni resultado oculto.</div></aside></div></Page>;
}

function Converter() {
  const [format, setFormat] = useState('MP4'); const [file, setFile] = useState<File | null>(null); const [message, setMessage] = useState('');
  return <Page><div className="eyebrow">Flujo local / preparación</div><h1 className="page-title">Convertidor</h1><p className="page-lead">Prepara un archivo para una herramienta compatible. La conversión multimedia completa depende de códecs que el navegador no siempre incorpora.</p><div className="tool-layout"><section className="panel"><h2>Preparar archivo</h2><p className="panel-sub">Selecciona el formato de destino para comprobar compatibilidad antes de exportar.</p><label className="input-label" htmlFor="converter-file">Archivo de origen</label><input id="converter-file" className="input" type="file" onChange={(event) => setFile(event.target.files?.[0] || null)} data-testid="input-converter-file" /><label className="input-label" htmlFor="converter-format">Formato de destino</label><select id="converter-format" className="select" value={format} onChange={(event) => setFormat(event.target.value)} data-testid="select-converter-format"><option>MP4</option><option>MP3</option><option>WAV</option><option>WEBM</option><option>PNG</option></select><button className="btn btn-primary" style={{ marginTop: 18 }} disabled={!file} onClick={() => setMessage(`El navegador preparó la solicitud para ${format}, pero no tiene un códec local seguro para convertir este archivo.`)} data-testid="button-start-conversion"><Zap size={14} /> Comprobar conversión</button>{message && <div className="process-box" role="status" style={{ marginTop: 17 }} data-testid="status-converter">{message}</div>}</section><aside className="panel"><h2>Compatibilidad honesta</h2><div className="check-list"><div className="check-item"><Gauge size={15} />La vista previa y lectura dependen del navegador.</div><div className="check-item"><FileArchive size={15} />No se genera un archivo roto con una extensión distinta.</div><div className="check-item"><ShieldCheck size={15} />El archivo original nunca sale de tu dispositivo.</div></div></aside></div></Page>;
}

function HistoryPage() {
  const [items, setItems] = useState(readHistory); const { toasts, notify, remove } = useToasts();
  useEffect(() => { const update = () => setItems(readHistory()); window.addEventListener('lc-history-updated', update); return () => window.removeEventListener('lc-history-updated', update); }, []);
  const clear = () => { localStorage.removeItem('lc-history'); setItems([]); notify('Historial local eliminado.', 'ok'); };
  const exportAll = () => { const payload = JSON.stringify(items, null, 2); downloadBlob(new Blob([payload], { type: 'application/json' }), 'lc-historial.json'); notify('Historial exportado como JSON.', 'ok'); };
  const exportZip = () => {
    const entries = [{ name: 'lc-manifest.json', data: JSON.stringify({ exportedAt: new Date().toISOString(), count: items.length, items }, null, 2) }];
    items.forEach((item, index) => { if (item.report) entries.push({ name: `informes/${String(index + 1).padStart(2, '0')}-${item.name.replace(/[^a-z0-9._-]/gi, '_')}.txt`, data: item.report }); });
    downloadBlob(new Blob([makeZip(entries)], { type: 'application/zip' }), 'lc-systems-informes.zip');
    notify('ZIP creado con el manifiesto y los informes disponibles.', 'ok');
  };
  return <Page><div className="eyebrow">Registro local / trazabilidad</div><h1 className="page-title">Historial</h1><p className="page-lead">Informes creados en este navegador. No es una nube ni una base de datos: puedes eliminarlo cuando quieras.</p><div className="button-row"><button className="btn btn-secondary" onClick={exportAll} disabled={!items.length} data-testid="button-export-history"><Download size={14} /> Exportar JSON</button><button className="btn btn-secondary" onClick={exportZip} disabled={!items.length} data-testid="button-export-zip"><FileArchive size={14} /> Exportar ZIP</button><button className="btn btn-ghost" onClick={clear} disabled={!items.length} data-testid="button-clear-history"><Trash2 size={14} /> Limpiar historial</button></div><div className="table-wrap">{items.length ? <table className="table"><thead><tr><th>Archivo</th><th>Herramienta</th><th>Tamaño</th><th>Fecha</th><th>Estado</th><th>Acción</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><strong>{item.name}</strong><div className="mono" style={{ color: 'hsl(var(--muted))', fontSize: 10 }}>{item.hash?.slice(0, 18)}…</div></td><td>{item.tool}</td><td>{item.size}</td><td>{item.date}</td><td><span className="badge">{item.status}</span></td><td><button className="icon-btn" title="Descargar informe" aria-label={`Descargar informe de ${item.name}`} onClick={() => { if (item.report) downloadBlob(new Blob([item.report], { type: 'text/plain' }), `lc-${item.name}.txt`); notify('Informe descargado.', 'ok'); }} data-testid={`button-download-history-${item.id}`}><Download size={14} /></button></td></tr>)}</tbody></table> : <div className="empty"><History size={24} /><h3>Tu historial está despejado</h3><p>Procesa un archivo local y aquí aparecerá su informe, hash y fecha.</p><Link href="/analizador-imagenes" className="btn btn-primary" style={{ marginTop: 17 }} data-testid="link-empty-history">Analizar un archivo</Link></div>}</div><ToastStack toasts={toasts} remove={remove} /></Page>;
}

function Gallery() {
  const [items] = useState(readHistory);
  return <Page><div className="eyebrow">Resultados locales / vistazo</div><h1 className="page-title">Galería</h1><p className="page-lead">Una vista compacta de los archivos que ya pasaron por una herramienta. Los originales no se duplican dentro de LC Systems.</p>{items.length ? <div className="tool-grid" style={{ marginTop: 27 }}>{items.map((item, index) => <div className="tool-card" key={item.id} data-testid={`card-gallery-${item.id}`}><div className="tool-icon">{item.tool.includes('imagen') ? <ImageIcon size={17} /> : item.tool.includes('audio') ? <AudioLines size={17} /> : <FileText size={17} />}</div><div><h3>{item.name}</h3><p>{item.tool} · {item.size}</p></div><span className="badge" style={{ alignSelf: 'flex-start', marginTop: 12 }}>{index === 0 ? 'último' : 'guardado'}</span></div>)}</div> : <div className="empty" style={{ marginTop: 27 }}><Grid2X2 size={24} /><h3>Aún no hay piezas en tu galería</h3><p>Los resultados aparecen después de procesar un archivo local.</p><Link href="/analizador-imagenes" className="btn btn-primary" style={{ marginTop: 17 }} data-testid="link-empty-gallery">Abrir analizador</Link></div>}</Page>;
}

function SettingsPage() {
  const [autoSave, setAutoSave] = useState(() => localStorage.getItem('lc-autosave') !== 'false'); const [compact, setCompact] = useState(() => localStorage.getItem('lc-compact') === 'true'); const { notify, toasts, remove } = useToasts();
  const toggle = (key: string, value: boolean, setter: (value: boolean) => void) => { setter(!value); localStorage.setItem(key, String(!value)); notify(!value ? 'Preferencia activada.' : 'Preferencia desactivada.', 'ok'); };
  return <Page><div className="eyebrow">Preferencias / dispositivo</div><h1 className="page-title">Configuración</h1><p className="page-lead">Controla cómo este navegador conserva tus rastros de trabajo. No hay cuenta ni sincronización.</p><div className="settings-grid"><div className="setting-card"><div className="toggle"><div><h3>Guardar historial local</h3><p>Conserva informes y hashes en localStorage para volver a encontrarlos.</p></div><button className={`toggle-switch ${autoSave ? 'on' : ''}`} onClick={() => toggle('lc-autosave', autoSave, setAutoSave)} aria-label="Alternar historial local" data-testid="button-toggle-autosave"><i /></button></div></div><div className="setting-card"><div className="toggle"><div><h3>Densidad compacta</h3><p>Preferencia reservada para futuras vistas con más información por pantalla.</p></div><button className={`toggle-switch ${compact ? 'on' : ''}`} onClick={() => toggle('lc-compact', compact, setCompact)} aria-label="Alternar densidad compacta" data-testid="button-toggle-compact"><i /></button></div></div><div className="setting-card"><h3>Datos guardados</h3><p>LC Systems no tiene una base de datos. Puedes borrar los registros locales desde el historial.</p><Link href="/historial" className="btn btn-secondary" style={{ marginTop: 16 }} data-testid="link-settings-history">Gestionar historial</Link></div><div className="setting-card"><h3>Entorno</h3><p className="mono">LC SYSTEMS · LOCAL-FIRST<br />capabilities: File API / Web Crypto / localStorage</p></div></div><ToastStack toasts={toasts} remove={remove} /></Page>;
}

function Help() {
  return <Page><div className="eyebrow">Manual breve / alcance</div><h1 className="page-title">Trabaja con señales, no con promesas.</h1><p className="page-lead">LC Systems es una estación de inspección en el navegador. Está diseñada para que sepas qué pasó con tus archivos y, sobre todo, qué no pasó.</p><div className="help-grid"><div className="help-card"><ShieldCheck size={19} /><h3>Privacidad por defecto</h3><p>Los archivos se leen con APIs del navegador. No se cargan, sincronizan ni envían a una API oculta.</p></div><div className="help-card"><ScanLine size={19} /><h3>Resultado descriptivo</h3><p>Un hash demuestra que dos bytes coinciden. No demuestra quién creó un archivo ni si una imagen es auténtica.</p></div><div className="help-card"><HardDrive size={19} /><h3>Persistencia ligera</h3><p>El historial vive en localStorage y puede borrarse. Limpiar datos del sitio también lo eliminará.</p></div></div><section className="panel" style={{ marginTop: 20 }}><h2>Qué significa cada estado</h2><div className="check-list"><div className="check-item"><CheckCircle2 size={15} /><strong>Completado:</strong>&nbsp;el navegador pudo leer la señal solicitada.</div><div className="check-item"><Info size={15} /><strong>Limitado:</strong>&nbsp;hay una capacidad que requiere un servicio, códec o modelo externo.</div><div className="check-item"><X size={15} /><strong>Error:</strong>&nbsp;el archivo no pudo abrirse; prueba otro formato o una selección nueva.</div></div></section></Page>;
}

function Router() {
  return <AppShell><Switch>
    <Route path="/" component={Home} />
    <Route path="/descargar-video"><ExternalTool type="video" /></Route>
    <Route path="/descargar-musica"><ExternalTool type="music" /></Route>
    <Route path="/tiktok"><ExternalTool type="tiktok" /></Route>
    <Route path="/generador-imagenes"><ExternalTool type="generator" /></Route>
    <Route path="/convertidor" component={Converter} />
    <Route path="/galeria" component={Gallery} />
    <Route path="/historial" component={HistoryPage} />
    <Route path="/configuracion" component={SettingsPage} />
    <Route path="/ayuda" component={Help} />
    {Object.keys(toolConfig).map((path) => <Route key={path} path={path}><LocalFileTool path={path} /></Route>)}
    <Route component={NotFound} />
  </Switch></AppShell>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><ErrorBoundary><Router /></ErrorBoundary></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;