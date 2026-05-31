export default async function handler(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL || "https://hqpucabkwhhjmvmxhijp.supabase.co";
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  try {
    const cfgRes = await fetch(`${supabaseUrl}/rest/v1/basecamp_config?id=eq.main&select=*`, {
      headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` },
    });
    const config = (await cfgRes.json())?.[0];

    if (!config?.access_token) {
      return res.status(200).json({ connected: false });
    }

    // Verify token is still valid
    const authRes = await fetch("https://launchpad.37signals.com/authorization.json", {
      headers: { "Authorization": `Bearer ${config.access_token}` },
    });

    if (authRes.ok) {
      const data = await authRes.json();
      return res.status(200).json({
        connected: true,
        identity: data.identity?.first_name,
        account_id: config.account_id,
      });
    }

    // Token expired — try refresh
    if (config.refresh_token) {
      const clientId = process.env.BASECAMP_CLIENT_ID;
      const clientSecret = process.env.BASECAMP_CLIENT_SECRET;
      const redirectUri = process.env.BASECAMP_REDIRECT_URI || "https://geely-team.vercel.app/api/auth/callback";

      const refreshRes = await fetch("https://launchpad.37signals.com/authorization/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "refresh",
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: config.refresh_token,
        }),
      });

      if (refreshRes.ok) {
        const newToken = await refreshRes.json();
        // Update in Supabase
        await fetch(`${supabaseUrl}/rest/v1/basecamp_config?id=eq.main`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({
            access_token: newToken.access_token,
            expires_at: new Date(Date.now() + newToken.expires_in * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          }),
        });
        return res.status(200).json({ connected: true, refreshed: true });
      }
    }

    return res.status(200).json({ connected: false, reason: "token_expired" });

  } catch (error) {
    console.error("Status check error:", error);
    res.status(200).json({ connected: false, error: error.message });
  }
}
