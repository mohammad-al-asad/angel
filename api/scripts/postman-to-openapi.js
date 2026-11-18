/**
 * Generates src/docs/openapi.json from angel-backend.postman_collection.json.
 * Usage: node scripts/postman-to-openapi.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const collection = require(path.join(ROOT, 'angel-backend.postman_collection.json'));
const OUT = path.join(ROOT, 'src', 'docs', 'openapi.json');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const SENSITIVE_KEY = /pass(word)?|token|secret|fcm|otp|code/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Remove // and /* */ comments outside of strings so commented-out JSON parses.
function stripComments(text) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inStr) {
      out += ch;
      if (ch === '\\') { out += next ?? ''; i++; }
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; out += ch; continue; }
    if (ch === '/' && next === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    if (ch === '/' && next === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++; continue; }
    out += ch;
  }
  return out.replace(/,(\s*[}\]])/g, '$1'); // trailing commas
}

function tryJson(text) {
  if (typeof text !== 'string' || !text.trim()) return undefined;
  try { return JSON.parse(stripComments(text)); } catch { return undefined; }
}

// Replace real credentials / emails with placeholders.
function sanitize(value, key = '') {
  if (Array.isArray(value)) return value.map((v) => sanitize(v));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitize(v, k)]));
  }
  if (typeof value === 'string') {
    if (SENSITIVE_KEY.test(key)) return 'string';
    if (EMAIL.test(value)) return 'user@example.com';
    // API keys embedded in URLs (e.g. Google Maps ...&key=AIza...)
    return value.replace(/([?&]key=)[^&"s]+/gi, '$1<API_KEY>');
  }
  return value;
}

function schemaFromExample(value) {
  if (Array.isArray(value)) return { type: 'array', items: value.length ? schemaFromExample(value[0]) : {} };
  if (value === null) return { nullable: true };
  if (typeof value === 'object') {
    return { type: 'object', properties: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, schemaFromExample(v)])) };
  }
  if (typeof value === 'number') return { type: Number.isInteger(value) ? 'integer' : 'number' };
  if (typeof value === 'boolean') return { type: 'boolean' };
  return { type: 'string' };
}

function urlParts(url) {
  const raw = typeof url === 'string' ? url : url?.raw;
  if (!raw) return null;
  const [pathPart, queryPart = ''] = raw.replace(/^\{\{[^}]+\}\}/, '').replace(/^https?:\/\/[^/]+/, '').split('?');
  const query = (typeof url === 'object' && url.query) ||
    queryPart.split('&').filter(Boolean).map((kv) => { const [key, value = ''] = kv.split('='); return { key, value }; });
  return { path: pathPart, query };
}

function buildPath(rawPath, folder) {
  const params = [];
  const segments = rawPath.split('/').map((seg, idx, all) => {
    if (seg === 'cs_test_xxx') { params.push({ name: 'sessionId', in: 'path', required: true, schema: { type: 'string' }, description: 'Stripe Checkout Session id (from the success redirect)' }); return '{sessionId}'; }
    if (OBJECT_ID.test(seg) || seg === 'messageId') {
      const prev = all[idx - 1] || '';
      const name = seg === 'messageId' ? 'messageId' : 'id';
      params.push({ name, in: 'path', required: true, schema: { type: 'string' }, example: OBJECT_ID.test(seg) ? seg : undefined, description: `ID used by ${prev || folder}` });
      return `{${name}}`;
    }
    return seg;
  });
  return { path: segments.join('/'), params };
}

function requestBody(body) {
  if (!body || !body.mode) return undefined;
  if (body.mode === 'raw') {
    const parsed = tryJson(body.raw);
    if (parsed === undefined) return undefined;
    const example = sanitize(parsed);
    return { content: { 'application/json': { schema: schemaFromExample(example), example } } };
  }
  if (body.mode === 'formdata' || body.mode === 'urlencoded') {
    const fields = (body[body.mode] || []).filter((f) => f.key && !f.disabled);
    if (!fields.length) return undefined;
    const properties = {};
    for (const f of fields) {
      if (f.type === 'file') {
        properties[f.key] = { type: 'string', format: 'binary' };
      } else {
        const parsed = tryJson(f.value);
        properties[f.key] = {
          type: 'string',
          description: parsed !== undefined ? 'JSON string' : f.description,
          example: parsed !== undefined ? JSON.stringify(sanitize(parsed), null, 2) : sanitize(f.value ?? '', f.key),
        };
      }
    }
    const type = body.mode === 'formdata' ? 'multipart/form-data' : 'application/x-www-form-urlencoded';
    return { content: { [type]: { schema: { type: 'object', properties } } } };
  }
  return undefined;
}

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'Angel (Thrillio) Backend API',
    version: '1.0.0',
    description:
      'Generated from angel-backend.postman_collection.json. Authenticated endpoints expect the raw JWT ' +
      '(no "Bearer" prefix) in the Authorization header — get one from POST /api/v1/auth/login_user.',
  },
  servers: [{ url: '/', description: 'This server' }],
  components: {
    securitySchemes: { Authorization: { type: 'apiKey', in: 'header', name: 'Authorization' } },
  },
  tags: [],
  paths: {},
};

const seenTags = new Set();
const usedOperationIds = new Set();
let count = 0;

function walk(items, folders) {
  for (const item of items) {
    if (item.item) { walk(item.item, [...folders, item.name]); continue; }
    const req = item.request;
    const parts = req && urlParts(req.url);
    if (!parts || !parts.path) continue;

    const tag = folders[0] || 'misc';
    if (!seenTags.has(tag)) { seenTags.add(tag); spec.tags.push({ name: tag }); }

    const { path: oaPath, params } = buildPath(parts.path, tag);
    const method = req.method.toLowerCase();
    spec.paths[oaPath] ??= {};
    if (spec.paths[oaPath][method]) continue; // duplicate request in collection

    const queryParams = parts.query.filter((q) => q.key && !q.disabled).map((q) => ({
      name: q.key, in: 'query', required: false, schema: { type: 'string' }, example: decodeURIComponent(q.value || ''),
    }));
    const needsAuth = (req.header || []).some((h) => /authorization/i.test(h.key) && !h.disabled);

    let opId = `${tag}_${item.name}`.replace(/[^A-Za-z0-9_]/g, '_');
    while (usedOperationIds.has(opId)) opId += '_';
    usedOperationIds.add(opId);

    const op = {
      tags: [tag],
      summary: item.name,
      operationId: opId,
      parameters: [...params, ...queryParams],
      responses: { 200: { description: 'Success' }, 400: { description: 'Bad request' }, 401: { description: 'Unauthorized' } },
    };
    if (typeof req.description === 'string' && req.description) op.description = req.description;
    if (needsAuth) op.security = [{ Authorization: [] }];
    const rb = requestBody(req.body);
    if (rb && method !== 'get') op.requestBody = rb;
    if (!op.parameters.length) delete op.parameters;

    spec.paths[oaPath][method] = op;
    count++;
  }
}

walk(collection.item, []);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(spec, null, 2) + '\n');
console.log(`Wrote ${count} operations across ${Object.keys(spec.paths).length} paths to ${path.relative(ROOT, OUT)}`);
