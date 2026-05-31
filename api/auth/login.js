export default function handler(req, res) {
  const clientId = process.env.BASECAMP_CLIENT_ID;
  const redirectUri = process.env.BASECAMP_REDIRECT_URI || "https://geely-team.vercel.app/api/auth/callback";
  
  const authUrl = `https://launchpad.37signals.com/authorization/new?type=web_server&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  
  res.redirect(302, authUrl);
}
