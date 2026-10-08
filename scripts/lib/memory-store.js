// store.js와 같은 인터페이스를 메모리로 구현한다. 테스트와 로컬 미리보기(scripts/dev-harness.js) 전용.
import { randomUUID } from 'node:crypto';
import { SupabaseError } from './supabase.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clone = (v) => structuredClone(v);

export function createMemoryStore({ sections = [], agents = [], widgets = [], motions = [], tasks = [], admins = [] } = {}) {
  let tick = 0;
  let eventId = 0;
  const stamp = () => new Date(Date.now() + tick++).toISOString(); // 호출마다 달라지는 updated_at
  const db = {
    sections: sections.map((s) => ({ id: randomUUID(), parent_id: null, pose: 'idle', color: 'lavender', status: 'live', sort: 0, created_at: stamp(), ...s })),
    agents: agents.map((a) => ({ steps: [], progress: 0, status: 'waiting', task: '', note: '', section_id: null, archived_at: null, last_report_at: null, created_at: stamp(), updated_at: stamp(), ...a })),
    widgets: widgets.map((w) => ({ id: randomUUID(), size: null, sort: 0, data: {}, created_at: stamp(), updated_at: stamp(), ...w })),
    events: [],
    tasks: tasks.map((t) => ({ id: randomUUID(), status: 'queued', created_at: stamp(), claimed_at: null, closed_at: null, ...t })),
    motions: motions.slice(),
    admins: admins.map((a) => ({ ...a })),
  };
  const sectionBy = (ref) => db.sections.find((s) => (UUID_RE.test(String(ref)) ? s.id === ref : s.name === ref));

  return {
    _db: db, // 테스트에서 상태를 직접 확인할 때만 사용
    async snapshot() {
      return clone({
        sections: db.sections, widgets: db.widgets, agents: db.agents.filter((a) => !a.archived_at),
        events: db.events.slice().sort((a, b) => b.id - a.id).slice(0, 200),
        motions: db.motions.filter((m) => m.storage_path),
        tasks: db.tasks.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 200),
      });
    },
    async getAgent(id) { return clone(db.agents.find((a) => a.id === id) ?? null); },
    async findSection(ref) { return clone(sectionBy(ref) ?? null); },
    async updateAgent(id, patch, ifUpdatedAt) {
      const a = db.agents.find((x) => x.id === id);
      if (!a || (ifUpdatedAt && a.updated_at !== ifUpdatedAt)) return [];
      Object.assign(a, clone(patch), { updated_at: stamp() });
      return [clone(a)];
    },
    async addEvent(event) { const e = { id: ++eventId, created_at: stamp(), ...clone(event) }; db.events.push(e); return [clone(e)]; },
    async createSection(row) {
      if (db.sections.some((s) => s.name === row.name)) throw new SupabaseError('duplicate key value violates unique constraint', 409, '23505');
      const s = { id: randomUUID(), parent_id: null, pose: 'idle', color: 'lavender', status: 'live', sort: 0, created_at: stamp(), ...row };
      db.sections.push(s);
      return clone(s);
    },
    async deleteSection(id) {
      const s = db.sections.find((x) => x.id === id);
      if (!s) return null;
      db.sections = db.sections.filter((x) => x !== s);
      db.sections.forEach((x) => { if (x.parent_id === id) x.parent_id = null; });
      db.agents.forEach((a) => { if (a.section_id === id) a.section_id = null; });
      db.widgets = db.widgets.filter((w) => w.section_id !== id);
      return clone(s);
    },
    async upsertWidget(row) {
      const cur = db.widgets.find((w) => w.section_id === row.section_id && w.title === row.title);
      if (cur) { Object.assign(cur, clone(row), { updated_at: stamp() }); return clone(cur); }
      const w = { id: randomUUID(), size: null, sort: 0, data: {}, created_at: stamp(), updated_at: stamp(), ...clone(row) };
      db.widgets.push(w);
      return clone(w);
    },
    async listTasks({ agent, status, limit = 50 } = {}) {
      return clone(db.tasks.filter((t) => (!agent || t.agent_id === agent) && (!status || t.status === status)).sort((a, b) => (a.created_at < b.created_at ? -1 : 1)).slice(0, limit));
    },
    async getAdmin(username) { const a = db.admins.find((x) => x.username === username); return a ? { username: a.username, password_hash: a.password_hash } : null; },
    async countAdmins() { return db.admins.length; },
    async upsertAdmin(username, passwordHash) {
      const a = db.admins.find((x) => x.username === username);
      if (a) a.password_hash = passwordHash; else db.admins.push({ username, password_hash: passwordHash });
      return { username };
    },
    async countQueued(agent) { return db.tasks.filter((t) => t.agent_id === agent && t.status === 'queued').length; },
    async createTask(row) { const t = { id: randomUUID(), status: 'queued', created_at: stamp(), claimed_at: null, closed_at: null, ...clone(row) }; db.tasks.push(t); return clone(t); },
    async getTask(id) { return clone(db.tasks.find((t) => t.id === id) ?? null); },
    async updateTask(id, patch, ifStatus) {
      const t = db.tasks.find((x) => x.id === id && x.status === ifStatus);
      if (!t) return [];
      Object.assign(t, clone(patch));
      return [clone(t)];
    },
    async claimNextTask(agent) {
      const t = db.tasks.filter((x) => x.agent_id === agent && x.status === 'queued').sort((a, b) => (a.created_at < b.created_at ? -1 : 1))[0];
      if (!t) return null;
      Object.assign(t, { status: 'claimed', claimed_at: new Date().toISOString() });
      return clone(t);
    },
    async closeClaimed(agent, status) {
      const rows = db.tasks.filter((x) => x.agent_id === agent && x.status === 'claimed');
      rows.forEach((t) => Object.assign(t, { status, closed_at: new Date().toISOString() }));
      return clone(rows);
    },
    async motionUrl(agentId, state) {
      const m = db.motions.find((x) => x.agent_id === agentId && x.state === state && x.storage_path);
      return m ? `https://storage.example.test/${m.storage_path}?token=signed` : null;
    },
  };
}
