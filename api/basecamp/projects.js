export default async function handler(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL || "https://hqpucabkwhhjmvmxhijp.supabase.co";
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  try {
    // Get stored token from Supabase
    const cfgRes = await fetch(`${supabaseUrl}/rest/v1/basecamp_config?id=eq.main&select=*`, {
      headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` },
    });
    const cfgData = await cfgRes.json();
    const config = cfgData?.[0];

    if (!config?.access_token) {
      return res.status(401).json({ error: "Not connected to Basecamp" });
    }

    // Fetch projects from Basecamp
    const projRes = await fetch(`https://3.basecampapi.com/${config.account_id}/projects.json`, {
      headers: {
        "Authorization": `Bearer ${config.access_token}`,
        "User-Agent": "Geely Team Panel (geely-team.vercel.app)",
      },
    });

    if (!projRes.ok) {
      const err = await projRes.text();
      return res.status(projRes.status).json({ error: "Basecamp API error", details: err });
    }

    const projects = await projRes.json();
    res.status(200).json(projects.map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      todoset_url: p.dock?.find(d => d.name === "todoset")?.url,
    })));

  } catch (error) {
    console.error("Projects error:", error);
    res.status(500).json({ error: error.message });
  }
}
