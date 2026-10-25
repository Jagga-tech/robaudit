import api, { route, storage } from '@forge/api';

// Web trigger: one Jira issue per Summo work item. First event creates the issue; every later event is a comment,
// plus a column move. Jira is the controller's queue and the audit mirror; the ledger (SpacetimeDB) stays the system of record.
const PROJECT = process.env.JIRA_PROJECT_KEY || 'SUMMO';
const SECRET = process.env.SUMMO_WEBHOOK_SECRET || '';
// ponytail: default Kanban columns; set JIRA_TRANSITIONS='{"posted":"Done"}' to override
const COLUMN = { awaiting_clarification: 'In Progress', proposed: 'In Progress', approved: 'In Progress', posted: 'Done', returned: 'To Do', held: 'To Do', stale: 'To Do', ...JSON.parse(process.env.JIRA_TRANSITIONS || '{}') };

const p = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const code = (text) => ({ type: 'codeBlock', content: [{ type: 'text', text }] });
const adf = (lines, block) => ({ type: 'doc', version: 1, content: [...lines.filter(Boolean).map(p), ...(block ? [code(block)] : [])] });

async function jira(path, init) {
  const res = await api.asApp().requestJira(route(path), { headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, ...init });
  if (!res.ok) throw new Error(`${init?.method || 'GET'} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function moveTo(issueKey, column) {
  if (!column) return;
  const { transitions } = await jira(`/rest/api/3/issue/${issueKey}/transitions`);
  const t = transitions.find((x) => x.to?.name === column || x.name === column);
  if (t) await jira(`/rest/api/3/issue/${issueKey}/transitions`, { method: 'POST', body: JSON.stringify({ transition: { id: t.id } }) });
}

export async function handler(req) {
  if (SECRET && req.headers?.['x-summo-secret']?.[0] !== SECRET) return { statusCode: 401, body: 'bad secret' };
  let ev;
  try { ev = JSON.parse(req.body || '{}'); } catch { return { statusCode: 400, body: 'bad json' }; }
  if (!ev.workItemId || !ev.title) return { statusCode: 400, body: 'workItemId and title required' };

  const lines = [ev.headline, ev.detail, ev.explanation && `Summo: ${ev.explanation}`, ev.actor && `By: ${ev.actor}`].filter(Boolean);
  const key = `wi:${ev.workItemId}`;
  let issueKey = await storage.get(key);
  if (!issueKey) {
    const created = await jira('/rest/api/3/issue', { method: 'POST', body: JSON.stringify({ fields: {
      project: { key: PROJECT }, issuetype: { name: 'Task' },
      summary: `${ev.project ? ev.project + ': ' : ''}${ev.title}`,
      labels: ['summo', ...(ev.labels || [])],
      description: adf([`Summo work item ${ev.workItemId}. Nothing posts from here; the controller decides in the ledger and Jira mirrors it.`, ...lines], ev.entry),
    } }) });
    issueKey = created.key;
    await storage.set(key, issueKey);
  } else {
    await jira(`/rest/api/3/issue/${issueKey}/comment`, { method: 'POST', body: JSON.stringify({ body: adf(lines, ev.entry) }) });
    if (ev.labels?.length) await jira(`/rest/api/3/issue/${issueKey}`, { method: 'PUT', body: JSON.stringify({ update: { labels: ev.labels.map((l) => ({ add: l })) } }) });
  }
  await moveTo(issueKey, COLUMN[ev.status]).catch((e) => console.warn(`transition skipped: ${e.message}`));
  return { statusCode: 200, headers: { 'Content-Type': ['application/json'] }, body: JSON.stringify({ issueKey }) };
}
