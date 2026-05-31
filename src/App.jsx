import { useState, useEffect, useMemo } from "react";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const FONT = "'Inter', -apple-system, sans-serif";
const FONT_DISPLAY = "'Geely', 'Inter', -apple-system, sans-serif";

const ACCOUNTS = ["Todas", "Geely", "Preunic", "Tanner", "Aerosan"];

const ACCOUNT_COLORS = {
  Geely: "#818cf8",
  Preunic: "#34d399",
  Tanner: "#f59e0b",
  Aerosan: "#f87171",
};

const TEAM = [
  { id: "sebastian", name: "Sebastián Rivera", role: "Dir. Creativo", accounts: ["Geely", "Preunic", "Tanner", "Aerosan"], basecampNames: ["Sebastian R.", "Sebastián R.", "Sebastian Rivera"] },
  { id: "victor_g", name: "Victor Galán", role: "Dir. de Arte", accounts: ["Geely"], basecampNames: ["Victor G.", "Victor Galán", "Víctor Galán"] },
  { id: "victor_gz", name: "Victor González", role: "Dir. de Arte", accounts: ["Geely"], basecampNames: ["Victor Gz.", "Victor González", "Víctor González"] },
  { id: "kevin", name: "Kevin Rodríguez", role: "Productor / DA", accounts: ["Geely"], basecampNames: ["Kevin R.", "Kevin Rodríguez"] },
  { id: "raul", name: "Raúl Díaz", role: "Redactor", accounts: ["Geely", "Tanner"], basecampNames: ["Raul D.", "Raúl D.", "Raul Díaz", "Raúl Díaz"] },
  { id: "lorena", name: "Lorena Escudero", role: "Dir. de Arte", accounts: ["Preunic"], basecampNames: ["Lore E.", "Lorena E.", "Lorena Escudero"] },
  { id: "rodrigo", name: "Rodrigo Salinas", role: "Redactor", accounts: ["Preunic"], basecampNames: ["Rodrigo S.", "Rodrigo Salinas"] },
  { id: "billy", name: "Billy Escalona", role: "Editor de Video", accounts: ["Preunic"], basecampNames: ["Billy E.", "Billy Escalona"] },
  { id: "abner", name: "Abner Piña", role: "Dir. de Arte", accounts: ["Tanner", "Aerosan"], basecampNames: ["Abner P.", "Abner Piña"] },
  { id: "nicolas", name: "Nicolás Trazar", role: "Redactor", accounts: ["Aerosan"], basecampNames: ["Nicolas T.", "Nicolás T.", "Nicolas Trazar"] },
  { id: "marcelo", name: "Marcelo Rivas", role: "Redactor", accounts: ["Aerosan"], basecampNames: ["Marcelo R.", "Marcelo Rivas"] },
];

const ROLES = ["Dir. Creativo", "Dir. de Arte", "Productor / DA", "Redactor", "Editor de Video"];

const BENCHMARKS = {
  "Dir. Creativo":    { weekly: 3, monthly: 12, quality: 95 },
  "Dir. de Arte":     { weekly: 5, monthly: 20, quality: 90 },
  "Productor / DA":   { weekly: 6, monthly: 24, quality: 88 },
  "Redactor":         { weekly: 6, monthly: 24, quality: 88 },
  "Editor de Video":  { weekly: 4, monthly: 16, quality: 85 },
};

const VIEWS = ["overview", "kanban", "equipo", "proyectos", "benchmarks"];
const VIEW_LABELS = { overview: "Overview", kanban: "Kanban", equipo: "Equipo", proyectos: "Proyectos", benchmarks: "Benchmarks" };

const STATUSES = ["Por hacer", "En progreso", "En revisión", "Completado"];
const PRIORITIES = ["Alta", "Media", "Baja"];

// ─── SUPABASE ────────────────────────────────────────────────────────────────
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

async function sbFetch(path, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" },
    ...options,
  });
  if (!res.ok) return null;
  return res.json();
}

// ─── BASECAMP ────────────────────────────────────────────────────────────────
const BC_CLIENT_ID = import.meta.env.VITE_BASECAMP_CLIENT_ID || "";
const BC_REDIRECT = import.meta.env.VITE_BASECAMP_REDIRECT_URI || window.location.origin;

function resolveBasecampPerson(bcName) {
  if (!bcName) return null;
  const lower = bcName.toLowerCase();
  for (const member of TEAM) {
    for (const alias of member.basecampNames) {
      if (alias.toLowerCase() === lower) return member.id;
    }
  }
  // fuzzy: match by first name
  for (const member of TEAM) {
    const firstName = member.name.split(" ")[0].toLowerCase();
    if (lower.includes(firstName)) return member.id;
  }
  return null;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 9);

const today = new Date();
const fmtDate = (d) => d ? new Date(d).toLocaleDateString("es-CL", { day: "2-digit", month: "short" }) : "—";

function getMemberById(id) { return TEAM.find(m => m.id === id); }

// ─── MOCK TASKS (clean start) ─────────────────────────────────────────────────
const INITIAL_TASKS = [
  { id: uid(), title: "Campaña lanzamiento eléctrico", assigneeId: "victor_g", account: "Geely", status: "En progreso", priority: "Alta", dueDate: "2026-06-10", completedAt: null },
  { id: uid(), title: "Copy redes sociales junio", assigneeId: "raul", account: "Geely", status: "Por hacer", priority: "Media", dueDate: "2026-06-05", completedAt: null },
  { id: uid(), title: "Key visual verano", assigneeId: "lorena", account: "Preunic", status: "En revisión", priority: "Alta", dueDate: "2026-06-08", completedAt: null },
  { id: uid(), title: "Edición video testimonial", assigneeId: "billy", account: "Preunic", status: "En progreso", priority: "Media", dueDate: "2026-06-12", completedAt: null },
  { id: uid(), title: "Brief campaña Tanner Q3", assigneeId: "sebastian", account: "Tanner", status: "Por hacer", priority: "Alta", dueDate: "2026-06-15", completedAt: null },
  { id: uid(), title: "Concepto campaña Aerosan", assigneeId: "abner", account: "Aerosan", status: "Por hacer", priority: "Media", dueDate: "2026-06-20", completedAt: null },
];

// ─── COLORS & STYLES ─────────────────────────────────────────────────────────
const C = {
  bg: "#0a0b14",
  surface: "#111320",
  surfaceHover: "#161929",
  border: "#1e2235",
  text: "#e2e8f0",
  textMuted: "#64748b",
  textDim: "#94a3b8",
  accent: "#818cf8",
  accentDim: "#4f5a9e",
};

const statusColors = {
  "Por hacer":  { bg: "#1e2235", text: "#64748b" },
  "En progreso": { bg: "#1a2744", text: "#60a5fa" },
  "En revisión": { bg: "#2a1f44", text: "#a78bfa" },
  "Completado":  { bg: "#0f2d20", text: "#34d399" },
};

const priorityColors = {
  Alta:  "#f87171",
  Media: "#f59e0b",
  Baja:  "#64748b",
};

// ─── RING COMPONENT ──────────────────────────────────────────────────────────
function Ring({ pct, color, size = 80, stroke = 7, label }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={C.border} strokeWidth={stroke}/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"/>
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: size > 70 ? 17 : 13, fontWeight: 800, color: C.text, fontFamily: FONT_DISPLAY }}>
          {label || `${pct}%`}
        </span>
      </div>
    </div>
  );
}

// ─── AVATAR ──────────────────────────────────────────────────────────────────
function Avatar({ member, size = 32 }) {
  if (!member) return <div style={{ width: size, height: size, borderRadius: "50%", background: C.border }}/>;
  const initials = member.name.split(" ").map(w => w[0]).slice(0, 2).join("");
  const hue = member.id.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: `hsl(${hue}, 55%, 30%)`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.35, fontWeight: 700, color: `hsl(${hue}, 80%, 75%)`, flexShrink: 0 }}>
      {initials}
    </div>
  );
}

// ─── ACCOUNT BADGE ───────────────────────────────────────────────────────────
function AccountBadge({ account, small }) {
  const color = ACCOUNT_COLORS[account] || C.textMuted;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: small ? 10 : 11,
      fontWeight: 600, color, background: `${color}18`, border: `1px solid ${color}30`,
      borderRadius: 4, padding: small ? "1px 5px" : "2px 7px" }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: color, display: "inline-block" }}/>
      {account}
    </span>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [view, setView] = useState("overview");
  const [tasks, setTasks] = useState(INITIAL_TASKS);
  const [activeAccount, setActiveAccount] = useState("Todas");
  const [showCompleted, setShowCompleted] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [bcToken, setBcToken] = useState(localStorage.getItem("bc_token") || "");
  const [modal, setModal] = useState(null); // { type: "task", data? }

  // Load from Supabase on mount
  useEffect(() => {
    sbFetch("/tasks?select=*&order=created_at.desc").then(data => {
      if (data && data.length > 0) setTasks(data);
    });
  }, []);

  // Basecamp OAuth callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (code && !bcToken) {
      // In a real setup, exchange code for token via backend
      localStorage.setItem("bc_token", code);
      setBcToken(code);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  // Filtered tasks
  const filteredTasks = useMemo(() => {
    let t = tasks;
    if (activeAccount !== "Todas") t = t.filter(tk => tk.account === activeAccount);
    if (!showCompleted) t = t.filter(tk => tk.status !== "Completado");
    return t;
  }, [tasks, activeAccount, showCompleted]);

  // ── CRUD ──
  async function addTask(data) {
    const task = { id: uid(), completedAt: null, ...data };
    const updated = [task, ...tasks];
    setTasks(updated);
    await sbFetch("/tasks", { method: "POST", body: JSON.stringify(task) });
  }

  async function updateTask(id, patch) {
    if (patch.status === "Completado" && !patch.completedAt) patch.completedAt = new Date().toISOString();
    const updated = tasks.map(t => t.id === id ? { ...t, ...patch } : t);
    setTasks(updated);
    await sbFetch(`/tasks?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  }

  async function deleteTask(id) {
    setTasks(tasks.filter(t => t.id !== id));
    await sbFetch(`/tasks?id=eq.${id}`, { method: "DELETE" });
  }

  // ── STATS ──
  const stats = useMemo(() => {
    const total = filteredTasks.length;
    const done = filteredTasks.filter(t => t.status === "Completado").length;
    const inProgress = filteredTasks.filter(t => t.status === "En progreso").length;
    const review = filteredTasks.filter(t => t.status === "En revisión").length;
    const overdue = filteredTasks.filter(t => t.dueDate && new Date(t.dueDate) < today && t.status !== "Completado").length;
    return { total, done, inProgress, review, overdue, pct: total ? Math.round((done / total) * 100) : 0 };
  }, [filteredTasks]);

  // ─── RENDER ──────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", height: "100vh", background: C.bg, color: C.text, fontFamily: FONT, overflow: "hidden" }}>
      <Sidebar view={view} setView={setView} sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen}
        activeAccount={activeAccount} setActiveAccount={setActiveAccount}
        showCompleted={showCompleted} setShowCompleted={setShowCompleted}
        stats={stats} tasks={filteredTasks}/>
      <main style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>
        <TopBar view={view} activeAccount={activeAccount} setActiveAccount={setActiveAccount}
          showCompleted={showCompleted} setShowCompleted={setShowCompleted}
          onAddTask={() => setModal({ type: "task" })} bcToken={bcToken} setBcToken={setBcToken}/>
        <div style={{ flex: 1, padding: "24px 28px" }}>
          {view === "overview"   && <OverviewView tasks={filteredTasks} stats={stats} setModal={setModal} updateTask={updateTask}/>}
          {view === "kanban"     && <KanbanView tasks={filteredTasks} updateTask={updateTask} deleteTask={deleteTask} setModal={setModal}/>}
          {view === "equipo"     && <EquipoView tasks={filteredTasks} activeAccount={activeAccount}/>}
          {view === "proyectos"  && <ProyectosView tasks={filteredTasks} updateTask={updateTask} deleteTask={deleteTask}/>}
          {view === "benchmarks" && <BenchmarksView tasks={filteredTasks}/>}
        </div>
      </main>
      {modal?.type === "task" && (
        <TaskModal task={modal.data} onSave={data => { modal.data ? updateTask(modal.data.id, data) : addTask(data); setModal(null); }}
          onClose={() => setModal(null)} onDelete={modal.data ? () => { deleteTask(modal.data.id); setModal(null); } : null}
          activeAccount={activeAccount}/>
      )}
    </div>
  );
}

// ─── SIDEBAR ─────────────────────────────────────────────────────────────────
function Sidebar({ view, setView, sidebarOpen, setSidebarOpen, activeAccount, setActiveAccount, showCompleted, setShowCompleted, stats, tasks }) {
  if (!sidebarOpen) return (
    <div style={{ width: 48, background: C.surface, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", alignItems: "center", padding: "16px 0", gap: 8 }}>
      <button onClick={() => setSidebarOpen(true)} style={{ background: "none", border: "none", color: C.textMuted, cursor: "pointer", padding: 8 }}>☰</button>
      {VIEWS.map(v => (
        <button key={v} onClick={() => setView(v)} title={VIEW_LABELS[v]}
          style={{ background: view === v ? C.accentDim : "none", border: "none", color: view === v ? "#fff" : C.textMuted,
            cursor: "pointer", width: 32, height: 32, borderRadius: 8, fontSize: 14 }}>
          {VIEW_ICONS[v]}
        </button>
      ))}
    </div>
  );

  return (
    <div style={{ width: 220, background: C.surface, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", flexShrink: 0 }}>
      {/* Logo */}
      <div style={{ padding: "20px 16px 16px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.text, fontFamily: FONT_DISPLAY, letterSpacing: -0.3 }}>Team Panel</div>
            <div style={{ fontSize: 10, color: C.accent, fontWeight: 600, marginTop: 1 }}>4 cuentas · 11 personas</div>
          </div>
          <button onClick={() => setSidebarOpen(false)} style={{ background: "none", border: "none", color: C.textMuted, cursor: "pointer", fontSize: 16 }}>‹</button>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ padding: "12px 8px", flex: 1, overflow: "auto" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: C.textMuted, padding: "0 8px", marginBottom: 6, letterSpacing: 1 }}>VISTAS</div>
        {VIEWS.map(v => (
          <button key={v} onClick={() => setView(v)}
            style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 10px",
              background: view === v ? `${C.accent}18` : "none", border: "none",
              color: view === v ? C.accent : C.textDim, cursor: "pointer", borderRadius: 8,
              fontSize: 13, fontWeight: view === v ? 600 : 400, textAlign: "left", marginBottom: 2 }}>
            <span style={{ fontSize: 15 }}>{VIEW_ICONS[v]}</span>
            {VIEW_LABELS[v]}
            {v === "overview" && stats.overdue > 0 && (
              <span style={{ marginLeft: "auto", background: "#f87171", color: "#fff", borderRadius: 10, fontSize: 10, fontWeight: 700, padding: "1px 6px" }}>{stats.overdue}</span>
            )}
          </button>
        ))}

        {/* Accounts */}
        <div style={{ fontSize: 10, fontWeight: 700, color: C.textMuted, padding: "16px 8px 6px", letterSpacing: 1 }}>CUENTAS</div>
        {ACCOUNTS.map(acc => {
          const count = acc === "Todas" ? tasks.length : tasks.filter(t => t.account === acc).length;
          const color = ACCOUNT_COLORS[acc] || C.accent;
          const active = activeAccount === acc;
          return (
            <button key={acc} onClick={() => setActiveAccount(acc)}
              style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 10px",
                background: active ? `${color}18` : "none", border: "none",
                color: active ? color : C.textDim, cursor: "pointer", borderRadius: 8,
                fontSize: 12, fontWeight: active ? 700 : 400, textAlign: "left", marginBottom: 1 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: active ? color : C.border, flexShrink: 0 }}/>
              {acc}
              <span style={{ marginLeft: "auto", fontSize: 11, color: active ? color : C.textMuted }}>{count}</span>
            </button>
          );
        })}

        {/* Toggle completadas */}
        <div style={{ padding: "16px 8px 0" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12, color: C.textDim }}>
            <div onClick={() => setShowCompleted(!showCompleted)}
              style={{ width: 32, height: 18, borderRadius: 9, background: showCompleted ? C.accent : C.border,
                position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
              <div style={{ position: "absolute", top: 2, left: showCompleted ? 16 : 2, width: 14, height: 14,
                borderRadius: "50%", background: "#fff", transition: "left 0.2s" }}/>
            </div>
            Mostrar completadas
          </label>
        </div>
      </nav>

      {/* Bottom stats */}
      <div style={{ padding: "12px 16px", borderTop: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 6 }}>Progreso general</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Ring pct={stats.pct} color={C.accent} size={44} stroke={5}/>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, fontFamily: FONT_DISPLAY }}>{stats.done}<span style={{ fontSize: 12, color: C.textMuted }}>/{stats.total}</span></div>
            <div style={{ fontSize: 11, color: C.textMuted }}>completadas</div>
          </div>
        </div>
      </div>
    </div>
  );
}

const VIEW_ICONS = { overview: "◉", kanban: "⊞", equipo: "◎", proyectos: "▦", benchmarks: "▣" };

// ─── TOP BAR ─────────────────────────────────────────────────────────────────
function TopBar({ view, activeAccount, setActiveAccount, showCompleted, setShowCompleted, onAddTask, bcToken, setBcToken }) {
  return (
    <div style={{ padding: "16px 28px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 12, background: C.surface, flexShrink: 0 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 18, fontWeight: 800, fontFamily: FONT_DISPLAY, letterSpacing: -0.5 }}>
          {VIEW_LABELS[view]}
          {activeAccount !== "Todas" && (
            <span style={{ marginLeft: 10, fontSize: 13, fontWeight: 600, color: ACCOUNT_COLORS[activeAccount] }}>· {activeAccount}</span>
          )}
        </div>
      </div>

      {/* Basecamp connect */}
      {!bcToken && BC_CLIENT_ID && (
        <a href={`https://launchpad.37signals.com/authorization/new?type=web_server&client_id=${BC_CLIENT_ID}&redirect_uri=${encodeURIComponent(BC_REDIRECT)}`}
          style={{ fontSize: 12, color: C.textMuted, textDecoration: "none", border: `1px solid ${C.border}`,
            borderRadius: 8, padding: "6px 12px", display: "flex", alignItems: "center", gap: 6 }}>
          <span>⛺</span> Conectar Basecamp
        </a>
      )}
      {bcToken && (
        <div style={{ fontSize: 12, color: "#34d399", border: `1px solid #34d39930`, borderRadius: 8, padding: "6px 12px" }}>
          ✓ Basecamp
        </div>
      )}

      <button onClick={onAddTask}
        style={{ background: C.accent, border: "none", color: "#fff", padding: "8px 16px",
          borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
        + Nueva tarea
      </button>
    </div>
  );
}

// ─── OVERVIEW VIEW ────────────────────────────────────────────────────────────
function OverviewView({ tasks, stats, setModal, updateTask }) {
  const urgent = tasks.filter(t => t.dueDate && new Date(t.dueDate) < today && t.status !== "Completado");
  const inProgress = tasks.filter(t => t.status === "En progreso").slice(0, 6);

  const byAccount = ACCOUNTS.slice(1).map(acc => {
    const at = tasks.filter(t => t.account === acc);
    const done = at.filter(t => t.status === "Completado").length;
    return { acc, total: at.length, done, pct: at.length ? Math.round((done / at.length) * 100) : 0 };
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        {[
          { label: "Total tareas", value: stats.total, color: C.accent },
          { label: "En progreso", value: stats.inProgress, color: "#60a5fa" },
          { label: "En revisión", value: stats.review, color: "#a78bfa" },
          { label: "Vencidas", value: stats.overdue, color: "#f87171" },
        ].map(k => (
          <div key={k.label} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 20px" }}>
            <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 6 }}>{k.label}</div>
            <div style={{ fontSize: 28, fontWeight: 800, fontFamily: FONT_DISPLAY, color: k.color }}>{k.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* By account */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 16 }}>Progreso por cuenta</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {byAccount.map(({ acc, total, done, pct }) => (
              <div key={acc} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Ring pct={pct} color={ACCOUNT_COLORS[acc]} size={44} stroke={5}/>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: ACCOUNT_COLORS[acc] }}>{acc}</span>
                    <span style={{ fontSize: 12, color: C.textMuted }}>{done}/{total}</span>
                  </div>
                  <div style={{ height: 4, background: C.border, borderRadius: 2 }}>
                    <div style={{ height: 4, width: `${pct}%`, background: ACCOUNT_COLORS[acc], borderRadius: 2 }}/>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Urgent */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
            Urgentes / Vencidas
            {urgent.length > 0 && <span style={{ background: "#f87171", color: "#fff", borderRadius: 10, fontSize: 11, padding: "1px 7px" }}>{urgent.length}</span>}
          </div>
          {urgent.length === 0
            ? <div style={{ fontSize: 13, color: C.textMuted }}>Todo al día ✓</div>
            : urgent.map(t => (
              <TaskRow key={t.id} task={t} onClick={() => setModal({ type: "task", data: t })} onStatusChange={s => updateTask(t.id, { status: s })}/>
            ))}
        </div>
      </div>

      {/* In progress */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>En progreso</div>
        {inProgress.length === 0
          ? <div style={{ fontSize: 13, color: C.textMuted }}>Sin tareas en progreso</div>
          : inProgress.map(t => (
            <TaskRow key={t.id} task={t} onClick={() => setModal({ type: "task", data: t })} onStatusChange={s => updateTask(t.id, { status: s })}/>
          ))}
      </div>
    </div>
  );
}

// ─── TASK ROW ─────────────────────────────────────────────────────────────────
function TaskRow({ task, onClick, onStatusChange }) {
  const member = getMemberById(task.assigneeId);
  const overdue = task.dueDate && new Date(task.dueDate) < today && task.status !== "Completado";
  return (
    <div onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
      borderRadius: 8, cursor: "pointer", marginBottom: 4, transition: "background 0.15s" }}
      onMouseEnter={e => e.currentTarget.style.background = C.surfaceHover}
      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
      <select value={task.status} onClick={e => e.stopPropagation()} onChange={e => onStatusChange(e.target.value)}
        style={{ fontSize: 11, fontWeight: 600, color: statusColors[task.status].text,
          background: statusColors[task.status].bg, border: "none", borderRadius: 6, padding: "3px 6px", cursor: "pointer" }}>
        {STATUSES.map(s => <option key={s}>{s}</option>)}
      </select>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: task.status === "Completado" ? C.textMuted : C.text,
          textDecoration: task.status === "Completado" ? "line-through" : "none",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {task.title}
        </div>
      </div>
      <AccountBadge account={task.account} small/>
      <Avatar member={member} size={24}/>
      <span style={{ fontSize: 11, color: overdue ? "#f87171" : C.textMuted, flexShrink: 0 }}>{fmtDate(task.dueDate)}</span>
    </div>
  );
}

// ─── KANBAN VIEW ──────────────────────────────────────────────────────────────
function KanbanView({ tasks, updateTask, deleteTask, setModal }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, height: "100%", alignItems: "start" }}>
      {STATUSES.map(status => {
        const col = tasks.filter(t => t.status === status);
        return (
          <div key={status} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.border}`,
              display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: statusColors[status].text }}/>
                <span style={{ fontSize: 12, fontWeight: 700, color: statusColors[status].text }}>{status}</span>
              </div>
              <span style={{ fontSize: 12, color: C.textMuted, background: C.border, borderRadius: 10, padding: "1px 7px" }}>{col.length}</span>
            </div>
            <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              {col.map(t => <KanbanCard key={t.id} task={t} updateTask={updateTask} onClick={() => setModal({ type: "task", data: t })}/>)}
              {col.length === 0 && <div style={{ fontSize: 12, color: C.textMuted, padding: "8px 6px" }}>Sin tareas</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function KanbanCard({ task, updateTask, onClick }) {
  const member = getMemberById(task.assigneeId);
  const overdue = task.dueDate && new Date(task.dueDate) < today && task.status !== "Completado";
  return (
    <div onClick={onClick}
      style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, cursor: "pointer" }}
      onMouseEnter={e => e.currentTarget.style.borderColor = C.accent}
      onMouseLeave={e => e.currentTarget.style.borderColor = C.border}>
      <div style={{ fontSize: 13, marginBottom: 8, lineHeight: 1.4 }}>{task.title}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <AccountBadge account={task.account} small/>
        <span style={{ fontSize: 10, fontWeight: 600, color: priorityColors[task.priority] }}>{task.priority}</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          {task.dueDate && <span style={{ fontSize: 10, color: overdue ? "#f87171" : C.textMuted }}>{fmtDate(task.dueDate)}</span>}
          <Avatar member={member} size={22}/>
        </div>
      </div>
    </div>
  );
}

// ─── EQUIPO VIEW ──────────────────────────────────────────────────────────────
function EquipoView({ tasks, activeAccount }) {
  const members = activeAccount === "Todas" ? TEAM : TEAM.filter(m => m.accounts.includes(activeAccount));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
        {members.map(member => {
          const memberTasks = tasks.filter(t => t.assigneeId === member.id);
          const done = memberTasks.filter(t => t.status === "Completado").length;
          const inProg = memberTasks.filter(t => t.status === "En progreso").length;
          const pct = memberTasks.length ? Math.round((done / memberTasks.length) * 100) : 0;
          return (
            <div key={member.id} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <Avatar member={member} size={42}/>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{member.name}</div>
                  <div style={{ fontSize: 12, color: C.textMuted }}>{member.role}</div>
                </div>
                <div style={{ marginLeft: "auto" }}>
                  <Ring pct={pct} color={C.accent} size={44} stroke={5}/>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                {member.accounts.map(acc => <AccountBadge key={acc} account={acc} small/>)}
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                {[
                  { label: "Total", val: memberTasks.length },
                  { label: "En progreso", val: inProg },
                  { label: "Completadas", val: done },
                ].map(s => (
                  <div key={s.label} style={{ flex: 1, background: C.bg, borderRadius: 8, padding: "8px 10px" }}>
                    <div style={{ fontSize: 18, fontWeight: 800, fontFamily: FONT_DISPLAY }}>{s.val}</div>
                    <div style={{ fontSize: 10, color: C.textMuted }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── PROYECTOS VIEW ───────────────────────────────────────────────────────────
function ProyectosView({ tasks, updateTask, deleteTask }) {
  const [sortBy, setSortBy] = useState("account");
  const grouped = useMemo(() => {
    if (sortBy === "account") {
      return ACCOUNTS.slice(1).map(acc => ({ key: acc, label: acc, items: tasks.filter(t => t.account === acc) })).filter(g => g.items.length > 0);
    }
    if (sortBy === "assignee") {
      return TEAM.map(m => ({ key: m.id, label: m.name, items: tasks.filter(t => t.assigneeId === m.id) })).filter(g => g.items.length > 0);
    }
    return STATUSES.map(s => ({ key: s, label: s, items: tasks.filter(t => t.status === s) })).filter(g => g.items.length > 0);
  }, [tasks, sortBy]);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {[["account", "Por cuenta"], ["status", "Por estado"], ["assignee", "Por persona"]].map(([k, l]) => (
          <button key={k} onClick={() => setSortBy(k)}
            style={{ padding: "6px 14px", borderRadius: 8, border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer",
              background: sortBy === k ? C.accent : C.surface, color: sortBy === k ? "#fff" : C.textDim }}>
            {l}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {grouped.map(group => (
          <div key={group.key} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 10 }}>
              {sortBy === "account" && <AccountBadge account={group.label}/>}
              {sortBy !== "account" && <span style={{ fontSize: 13, fontWeight: 700 }}>{group.label}</span>}
              <span style={{ fontSize: 12, color: C.textMuted }}>{group.items.length} tareas</span>
            </div>
            <div style={{ padding: "8px 12px" }}>
              {group.items.map(t => (
                <TaskRow key={t.id} task={t} onClick={() => {}} onStatusChange={s => updateTask(t.id, { status: s })}/>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── BENCHMARKS VIEW ──────────────────────────────────────────────────────────
function BenchmarksView({ tasks }) {
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Performance del equipo vs. benchmarks</div>
        </div>
        <div style={{ overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: C.bg }}>
                {["Persona", "Rol", "Cuenta(s)", "Semanal", "Bench", "Mensual", "Bench", "Calidad", "Estado"].map(h => (
                  <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 700, color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TEAM.map(member => {
                const bench = BENCHMARKS[member.role] || BENCHMARKS["Redactor"];
                const memberTasks = tasks.filter(t => t.assigneeId === member.id);
                const weekly = memberTasks.filter(t => t.status === "Completado" && t.completedAt && new Date(t.completedAt) >= startOfWeek).length;
                const monthly = memberTasks.filter(t => t.status === "Completado").length;
                const weekRatio = bench.weekly ? (weekly / bench.weekly) : 0;
                const monthRatio = bench.monthly ? (monthly / bench.monthly) : 0;
                const avgRatio = (weekRatio + monthRatio) / 2;
                const statusColor = avgRatio >= 1 ? "#34d399" : avgRatio >= 0.7 ? "#f59e0b" : "#f87171";
                const statusLabel = avgRatio >= 1 ? "On track" : avgRatio >= 0.7 ? "Warning" : "Behind";
                return (
                  <tr key={member.id} style={{ borderBottom: `1px solid ${C.border}` }}
                    onMouseEnter={e => e.currentTarget.style.background = C.surfaceHover}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Avatar member={member} size={28}/>
                        <span style={{ fontWeight: 600 }}>{member.name}</span>
                      </div>
                    </td>
                    <td style={{ padding: "12px 16px", color: C.textMuted, fontSize: 12 }}>{member.role}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {member.accounts.map(a => <AccountBadge key={a} account={a} small/>)}
                      </div>
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <span style={{ fontWeight: 700, color: weekRatio >= 1 ? "#34d399" : weekRatio >= 0.7 ? "#f59e0b" : "#f87171" }}>{weekly}</span>
                    </td>
                    <td style={{ padding: "12px 16px", color: C.textMuted }}>{bench.weekly}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <span style={{ fontWeight: 700, color: monthRatio >= 1 ? "#34d399" : monthRatio >= 0.7 ? "#f59e0b" : "#f87171" }}>{monthly}</span>
                    </td>
                    <td style={{ padding: "12px 16px", color: C.textMuted }}>{bench.monthly}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ flex: 1, height: 4, background: C.border, borderRadius: 2, minWidth: 60 }}>
                          <div style={{ height: 4, width: `${Math.min(100, avgRatio * 100)}%`, background: statusColor, borderRadius: 2 }}/>
                        </div>
                        <span style={{ fontSize: 11, color: C.textMuted }}>{bench.quality}%</span>
                      </div>
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: statusColor, background: `${statusColor}18`,
                        border: `1px solid ${statusColor}30`, borderRadius: 6, padding: "2px 8px" }}>{statusLabel}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── TASK MODAL ───────────────────────────────────────────────────────────────
function TaskModal({ task, onSave, onClose, onDelete, activeAccount }) {
  const [form, setForm] = useState({
    title: task?.title || "",
    assigneeId: task?.assigneeId || TEAM[0].id,
    account: task?.account || (activeAccount !== "Todas" ? activeAccount : "Geely"),
    status: task?.status || "Por hacer",
    priority: task?.priority || "Media",
    dueDate: task?.dueDate || "",
  });

  const accountMembers = TEAM.filter(m => m.accounts.includes(form.account));

  function set(k, v) {
    setForm(f => {
      const next = { ...f, [k]: v };
      if (k === "account") {
        const valid = TEAM.filter(m => m.accounts.includes(v));
        if (!valid.find(m => m.id === next.assigneeId)) next.assigneeId = valid[0]?.id || TEAM[0].id;
      }
      return next;
    });
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 28, width: 480, maxWidth: "95vw" }}>
        <div style={{ fontSize: 16, fontWeight: 800, fontFamily: FONT_DISPLAY, marginBottom: 20 }}>
          {task ? "Editar tarea" : "Nueva tarea"}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, display: "block", marginBottom: 6 }}>TÍTULO</label>
            <input value={form.title} onChange={e => set("title", e.target.value)}
              placeholder="Descripción de la tarea..."
              style={{ width: "100%", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8,
                padding: "10px 12px", color: C.text, fontSize: 14, outline: "none", boxSizing: "border-box" }}/>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, display: "block", marginBottom: 6 }}>CUENTA</label>
              <select value={form.account} onChange={e => set("account", e.target.value)}
                style={{ width: "100%", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 12px", color: C.text, fontSize: 13 }}>
                {ACCOUNTS.slice(1).map(a => <option key={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, display: "block", marginBottom: 6 }}>ASIGNADO A</label>
              <select value={form.assigneeId} onChange={e => set("assigneeId", e.target.value)}
                style={{ width: "100%", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 12px", color: C.text, fontSize: 13 }}>
                {accountMembers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, display: "block", marginBottom: 6 }}>ESTADO</label>
              <select value={form.status} onChange={e => set("status", e.target.value)}
                style={{ width: "100%", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 12px", color: C.text, fontSize: 13 }}>
                {STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, display: "block", marginBottom: 6 }}>PRIORIDAD</label>
              <select value={form.priority} onChange={e => set("priority", e.target.value)}
                style={{ width: "100%", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 12px", color: C.text, fontSize: 13 }}>
                {PRIORITIES.map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, display: "block", marginBottom: 6 }}>FECHA LÍMITE</label>
              <input type="date" value={form.dueDate} onChange={e => set("dueDate", e.target.value)}
                style={{ width: "100%", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 12px", color: C.text, fontSize: 13, boxSizing: "border-box" }}/>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
          {onDelete && (
            <button onClick={onDelete} style={{ background: "#f8717118", border: `1px solid #f8717130`, color: "#f87171",
              padding: "9px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              Eliminar
            </button>
          )}
          <div style={{ flex: 1 }}/>
          <button onClick={onClose} style={{ background: "none", border: `1px solid ${C.border}`, color: C.textDim,
            padding: "9px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            Cancelar
          </button>
          <button onClick={() => form.title && onSave(form)}
            style={{ background: form.title ? C.accent : C.border, border: "none", color: "#fff",
              padding: "9px 20px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: form.title ? "pointer" : "default" }}>
            {task ? "Guardar" : "Crear tarea"}
          </button>
        </div>
      </div>
    </div>
  );
}
