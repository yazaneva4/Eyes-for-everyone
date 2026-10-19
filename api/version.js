export default function handler(_req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.status(200).json({ revision: process.env.VERCEL_GIT_COMMIT_SHA || null });
}
