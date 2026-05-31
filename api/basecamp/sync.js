export default async function handler(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL || "https://hqpucabkwhhjmvmxhijp.supabase.co";
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const { projectId } = req.query;

  if (!projectId) return res.status(400).json({ error: "projectId required" });

  try {
    // Get Basecamp config
    const cfgRes = await fetch(`${supabaseUrl}/rest/v1/basecamp_config?id=eq.main&select=*`, {
      headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` },
    });
    const config = (await cfgRes.json())?.[0];
    if (!config?.access_token) return res.status(401).json({ error: "Not connected" });

    const bcHeaders = {
      "Authorization": `Bearer ${config.access_token}`,
      "User-Agent": "Geely Team Panel (geely-team.vercel.app)",
    };

    // Get todosets for the project
    const projRes = await fetch(`https://3.basecampapi.com/${config.account_id}/projects/${projectId}.json`, {
      headers: bcHeaders,
    });
    const project = await projRes.json();
    const todosetDock = project.dock?.find(d => d.name === "todoset");
    if (!todosetDock?.url) return res.status(404).json({ error: "No todoset found" });

    // Get todolists
    const todosetRes = await fetch(todosetDock.url, { headers: bcHeaders });
    const todoset = await todosetRes.json();

    const todolistsRes = await fetch(`https://3.basecampapi.com/${config.account_id}/buckets/${projectId}/todosets/${todoset.id}/todolists.json`, {
      headers: bcHeaders,
    });
    const todolists = await todolistsRes.json();

    // Get all todos from all lists
    let allTodos = [];
    for (const list of todolists) {
      const todosRes = await fetch(`https://3.basecampapi.com/${config.account_id}/buckets/${projectId}/todolists/${list.id}/todos.json`, {
        headers: bcHeaders,
      });
      const todos = await todosRes.json();
      allTodos.push(...todos.map(t => ({
        ...t,
        list_name: list.name,
      })));
    }

    // Map Basecamp todos to our task format
    const tasks = allTodos.map(todo => ({
      id: `bc_${todo.id}`,
      titulo: todo.content,
      tipo_tarea: "concepto", // default, user can change later
      miembro_id: mapAssignee(todo.assignees),
      proyecto: project.name,
      fecha_inicio: todo.created_at?.split("T")[0] || new Date().toISOString().split("T")[0],
      fecha_fin: todo.due_on || new Date(Date.now() + 7 * 864e5).toISOString().split("T")[0],
      estado: todo.completed ? "completada" : (todo.assignees?.length > 0 ? "progreso" : "pendiente"),
      prioridad: "media",
      benchmark_horas: 0,
      horas_reales: 0,
      updated_at: new Date().toISOString(),
    }));

    // Upsert to Supabase
    if (tasks.length > 0) {
      const upsertRes = await fetch(`${supabaseUrl}/rest/v1/tasks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
          "Prefer": "resolution=merge-duplicates",
        },
        body: JSON.stringify(tasks),
      });

      if (!upsertRes.ok) {
        console.error("Upsert failed:", await upsertRes.text());
      }
    }

    res.status(200).json({
      synced: tasks.length,
      project: project.name,
      todolists: todolists.length,
    });

  } catch (error) {
    console.error("Sync error:", error);
    res.status(500).json({ error: error.message });
  }
}

// Map Basecamp assignees to our member IDs
function mapAssignee(assignees) {
  if (!assignees?.length) return "m1"; // default
  const name = assignees[0].name?.toLowerCase() || "";
  if (name.includes("victor") && name.includes("gal")) return "m1";
  if (name.includes("victor") && name.includes("gonz")) return "m2";
  if (name.includes("kevin")) return "m3";
  if (name.includes("raúl") || name.includes("raul")) return "m4";
  if (name.includes("sebas")) return "m5";
  return "m1"; // fallback
}
