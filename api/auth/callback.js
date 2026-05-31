export default async function handler(req, res) {
  const { code } = req.query;
  
  if (!code) {
    return res.redirect(302, "/?error=no_code");
  }

  const clientId = process.env.BASECAMP_CLIENT_ID;
  const clientSecret = process.env.BASECAMP_CLIENT_SECRET;
  const redirectUri = process.env.BASECAMP_REDIRECT_URI || "https://geely-team.vercel.app/api/auth/callback";
  const supabaseUrl = process.env.SUPABASE_URL || "https://hqpucabkwhhjmvmxhijp.supabase.co";
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  try {
    // Exchange code for token
    const tokenRes = await fetch("https://launchpad.37signals.com/authorization/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "web_server",
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code: code,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error("Token exchange failed:", err);
      return res.redirect(302, "/?error=token_failed");
    }

    const tokenData = await tokenRes.json();
    const { access_token, refresh_token, expires_in } = tokenData;
    const expires_at = new Date(Date.now() + expires_in * 1000).toISOString();

    // Get account info (to find the account ID)
    const authRes = await fetch("https://launchpad.37signals.com/authorization.json", {
      headers: { "Authorization": `Bearer ${access_token}` },
    });
    const authData = await authRes.json();
    
    // Find the Basecamp 4 or 3 account
    const bcAccount = authData.accounts?.find(a => a.product === "bc3" || a.product === "bc4") || authData.accounts?.[0];
    const account_id = bcAccount?.id?.toString() || "";

    // Store in Supabase
    const upsertRes = await fetch(`${supabaseUrl}/rest/v1/basecamp_config`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Prefer": "resolution=merge-duplicates",
      },
      body: JSON.stringify({
        id: "main",
        access_token,
        refresh_token,
        account_id,
        expires_at,
        updated_at: new Date().toISOString(),
      }),
    });

    if (!upsertRes.ok) {
      console.error("Supabase upsert failed:", await upsertRes.text());
    }

    // Redirect back to dashboard with success
    res.redirect(302, "/?basecamp=connected");

  } catch (error) {
    console.error("OAuth callback error:", error);
    res.redirect(302, "/?error=callback_failed");
  }
}
