import express, { Request, Response } from "express";
import { privacypolicys, termsConditions } from "./settings.modal";

// Public, readable web pages for the legal texts edited in the admin dashboard.
// No login required (App Store / Play Store need a public privacy policy URL).

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string
  );

const renderPage = (title: string, bodyHtml: string, updatedAt?: Date) => {
  const updated = updatedAt
    ? `<p class="updated">Last updated: ${new Date(updatedAt).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })}</p>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} | Thrillio</title>
<meta name="description" content="${escapeHtml(title)} for the Thrillio app.">
<style>
  :root { --bg:#ffffff; --text:#1f2328; --muted:#656d76; --border:#d8dee4; --accent:#6d28d9; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0d1117; --text:#e6edf3; --muted:#8d96a0; --border:#30363d; --accent:#a78bfa; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text);
    font: 16px/1.7 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  header { border-bottom:1px solid var(--border); }
  .wrap { max-width:760px; margin:0 auto; padding:0 16px; }
  header .wrap { padding-top:18px; padding-bottom:18px; font-weight:700; font-size:20px; color:var(--accent); }
  main.wrap { padding-top:24px; padding-bottom:48px; overflow-wrap:anywhere; }
  .updated { color:var(--muted); font-size:14px; margin:0 0 24px; }
  main h1 { font-size:30px; line-height:1.25; margin:0 0 8px; }
  main h2 { font-size:22px; margin:32px 0 8px; }
  main h3 { font-size:18px; margin:24px 0 8px; }
  main a { color:var(--accent); }
  main img { max-width:100%; height:auto; }
  main table { border-collapse:collapse; width:100%; display:block; overflow-x:auto; }
  main td, main th { border:1px solid var(--border); padding:6px 10px; }
  footer { border-top:1px solid var(--border); color:var(--muted); font-size:14px; }
  footer .wrap { padding-top:16px; padding-bottom:24px; }
</style>
</head>
<body>
<header><div class="wrap">Thrillio</div></header>
<main class="wrap">
${updated}
${bodyHtml}
</main>
<footer><div class="wrap">&copy; ${new Date().getFullYear()} Thrillio</div></footer>
</body>
</html>`;
};

const sendPage = (res: Response, status: number, html: string) => {
  // The text is written by admins in the dashboard; block scripts and remote code anyway.
  res
    .status(status)
    .set({
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=300",
    })
    .send(html);
};

const legalPage =
  (title: string, load: () => Promise<{ html?: string; updatedAt?: Date } | null>) =>
  async (_req: Request, res: Response) => {
    try {
      const doc = await load();
      if (!doc?.html?.trim()) {
        return sendPage(res, 404, renderPage(title, `<h1>${title}</h1><p>This page is not available yet.</p>`));
      }
      // Admin text usually starts with its own <h1>; add one only if it is missing.
      const body = /<h1[\s>]/i.test(doc.html) ? doc.html : `<h1>${title}</h1>${doc.html}`;
      return sendPage(res, 200, renderPage(title, body, doc.updatedAt));
    } catch {
      return sendPage(res, 500, renderPage(title, `<h1>${title}</h1><p>Something went wrong. Please try again later.</p>`));
    }
  };

const loadPrivacy = async () => {
  const doc: any = await privacypolicys.findOne().select("PrivacyPolicy updatedAt").lean();
  return doc ? { html: doc.PrivacyPolicy, updatedAt: doc.updatedAt } : null;
};

const loadTerms = async () => {
  const doc: any = await termsConditions.findOne().select("TermsConditions updatedAt").lean();
  return doc ? { html: doc.TermsConditions, updatedAt: doc.updatedAt } : null;
};

const legalPagesRouter = express.Router();

legalPagesRouter.get(["/privacy-policy", "/privacy"], legalPage("Privacy Policy", loadPrivacy));
legalPagesRouter.get(
  ["/terms-and-conditions", "/terms"],
  legalPage("Terms and Conditions", loadTerms)
);

export default legalPagesRouter;
