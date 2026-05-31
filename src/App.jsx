import { useState, useMemo, useCallback, useEffect, createContext, useContext } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, CartesianGrid, LineChart, Line } from "recharts";
import { Users, ListTodo, Clock, AlertTriangle, Plus, X, ChevronDown, Calendar, FolderKanban, LayoutDashboard, Edit3, Trash2, Check, Filter, Zap, Search, TrendingUp, Target, Activity, Menu, Bell, Layers, Star, Tag, Loader2 } from "lucide-react";
import { createClient } from "@supabase/supabase-js";

// ── SUPABASE ──
const supabase = createClient(
  "https://hqpucabkwhhjmvmxhijp.supabase.co",
  "sb_publishable_VtNZqxLJcktHKLYpX3nh7Q_27z3SrkA"
);

// DB snake_case ↔ JS camelCase
const fromDB = (row) => ({
  id: row.id, titulo: row.titulo, tipoTarea: row.tipo_tarea, miembroId: row.miembro_id,
  proyecto: row.proyecto, fechaInicio: row.fecha_inicio, fechaFin: row.fecha_fin,
  estado: row.estado, prioridad: row.prioridad, benchmarkHoras: Number(row.benchmark_horas),
  horasReales: Number(row.horas_reales),
});
const toDB = (t) => ({
  id: t.id, titulo: t.titulo, tipo_tarea: t.tipoTarea, miembro_id: t.miembroId,
  proyecto: t.proyecto, fecha_inicio: t.fechaInicio, fecha_fin: t.fechaFin,
  estado: t.estado, prioridad: t.prioridad, benchmark_horas: t.benchmarkHoras,
  horas_reales: t.horasReales, updated_at: new Date().toISOString(),
});

const FD = "'Geely','Inter',-apple-system,sans-serif";
const HPD = 8;

// ── BENCHMARK MATRIX (IA-adjusted) ──
const TASK_TYPES = [
  { key: "concepto", label: "Concepto creativo / Idea", cat: "Conceptual" },
  { key: "guion_tv", label: "Guión (spot TV 30s)", cat: "Conceptual" },
  { key: "guion_radio", label: "Guión (radio/digital)", cat: "Conceptual" },
  { key: "storyboard", label: "Storyboard / Animatic", cat: "Conceptual" },
  { key: "kv", label: "Key Visual", cat: "Diseño" },
  { key: "editorial", label: "Diseño editorial", cat: "Diseño" },
  { key: "pop", label: "Material POP", cat: "Diseño" },
  { key: "deck", label: "Presentación / Deck", cat: "Diseño" },
  { key: "grilla", label: "Grilla RRSS (mes)", cat: "Digital" },
  { key: "post", label: "Post", cat: "Digital" },
  { key: "reel", label: "Reel", cat: "Digital" },
  { key: "carrusel", label: "Carrusel", cat: "Digital" },
  { key: "adaptaciones", label: "Adaptaciones", cat: "Digital" },
  { key: "plan_medios", label: "Plan de medios", cat: "Planificación" },
];

const BM = {
  concepto: { da: 4, redactor: 6, dc: 6 }, guion_tv: { da: 1, redactor: 10, dc: 2 },
  guion_radio: { da: 0.5, redactor: 5, dc: 1.5 }, storyboard: { da: 12, redactor: 1, dc: 2 },
  kv: { da: 2.5, redactor: 1, dc: 0.5 }, editorial: { da: 16, redactor: 8, dc: 2 },
  pop: { da: 2.5, redactor: 1, dc: 0.5 }, deck: { da: 6, redactor: 5, dc: 2 },
  grilla: { da: 8, redactor: 5, dc: 1 }, post: { da: 2, redactor: 0.5, dc: 0.5 },
  reel: { da: 2, redactor: 0.5, dc: 0.5 }, carrusel: { da: 2, redactor: 0.5, dc: 0 },
  adaptaciones: { da: 3, redactor: 0.5, dc: 0 }, plan_medios: { da: 0, redactor: 4, dc: 2 },
};

const MEMBERS = [
  { id: "m1", name: "Victor Galán", role: "Dir. Arte", roleKey: "da", color: "#818cf8", horasSemanales: 40 },
  { id: "m2", name: "Victor González", role: "Dir. Arte", roleKey: "da", color: "#f87171", horasSemanales: 40 },
  { id: "m3", name: "Kevin Rodríguez", role: "Dir. Arte", roleKey: "da", color: "#34d399", horasSemanales: 40 },
  { id: "m4", name: "Raúl Díaz", role: "Redactor", roleKey: "redactor", color: "#fbbf24", horasSemanales: 40 },
  { id: "m5", name: "Sebastián Rivera", role: "Dir. Creativo", roleKey: "dc", color: "#a78bfa", horasSemanales: 40 },
];

const PROJECTS = ["Campaña Geely", "Branding", "Digital Content", "BTL & Eventos", "Pitch Nuevos Clientes", "Interna"];
const ESTADOS = [
  { key: "pendiente", label: "Pendiente", color: "#f87171" },
  { key: "progreso", label: "En Progreso", color: "#fbbf24" },
  { key: "completada", label: "Completada", color: "#34d399" },
];
const PRIOS = [
  { key: "alta", label: "Alta", color: "#f87171" },
  { key: "media", label: "Media", color: "#fbbf24" },
  { key: "baja", label: "Baja", color: "#64748b" },
];

const gid = () => "t" + Date.now() + Math.random().toString(36).slice(2, 6);
const now = new Date();
const dd = (o) => { const t = new Date(now); t.setDate(t.getDate() + o); return t.toISOString().split("T")[0]; };

function getBenchmark(tipo, roleKey, tasks) {
  const base = BM[tipo]?.[roleKey] ?? 0;
  if (!base) return 0;
  const hist = tasks.filter(t => t.tipoTarea === tipo && t.estado === "completada");
  const rh = hist.filter(t => { const m = MEMBERS.find(x => x.id === t.miembroId); return m?.roleKey === roleKey; });
  if (rh.length >= 3) { const avg = rh.reduce((s, t) => s + t.horasReales, 0) / rh.length; return Math.round((base * 0.3 + avg * 0.7) * 10) / 10; }
  return base;
}

function getEff(real, bm) {
  if (!bm || !real) return null;
  const r = real / bm;
  if (r <= 1) return { color: "#34d399", label: "En tiempo", r };
  if (r <= 1.2) return { color: "#fbbf24", label: "+20%", r };
  return { color: "#f87171", label: `+${Math.round((r - 1) * 100)}%`, r };
}

const filt = (tasks, f) => {
  let r = [...tasks];
  if (f.miembro) r = r.filter(t => t.miembroId === f.miembro);
  if (f.estado) r = r.filter(t => t.estado === f.estado);
  if (f.prioridad) r = r.filter(t => t.prioridad === f.prioridad);
  if (f.proyecto) r = r.filter(t => t.proyecto === f.proyecto);
  if (f.search) { const s = f.search.toLowerCase(); r = r.filter(t => t.titulo.toLowerCase().includes(s)); }
  return r;
};

// Tasks loaded from Supabase

// ── STYLES ──
const G = {
  bg: "#060a13",
  card: { background: "rgba(255,255,255,0.03)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, transition: "all .25s ease" },
  inp: { width: "100%", padding: "8px 12px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, fontSize: 13, color: "#e2e8f0", fontFamily: "inherit", outline: "none" },
  lbl: { display: "block", fontSize: 10, fontWeight: 600, color: "#64748b", marginBottom: 4, letterSpacing: 0.5, textTransform: "uppercase" },
};
const cGlow = (c) => ({ ...G.card, borderColor: c + "20", boxShadow: `0 0 20px ${c}06` });

// ── COMPONENTS ──
const Badge = ({ children, color }) => (
  <span style={{ background: color + "15", color, fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 6, whiteSpace: "nowrap" }}>{children}</span>
);

const Sel = ({ value, onChange, options, placeholder, style }) => (
  <div style={{ position: "relative", ...style }}>
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{ ...G.inp, paddingRight: 26, appearance: "none", cursor: "pointer", fontSize: 12 }}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
    <ChevronDown size={11} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "#475569" }} />
  </div>
);

const IBtn = ({ icon: I, onClick, danger, size = 14 }) => (
  <button onClick={onClick} style={{ background: "transparent", border: "none", cursor: "pointer", padding: 4, borderRadius: 6, color: danger ? "#f87171" : "#475569", display: "flex" }}>
    <I size={size} />
  </button>
);

const Ring = ({ pct, size = 90, stroke = 7, color = "#818cf8", label }) => {
  const r = (size - stroke) / 2, circ = 2 * Math.PI * r, off = circ * (1 - Math.min(100, pct) / 100);
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={circ} strokeDashoffset={off} strokeLinecap="round"
          style={{ transition: "stroke-dashoffset .8s ease", filter: `drop-shadow(0 0 6px ${color}40)` }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: size > 60 ? 16 : 11, fontWeight: 800, color: "#e2e8f0", fontFamily: FD }}>{label || `${Math.round(pct)}%`}</span>
      </div>
    </div>
  );
};

const EffDot = ({ real, bm }) => {
  const e = getEff(real, bm);
  if (!e) return null;
  return <div title={`${real}h / ${bm}h`} style={{ width: 7, height: 7, borderRadius: "50%", background: e.color, boxShadow: `0 0 5px ${e.color}40`, flexShrink: 0 }} />;
};

const Empty = ({ icon: I, title, sub }) => (
  <div style={{ ...G.card, padding: "48px 24px", textAlign: "center", background: "rgba(129,140,248,0.03)" }}>
    <I size={36} color="#818cf8" style={{ opacity: 0.4, marginBottom: 12 }} />
    <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{title}</div>
    <div style={{ fontSize: 12, color: "#475569" }}>{sub}</div>
  </div>
);

const GTip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ ...G.card, background: "rgba(12,18,34,0.95)", padding: "8px 12px" }}>
      <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 3 }}>{label}</div>
      {payload.map((p, i) => <div key={i} style={{ fontSize: 10, color: p.color }}>{p.name}: {p.value}</div>)}
    </div>
  );
};

// ── TOAST ──
const ToastCtx = createContext();
const useToast = () => useContext(ToastCtx);
function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const add = useCallback((msg, type = "info") => {
    const id = Date.now();
    setToasts(p => [...p, { id, msg, type }]);
    setTimeout(() => setToasts(p => p.map(t => t.id === id ? { ...t, out: true } : t)), 2500);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 2900);
  }, []);
  const tc = { success: "#34d399", error: "#f87171", info: "#a5b4fc" };
  return (
    <ToastCtx.Provider value={add}>
      {children}
      <div style={{ position: "fixed", top: 16, right: 16, zIndex: 9999, display: "flex", flexDirection: "column", gap: 8, pointerEvents: "none" }}>
        {toasts.map(t => (
          <div key={t.id} style={{ pointerEvents: "auto", padding: "10px 16px", borderRadius: 10, background: tc[t.type] + "15", border: `1px solid ${tc[t.type]}25`, color: tc[t.type], fontSize: 12, fontWeight: 500, display: "flex", alignItems: "center", gap: 8, opacity: t.out ? 0 : 1, transform: t.out ? "translateX(40px)" : "none", transition: "all .3s ease" }}>
            {t.type === "success" ? <Check size={14} /> : <Zap size={14} />}{t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ── MODAL ──
const Modal = ({ task, members, allTasks, onSave, onClose }) => {
  const [f, sf] = useState(task || { titulo: "", tipoTarea: "", miembroId: "", proyecto: "", fechaInicio: dd(0), fechaFin: dd(5), estado: "pendiente", prioridad: "media", horasReales: 0 });
  const s = (k, v) => sf(p => ({ ...p, [k]: v }));
  const ok = f.titulo && f.miembroId && f.proyecto && f.tipoTarea;
  const member = members.find(m => m.id === f.miembroId);
  const bmH = member && f.tipoTarea ? getBenchmark(f.tipoTarea, member.roleKey, allTasks) : 0;
  const tt = TASK_TYPES.find(t => t.key === f.tipoTarea);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, backdropFilter: "blur(8px)" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ ...G.card, background: "rgba(12,18,34,0.95)", padding: 28, width: "min(500px,92vw)", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 32px 64px rgba(0,0,0,.6)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{task ? "Editar tarea" : "Nueva tarea"}</h3>
          <IBtn icon={X} onClick={onClose} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div><label style={G.lbl}>Tipo de tarea</label>
            <Sel value={f.tipoTarea} onChange={v => { s("tipoTarea", v); if (!f.titulo) { const t = TASK_TYPES.find(x => x.key === v); if (t) s("titulo", t.label); } }} placeholder="Seleccionar..." options={TASK_TYPES.map(t => ({ v: t.key, l: t.label }))} />
          </div>
          <div><label style={G.lbl}>Título</label><input value={f.titulo} onChange={e => s("titulo", e.target.value)} style={G.inp} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><label style={G.lbl}>Asignar a</label><Sel value={f.miembroId} onChange={v => s("miembroId", v)} placeholder="..." options={members.map(m => ({ v: m.id, l: `${m.name} (${m.role})` }))} /></div>
            <div><label style={G.lbl}>Proyecto</label><Sel value={f.proyecto} onChange={v => s("proyecto", v)} placeholder="..." options={PROJECTS.map(p => ({ v: p, l: p }))} /></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><label style={G.lbl}>Inicio</label><input type="date" value={f.fechaInicio} onChange={e => s("fechaInicio", e.target.value)} style={{ ...G.inp, colorScheme: "dark" }} /></div>
            <div><label style={G.lbl}>Fin</label><input type="date" value={f.fechaFin} onChange={e => s("fechaFin", e.target.value)} style={{ ...G.inp, colorScheme: "dark" }} /></div>
          </div>

          {/* Benchmark */}
          <div style={{ ...G.card, padding: "12px 16px", background: "rgba(129,140,248,0.06)", borderColor: "rgba(129,140,248,0.12)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 10, color: "#818cf8", fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}><Star size={11} /> Benchmark IA</div>
              <div style={{ fontSize: 9, color: "#475569", marginTop: 2 }}>{tt ? tt.label : "Seleccionar tipo"}{member ? ` · ${member.role}` : ""}</div>
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: bmH ? "#e2e8f0" : "#475569", fontFamily: FD }}>{bmH || "—"}<span style={{ fontSize: 11, color: "#64748b" }}>h</span></div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><label style={G.lbl}>Estado</label><Sel value={f.estado} onChange={v => s("estado", v)} options={ESTADOS.map(e => ({ v: e.key, l: e.label }))} /></div>
            <div><label style={G.lbl}>Prioridad</label><Sel value={f.prioridad} onChange={v => s("prioridad", v)} options={PRIOS.map(p => ({ v: p.key, l: p.label }))} /></div>
          </div>
          <div><label style={G.lbl}>Horas reales</label><input type="number" min={0} step={0.5} value={f.horasReales} onChange={e => s("horasReales", +e.target.value)} style={G.inp} /></div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
          <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: 10, border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", background: "rgba(255,255,255,0.04)", color: "#64748b", fontFamily: "inherit" }}>Cancelar</button>
          <button disabled={!ok} onClick={() => onSave({ ...f, id: f.id || gid(), benchmarkHoras: bmH })}
            style={{ padding: "8px 20px", borderRadius: 10, border: "none", fontSize: 13, fontWeight: 600, cursor: ok ? "pointer" : "not-allowed", background: ok ? "linear-gradient(135deg,#6366f1,#818cf8)" : "rgba(255,255,255,0.04)", color: ok ? "#fff" : "#475569", fontFamily: "inherit" }}>
            {task ? "Guardar" : "Crear"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── OVERVIEW ──
const Overview = ({ tasks, members }) => {
  if (!tasks.length) return <Empty icon={LayoutDashboard} title="Sin tareas aún" sub="Creá tu primera tarea con + Nueva tarea" />;
  const comp = tasks.filter(t => t.estado === "completada").length;
  const prog = tasks.filter(t => t.estado === "progreso").length;
  const pend = tasks.filter(t => t.estado === "pendiente").length;
  const pctComp = tasks.length ? Math.round(comp / tasks.length * 100) : 0;
  const hBm = tasks.reduce((s, t) => s + (t.benchmarkHoras || 0), 0);

  const memChart = members.map(m => {
    const mt = tasks.filter(t => t.miembroId === m.id);
    return { name: m.name.split(" ")[0], Completadas: mt.filter(t => t.estado === "completada").length, Progreso: mt.filter(t => t.estado === "progreso").length, Pendientes: mt.filter(t => t.estado === "pendiente").length };
  });

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
      {[
        { icon: ListTodo, l: "Total", v: tasks.length, sub: `${comp} completadas`, c: "#818cf8" },
        { icon: TrendingUp, l: "Completado", v: `${pctComp}%`, c: "#34d399", ring: true },
        { icon: Zap, l: "En progreso", v: prog, sub: `${pend} pendientes`, c: "#fbbf24" },
        { icon: Clock, l: "Benchmark total", v: `${hBm}h`, sub: `${HPD}h/día base`, c: "#a78bfa" },
      ].map((k, i) => (
        <div key={i} style={{ ...cGlow(k.c), padding: "18px 20px", display: "flex", alignItems: "center", gap: 14 }}>
          {k.ring ? <Ring pct={pctComp} size={60} stroke={5} color={k.c} /> :
            <div style={{ width: 42, height: 42, borderRadius: 12, background: k.c + "12", display: "flex", alignItems: "center", justifyContent: "center" }}><k.icon size={18} color={k.c} /></div>}
          <div>
            <div style={{ fontSize: 10, color: "#475569", fontWeight: 500, textTransform: "uppercase", letterSpacing: 0.5 }}>{k.l}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: "#e2e8f0", lineHeight: 1.1, fontFamily: FD, marginTop: 2 }}>{k.v}</div>
            {k.sub && <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>{k.sub}</div>}
          </div>
        </div>
      ))}

      {/* Chart */}
      <div style={{ ...G.card, padding: 20, gridColumn: "span 3" }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Tareas por miembro</div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={memChart} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="name" fontSize={10} tick={{ fill: "#475569" }} axisLine={false} tickLine={false} />
            <YAxis fontSize={10} tick={{ fill: "#475569" }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip content={<GTip />} />
            <Bar dataKey="Completadas" fill="#34d399" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Progreso" fill="#fbbf24" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Pendientes" fill="#f87171" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Team Capacity Chart */}
      <div style={{ ...G.card, padding: 20, gridColumn: "span 4" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Capacidad del equipo</div>
            <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>Horas benchmark asignadas vs capacidad semanal ({HPD}h/día)</div>
          </div>
          {(() => {
            const totalUsed = members.reduce((s, m) => s + tasks.filter(t => t.miembroId === m.id && t.estado !== "completada").reduce((a, t) => a + (t.benchmarkHoras || 0), 0), 0);
            const totalCap = members.reduce((s, m) => s + m.horasSemanales, 0);
            const teamPct = Math.round(totalUsed / totalCap * 100);
            return (
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: 0.5 }}>Uso total</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>{totalUsed}h / {totalCap}h</div>
                </div>
                <Ring pct={teamPct} size={52} stroke={4} color={teamPct > 90 ? "#f87171" : teamPct > 70 ? "#fbbf24" : "#34d399"} label={`${teamPct}%`} />
              </div>
            );
          })()}
        </div>

        {/* Horizontal capacity bars */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {members.map(m => {
            const active = tasks.filter(t => t.miembroId === m.id && t.estado !== "completada");
            const hUsed = active.reduce((s, t) => s + (t.benchmarkHoras || 0), 0);
            const pct = Math.round(hUsed / m.horasSemanales * 100);
            const barColor = pct > 100 ? "#f87171" : pct > 75 ? "#fbbf24" : "#34d399";
            const taskCount = active.length;

            return (
              <div key={m.id}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 26, height: 26, borderRadius: 8, background: m.color + "15", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: m.color }}>{m.name.split(" ").map(n => n[0]).join("")}</div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0" }}>{m.name}</div>
                      <div style={{ fontSize: 9, color: "#475569" }}>{m.role} · {taskCount} tarea{taskCount !== 1 ? "s" : ""} activa{taskCount !== 1 ? "s" : ""}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <span style={{ fontSize: 14, fontWeight: 800, color: barColor, fontFamily: FD }}>{pct}%</span>
                    <div style={{ fontSize: 9, color: "#475569" }}>{hUsed}h / {m.horasSemanales}h</div>
                  </div>
                </div>
                {/* Bar */}
                <div style={{ position: "relative", height: 8, background: "rgba(255,255,255,0.04)", borderRadius: 99, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.min(100, pct)}%`, background: `linear-gradient(90deg, ${barColor}90, ${barColor})`, borderRadius: 99, transition: "width 0.6s ease" }} />
                  {/* Capacity line at 100% */}
                  {pct > 100 && <div style={{ position: "absolute", right: 0, top: -2, bottom: -2, width: 2, background: "#f87171", borderRadius: 1 }} />}
                </div>
                {/* Task breakdown mini-pills */}
                {active.length > 0 && (
                  <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
                    {active.map(t => {
                      const tt = TASK_TYPES.find(x => x.key === t.tipoTarea);
                      return (
                        <span key={t.id} style={{ fontSize: 9, padding: "1px 6px", borderRadius: 4, background: "rgba(255,255,255,0.04)", color: "#64748b", whiteSpace: "nowrap" }}>
                          {t.titulo.length > 20 ? t.titulo.slice(0, 20) + "…" : t.titulo} ({t.benchmarkHoras}h)
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Capacity legend */}
        <div style={{ display: "flex", gap: 14, marginTop: 14, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          {[
            { color: "#34d399", label: "Disponible (<75%)" },
            { color: "#fbbf24", label: "Carga alta (75-100%)" },
            { color: "#f87171", label: "Sobrecarga (>100%)" },
          ].map((l, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "#64748b" }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: l.color }} />{l.label}
            </div>
          ))}
        </div>
      </div>

      {/* Alerts */}
      <div style={{ ...G.card, padding: 20, gridColumn: "span 4" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}><Bell size={14} color="#fbbf24" /><span style={{ fontSize: 14, fontWeight: 700 }}>Alertas</span></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(() => {
            const al = [];
            members.forEach(m => { const h = tasks.filter(t => t.miembroId === m.id && t.estado !== "completada").reduce((s, t) => s + (t.benchmarkHoras || 0), 0); if (h > m.horasSemanales) al.push({ t: "danger", m: `${m.name.split(" ")[0]}: ${h}h / ${m.horasSemanales}h` }); });
            tasks.forEach(t => { if (t.estado === "completada") return; const diff = (new Date(t.fechaFin) - now) / 864e5; if (diff >= 0 && diff <= 2) al.push({ t: "warn", m: `"${t.titulo}" vence ${diff < 1 ? "hoy" : `en ${Math.ceil(diff)}d`}` }); });
            if (!al.length) return <div style={{ fontSize: 12, color: "#34d399" }}>Sin alertas activas</div>;
            return al.map((a, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 8, fontSize: 11, background: a.t === "danger" ? "rgba(248,113,113,0.06)" : "rgba(251,191,36,0.06)", color: a.t === "danger" ? "#f87171" : "#fbbf24", border: `1px solid ${a.t === "danger" ? "rgba(248,113,113,0.1)" : "rgba(251,191,36,0.1)"}` }}>
                {a.t === "danger" ? <AlertTriangle size={11} /> : <Clock size={11} />}{a.m}
              </div>
            ));
          })()}
        </div>
      </div>
    </div>
  );
};

// ── KANBAN ──
const Kanban = ({ tasks, members, onDrop, onEdit, onDelete }) => {
  const [over, setOver] = useState("");
  if (!tasks.length) return <Empty icon={ListTodo} title="Kanban vacío" sub="Las tareas aparecerán aquí" />;
  return (
    <div style={{ display: "flex", gap: 12, overflowX: "auto" }}>
      {ESTADOS.map(st => (
        <div key={st.key}
          onDragOver={e => { e.preventDefault(); setOver(st.key); }}
          onDragLeave={() => setOver("")}
          onDrop={e => { e.preventDefault(); setOver(""); onDrop(e.dataTransfer.getData("tid"), st.key); }}
          style={{ ...G.card, flex: 1, minWidth: 260, padding: 14, borderColor: over === st.key ? st.color + "30" : "rgba(255,255,255,0.06)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, paddingBottom: 10, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: st.color, boxShadow: `0 0 8px ${st.color}40` }} />
            <span style={{ fontWeight: 700, fontSize: 13 }}>{st.label}</span>
            <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: st.color, background: st.color + "12", padding: "2px 8px", borderRadius: 6 }}>
              {tasks.filter(t => t.estado === st.key).length}
            </span>
          </div>
          {tasks.filter(t => t.estado === st.key).map(t => {
            const m = members.find(x => x.id === t.miembroId);
            const pr = PRIOS.find(p => p.key === t.prioridad);
            const tt = TASK_TYPES.find(x => x.key === t.tipoTarea);
            return (
              <div key={t.id} draggable onDragStart={e => e.dataTransfer.setData("tid", t.id)}
                style={{ ...G.card, padding: 12, cursor: "grab", borderLeft: `3px solid ${pr.color}`, marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, flex: 1, lineHeight: 1.3 }}>{t.titulo}</div>
                  <EffDot real={t.horasReales} bm={t.benchmarkHoras} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                  {m && <span style={{ fontSize: 10, color: m.color, fontWeight: 600, background: m.color + "12", padding: "2px 6px", borderRadius: 4 }}>{m.name.split(" ")[0]}</span>}
                  <Badge color={pr.color}>{pr.label}</Badge>
                  {t.benchmarkHoras > 0 && <span style={{ fontSize: 10, color: "#64748b" }}>{t.benchmarkHoras}h bm</span>}
                  <div style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
                    <IBtn icon={Edit3} size={12} onClick={() => onEdit(t)} />
                    <IBtn icon={Trash2} size={12} onClick={() => onDelete(t.id)} danger />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
};

// ── PERSON VIEW ──
const PersonView = ({ tasks, members }) => (
  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
    {members.map(m => {
      const mt = tasks.filter(t => t.miembroId === m.id);
      const active = mt.filter(t => t.estado !== "completada");
      const comp = mt.filter(t => t.estado === "completada");
      const hBm = active.reduce((s, t) => s + (t.benchmarkHoras || 0), 0);
      const pct = mt.length ? Math.round(comp.length / mt.length * 100) : 0;
      const over = hBm > m.horasSemanales;
      const effData = comp.filter(t => t.benchmarkHoras > 0 && t.horasReales > 0).map((t, i) => ({ n: `T${i + 1}`, eff: Math.round(t.horasReales / t.benchmarkHoras * 100) }));

      return (
        <div key={m.id} style={{ ...cGlow(m.color), padding: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: m.color + "12", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 14, color: m.color }}>{m.name.split(" ").map(n => n[0]).join("")}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{m.name}</div>
              <div style={{ fontSize: 11, color: "#475569" }}>{m.role}</div>
            </div>
            <Ring pct={pct} size={44} stroke={4} color={over ? "#f87171" : m.color} label={`${pct}%`} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 10 }}>
            {[{ l: "Tareas", v: mt.length, c: "#818cf8" }, { l: "Benchmark", v: `${hBm}h`, c: over ? "#f87171" : "#34d399" }, { l: "Activas", v: active.length, c: "#fbbf24" }].map((s, i) => (
              <div key={i} style={{ textAlign: "center", padding: "5px 4px", background: "rgba(255,255,255,0.03)", borderRadius: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: s.c, fontFamily: FD }}>{s.v}</div>
                <div style={{ fontSize: 9, color: "#475569", textTransform: "uppercase" }}>{s.l}</div>
              </div>
            ))}
          </div>
          {effData.length >= 2 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, color: "#475569", marginBottom: 4 }}>Tendencia eficiencia</div>
              <ResponsiveContainer width="100%" height={50}>
                <LineChart data={effData}><Line type="monotone" dataKey="eff" stroke={m.color} strokeWidth={2} dot={{ r: 2, fill: m.color }} /><YAxis hide domain={[0, "auto"]} /></LineChart>
              </ResponsiveContainer>
            </div>
          )}
          {mt.map(t => {
            const st = ESTADOS.find(s => s.key === t.estado);
            return (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, padding: "3px 6px", borderRadius: 6, marginBottom: 2, background: "rgba(255,255,255,0.02)" }}>
                <div style={{ width: 5, height: 5, borderRadius: "50%", background: st.color, flexShrink: 0 }} />
                <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.titulo}</span>
                <EffDot real={t.horasReales} bm={t.benchmarkHoras} />
                <span style={{ color: "#475569", fontSize: 10 }}>{t.benchmarkHoras}h</span>
              </div>
            );
          })}
        </div>
      );
    })}
  </div>
);

// ── BENCHMARKS VIEW ──
const BenchView = ({ tasks }) => {
  const cats = [...new Set(TASK_TYPES.map(t => t.cat))];
  return (
    <div style={{ ...G.card, padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <Star size={16} color="#818cf8" /><span style={{ fontSize: 16, fontWeight: 700 }}>Matriz de benchmarks</span><Badge color="#34d399">IA-adjusted</Badge>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>{["Tipo de tarea", "Dir. arte", "Redactor", "Dir. creativo", "Prom. real"].map((h, i) => (
              <th key={i} style={{ textAlign: i ? "center" : "left", padding: "8px 10px", fontWeight: 500, fontSize: 11, color: "#64748b", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {cats.map(cat => [
              <tr key={"c" + cat}><td colSpan={5} style={{ padding: "8px 10px", fontSize: 10, fontWeight: 600, color: "#475569", textTransform: "uppercase", background: "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>{cat}</td></tr>,
              ...TASK_TYPES.filter(t => t.cat === cat).map(tt => {
                const ct = tasks.filter(t => t.tipoTarea === tt.key && t.estado === "completada" && t.horasReales > 0);
                const avg = ct.length ? Math.round(ct.reduce((s, t) => s + t.horasReales, 0) / ct.length * 10) / 10 : null;
                return (
                  <tr key={tt.key} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <td style={{ padding: "6px 10px", fontWeight: 500 }}>{tt.label}</td>
                    {["da", "redactor", "dc"].map(r => { const v = BM[tt.key]?.[r]; return <td key={r} style={{ textAlign: "center", padding: "6px", color: v ? "#e2e8f0" : "#475569" }}>{v ? `${v}h` : "—"}</td>; })}
                    <td style={{ textAlign: "center", padding: "6px", color: avg ? "#818cf8" : "#475569", fontWeight: avg ? 600 : 400 }}>{avg ? `${avg}h` : "—"}</td>
                  </tr>
                );
              })
            ])}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 14, padding: 12, background: "rgba(129,140,248,0.04)", borderRadius: 10, fontSize: 11, color: "#64748b", lineHeight: 1.6 }}>
        <span style={{ color: "#818cf8", fontWeight: 600 }}>Fórmula:</span> benchmark = (base × 0.3) + (promedio_real × 0.7) cuando ≥3 tareas completadas.
        <span style={{ display: "flex", gap: 12, marginTop: 4 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "#34d399" }} />≤100%</span>
          <span style={{ display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "#fbbf24" }} />100–120%</span>
          <span style={{ display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "#f87171" }} />&gt;120%</span>
        </span>
      </div>
    </div>
  );
};

// ── SIDEBAR ──
const SB = ({ view, setView, collapsed, toggle, bcStatus, onBcSync, syncing }) => {
  const nav = [
    { key: "resumen", label: "Overview", icon: LayoutDashboard },
    { key: "kanban", label: "Kanban", icon: ListTodo },
    { key: "personas", label: "Equipo", icon: Users },
    { key: "proyectos", label: "Proyectos", icon: FolderKanban },
    { key: "benchmarks", label: "Benchmarks", icon: Target },
  ];
  const w = collapsed ? 56 : 210;
  return (
    <div style={{ width: w, minWidth: w, height: "100vh", position: "fixed", left: 0, top: 0, zIndex: 100, background: "rgba(8,12,24,0.9)", backdropFilter: "blur(20px)", borderRight: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", padding: "14px 8px", transition: "width .25s ease", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px", marginBottom: 24, cursor: "pointer" }} onClick={toggle}>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: "linear-gradient(135deg,#6366f1,#818cf8)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Layers size={16} color="#fff" /></div>
        {!collapsed && <div><div style={{ fontSize: 13, fontWeight: 800, color: "#e2e8f0", fontFamily: FD }}>Geely</div><div style={{ fontSize: 9, color: "#818cf8", fontWeight: 600 }}>Team Working Panel</div></div>}
      </div>
      {nav.map(n => {
        const a = view === n.key;
        return (
          <button key={n.key} onClick={() => setView(n.key)} style={{ display: "flex", alignItems: "center", gap: 10, padding: collapsed ? "9px" : "8px 12px", borderRadius: 10, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: a ? 600 : 400, background: a ? "rgba(129,140,248,0.12)" : "transparent", color: a ? "#818cf8" : "#64748b", marginBottom: 2, justifyContent: collapsed ? "center" : "flex-start", transition: "all .2s" }}>
            <n.icon size={16} />{!collapsed && n.label}
          </button>
        );
      })}
      <div style={{ flex: 1 }} />
      {!collapsed && (
        <div style={{ ...G.card, padding: 12, textAlign: "center", background: bcStatus?.connected ? "rgba(52,211,153,0.06)" : "rgba(129,140,248,0.05)", borderColor: bcStatus?.connected ? "rgba(52,211,153,0.12)" : "rgba(129,140,248,0.1)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, marginBottom: 4 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: bcStatus?.connected ? "#34d399" : "#f87171" }} />
            <div style={{ fontSize: 10, color: bcStatus?.connected ? "#34d399" : "#818cf8", fontWeight: 600 }}>Basecamp</div>
          </div>
          {bcStatus?.connected ? (
            <>
              <div style={{ fontSize: 9, color: "#34d399", marginBottom: 6 }}>Conectado{bcStatus.identity ? ` · ${bcStatus.identity}` : ""}</div>
              <button onClick={onBcSync} disabled={syncing}
                style={{ padding: "5px 14px", borderRadius: 8, border: "1px solid rgba(52,211,153,0.2)", background: syncing ? "rgba(52,211,153,0.1)" : "transparent", color: "#34d399", fontSize: 11, fontWeight: 600, cursor: syncing ? "wait" : "pointer", fontFamily: "inherit", width: "100%" }}>
                {syncing ? "Sincronizando..." : "Sync tareas"}
              </button>
            </>
          ) : (
            <>
              <div style={{ fontSize: 9, color: "#475569", marginBottom: 6 }}>No conectado</div>
              <a href="/api/auth/login"
                style={{ display: "block", padding: "5px 14px", borderRadius: 8, border: "1px solid rgba(129,140,248,0.2)", background: "transparent", color: "#818cf8", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", textDecoration: "none" }}>
                Conectar
              </a>
            </>
          )}
        </div>
      )}
    </div>
  );
};

// ── MAIN ──
function Dashboard() {
  const toast = useToast();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("resumen");
  const [modal, setModal] = useState(null);
  const [filters, setFilters] = useState({ miembro: "", estado: "", prioridad: "", proyecto: "", search: "" });
  const [collapsed, setCollapsed] = useState(false);
  const [bcStatus, setBcStatus] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const sf = (k, v) => setFilters(p => ({ ...p, [k]: v }));
  const filtered = useMemo(() => filt(tasks, filters), [tasks, filters]);

  // Check Basecamp connection status
  useEffect(() => {
    const checkBc = async () => {
      try {
        const res = await fetch("/api/basecamp/status");
        const data = await res.json();
        setBcStatus(data);
      } catch { setBcStatus({ connected: false }); }
    };
    checkBc();
    // Handle ?basecamp=connected redirect
    const params = new URLSearchParams(window.location.search);
    if (params.get("basecamp") === "connected") {
      toast("Basecamp conectado", "success");
      window.history.replaceState({}, "", "/");
      checkBc();
    }
    if (params.get("error")) {
      toast("Error conectando Basecamp: " + params.get("error"), "error");
      window.history.replaceState({}, "", "/");
    }
  }, []);

  // Sync Basecamp todos
  const syncBasecamp = async () => {
    if (!bcStatus?.connected) return;
    setSyncing(true);
    try {
      // Get projects first
      const projRes = await fetch("/api/basecamp/projects");
      const projects = await projRes.json();
      if (!projects.length) { toast("No se encontraron proyectos", "error"); setSyncing(false); return; }
      // Sync all projects
      let totalSynced = 0;
      for (const proj of projects) {
        const syncRes = await fetch(`/api/basecamp/sync?projectId=${proj.id}`);
        const syncData = await syncRes.json();
        totalSynced += syncData.synced || 0;
      }
      toast(`${totalSynced} tareas sincronizadas desde Basecamp`, "success");
      // Reload tasks from Supabase
      const { data } = await supabase.from("tasks").select("*").order("created_at", { ascending: false });
      if (data) setTasks(data.map(fromDB));
    } catch (err) {
      console.error(err);
      toast("Error sincronizando", "error");
    }
    setSyncing(false);
  };

  // Load tasks from Supabase + real-time subscription
  useEffect(() => {
    const loadTasks = async () => {
      const { data, error } = await supabase.from("tasks").select("*").order("created_at", { ascending: false });
      if (error) { console.error(error); toast("Error cargando tareas", "error"); }
      else setTasks(data.map(fromDB));
      setLoading(false);
    };
    loadTasks();

    const channel = supabase.channel("tasks-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, (payload) => {
        if (payload.eventType === "INSERT") {
          setTasks(p => { if (p.find(t => t.id === payload.new.id)) return p; return [fromDB(payload.new), ...p]; });
        } else if (payload.eventType === "UPDATE") {
          setTasks(p => p.map(t => t.id === payload.new.id ? fromDB(payload.new) : t));
        } else if (payload.eventType === "DELETE") {
          setTasks(p => p.filter(t => t.id !== payload.old.id));
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const save = async (t) => {
    const isNew = !tasks.find(x => x.id === t.id);
    // Optimistic update
    setTasks(p => { const i = p.findIndex(x => x.id === t.id); if (i >= 0) { const c = [...p]; c[i] = t; return c; } return [t, ...p]; });
    setModal(null);
    // Sync to Supabase
    const { error } = await supabase.from("tasks").upsert(toDB(t));
    if (error) { console.error(error); toast("Error guardando", "error"); }
    else toast(isNew ? `"${t.titulo}" creada` : `Actualizada`, "success");
  };

  const del = async (id) => {
    setTasks(p => p.filter(x => x.id !== id));
    const { error } = await supabase.from("tasks").delete().eq("id", id);
    if (error) { console.error(error); toast("Error eliminando", "error"); }
    else toast("Eliminada", "error");
  };

  const drop = async (tid, est) => {
    const st = ESTADOS.find(e => e.key === est);
    setTasks(p => p.map(x => x.id === tid ? { ...x, estado: est } : x));
    const { error } = await supabase.from("tasks").update({ estado: est, updated_at: new Date().toISOString() }).eq("id", tid);
    if (error) console.error(error);
    else toast(`→ ${st?.label}`, "info");
  };

  const af = Object.values(filters).filter(Boolean).length;
  const ml = collapsed ? 56 : 210;

  if (loading) return (
    <div style={{ background: G.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
      <Loader2 size={32} color="#818cf8" style={{ animation: "spin 1s linear infinite" }} />
      <div style={{ color: "#64748b", fontSize: 14 }}>Conectando con Supabase...</div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );

  return (
    <div style={{ background: G.bg, minHeight: "100vh", fontFamily: "'Inter',-apple-system,sans-serif", color: "#e2e8f0" }}>
      {/* BG orbs */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 0 }}>
        <div style={{ position: "absolute", width: 500, height: 500, borderRadius: "50%", background: "radial-gradient(circle,rgba(99,102,241,0.06) 0%,transparent 70%)", top: "-10%", left: "-5%" }} />
        <div style={{ position: "absolute", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle,rgba(6,182,212,0.05) 0%,transparent 70%)", top: "40%", right: "-8%" }} />
      </div>

      <SB view={view} setView={setView} collapsed={collapsed} toggle={() => setCollapsed(!collapsed)} bcStatus={bcStatus} onBcSync={syncBasecamp} syncing={syncing} />

      <div style={{ marginLeft: ml, transition: "margin .25s ease", position: "relative", zIndex: 1 }}>
        {/* Top bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(6,10,19,0.8)", backdropFilter: "blur(12px)", position: "sticky", top: 0, zIndex: 50 }}>
          <button onClick={() => setCollapsed(!collapsed)} style={{ background: "transparent", border: "none", cursor: "pointer", color: "#64748b", display: "flex", padding: 4 }}><Menu size={16} /></button>
          <div style={{ position: "relative", flex: 1, maxWidth: 280 }}>
            <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#475569" }} />
            <input value={filters.search} onChange={e => sf("search", e.target.value)} placeholder="Buscar..." style={{ ...G.inp, paddingLeft: 30, fontSize: 12, background: "rgba(255,255,255,0.03)" }} />
          </div>
          <Sel value={filters.miembro} onChange={v => sf("miembro", v)} placeholder="Miembro" options={MEMBERS.map(m => ({ v: m.id, l: m.name }))} style={{ minWidth: 130 }} />
          <Sel value={filters.estado} onChange={v => sf("estado", v)} placeholder="Estado" options={ESTADOS.map(e => ({ v: e.key, l: e.label }))} style={{ minWidth: 110 }} />
          {af > 0 && <button onClick={() => setFilters({ miembro: "", estado: "", prioridad: "", proyecto: "", search: "" })} style={{ padding: "4px 10px", borderRadius: 8, border: "1px solid rgba(248,113,113,0.15)", background: "rgba(248,113,113,0.06)", color: "#f87171", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Limpiar</button>}
          <button onClick={() => setModal("new")} style={{ marginLeft: "auto", background: "linear-gradient(135deg,#6366f1,#818cf8)", color: "#fff", border: "none", borderRadius: 10, padding: "8px 16px", fontWeight: 700, fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 5, fontFamily: "inherit" }}>
            <Plus size={14} /> Nueva tarea
          </button>
        </div>

        <div style={{ padding: "20px 20px 40px" }}>
          {view === "resumen" && <Overview tasks={af > 0 ? filtered : tasks} members={MEMBERS} />}
          {view === "kanban" && <Kanban tasks={filtered} members={MEMBERS} onDrop={drop} onEdit={t => setModal(t)} onDelete={del} />}
          {view === "personas" && <PersonView tasks={tasks} members={MEMBERS} />}
          {view === "proyectos" && (() => {
            const data = PROJECTS.map(p => { const pt = tasks.filter(t => t.proyecto === p); const c = pt.filter(t => t.estado === "completada").length; return { name: p, total: pt.length, pct: pt.length ? Math.round(c / pt.length * 100) : 0, hBm: pt.reduce((s, t) => s + (t.benchmarkHoras || 0), 0) }; }).filter(p => p.total > 0);
            if (!data.length) return <Empty icon={FolderKanban} title="Sin proyectos" sub="Aparecerán al crear tareas" />;
            return <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{data.map(p => (
              <div key={p.name} style={{ ...G.card, padding: 18 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                  <FolderKanban size={16} color="#818cf8" />
                  <div style={{ flex: 1 }}><div style={{ fontWeight: 700 }}>{p.name}</div><div style={{ fontSize: 11, color: "#475569" }}>{p.total} tareas · {p.hBm}h benchmark</div></div>
                  <Ring pct={p.pct} size={48} stroke={4} color="#818cf8" />
                </div>
                <div style={{ height: 4, background: "rgba(255,255,255,0.04)", borderRadius: 99, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${p.pct}%`, background: "linear-gradient(90deg,#6366f1,#818cf8)", borderRadius: 99 }} />
                </div>
              </div>
            ))}</div>;
          })()}
          {view === "benchmarks" && <BenchView tasks={tasks} />}
        </div>
      </div>

      {modal && <Modal task={modal === "new" ? null : modal} members={MEMBERS} allTasks={tasks} onSave={save} onClose={() => setModal(null)} />}
    </div>
  );
}

const GEELY_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
@font-face {
  font-family: 'Geely';
  src: url('/fonts/GeelySans-Bold.woff2') format('woff2'), url('/fonts/GeelySans-Bold.woff') format('woff');
  font-weight: 400 900; font-style: normal; font-display: swap;
}
body { font-family: 'Inter', -apple-system, sans-serif; background: #060a13; color: #e2e8f0; }
h1,h2,h3,h4 { font-family: 'Geely', 'Inter', -apple-system, sans-serif; }
::-webkit-scrollbar { width: 5px; height: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 4px; }
select option { background: #0c1222; color: #e2e8f0; }
`;

export default function App() {
  return <ToastProvider><style>{GEELY_CSS}</style><Dashboard /></ToastProvider>;
}
