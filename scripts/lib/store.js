// 하네스 저장소 계층: Supabase(PostgREST) 호출을 한곳에 모은다.
// 서버(src/harness-api.js)와 스크립트가 같은 인터페이스를 쓰므로, 테스트에서는 memory-store.js로 바꿔 끼운다.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET = 'agent-motions';

export function createStore(db) {
  return {
    /** 대시보드가 한 번에 그릴 수 있는 전체 상태 */
    async snapshot() {
      const [sections, widgets, agents, events, motions, tasks] = await Promise.all([
        db.select('harness_sections', 'select=*&order=sort.asc,name.asc'),
        db.select('harness_widgets', 'select=*&order=sort.asc,created_at.asc'),
        db.select('harness_agents', 'select=*&archived_at=is.null&order=name.asc'),
        db.select('harness_agent_events', 'select=*&order=id.desc&limit=200'),
        db.select('harness_agent_motions', 'select=agent_id,state,storage_path,rendered_at&storage_path=not.is.null'),
        db.select('harness_tasks', 'select=*&order=created_at.desc&limit=200'),
      ]);
      return { sections, widgets, agents, events, motions, tasks };
    },

    async getAgent(id) {
      return (await db.select('harness_agents', `select=*&${db.eq('id', id)}`))[0] ?? null;
    },

    /** 부서를 id(UUID) 또는 이름으로 찾는다 */
    async findSection(ref) {
      const col = UUID_RE.test(String(ref)) ? 'id' : 'name';
      return (await db.select('harness_sections', `select=*&${db.eq(col, ref)}`))[0] ?? null;
    },

    /** ifUpdatedAt이 있으면 그 시점 이후 바뀌지 않았을 때만 갱신한다(동시 보고 충돌 방지). 갱신된 행 목록을 돌려준다 */
    async updateAgent(id, patch, ifUpdatedAt) {
      const filter = ifUpdatedAt ? `${db.eq('id', id)}&${db.eq('updated_at', ifUpdatedAt)}` : db.eq('id', id);
      return db.update('harness_agents', filter, patch);
    },

    addEvent: (event) => db.insert('harness_agent_events', [event]),

    async createSection(row) {
      return (await db.insert('harness_sections', [row]))[0];
    },

    async deleteSection(id) {
      return (await db.remove('harness_sections', db.eq('id', id)))[0] ?? null;
    },

    /** (section_id, title)이 같으면 갱신, 없으면 추가 */
    async upsertWidget(row) {
      return (await db.upsert('harness_widgets', [row], 'section_id,title'))[0];
    },

    // --- 작업 지시 요청함 (harness_tasks) ---
    async listTasks({ agent, status, limit = 50 } = {}) {
      const q = ['select=*', 'order=created_at.asc', `limit=${limit}`];
      if (agent) q.push(db.eq('agent_id', agent));
      if (status) q.push(db.eq('status', status));
      return db.select('harness_tasks', q.join('&'));
    },
    async countQueued(agent) {
      return (await db.select('harness_tasks', `select=id&${db.eq('agent_id', agent)}&${db.eq('status', 'queued')}&limit=100`)).length;
    },
    async createTask(row) { return (await db.insert('harness_tasks', [row]))[0]; },
    async getTask(id) { return (await db.select('harness_tasks', `select=*&${db.eq('id', id)}`))[0] ?? null; },
    /** ifStatus일 때만 바꾼다(동시에 두 곳에서 가져가는 것을 막음). 바뀐 행 목록을 돌려준다 */
    async updateTask(id, patch, ifStatus) {
      return db.update('harness_tasks', `${db.eq('id', id)}&${db.eq('status', ifStatus)}`, patch);
    },
    /** 가장 오래된 대기 작업 하나를 '진행 중'으로 바꿔 돌려준다. 없으면 null */
    async claimNextTask(agent) {
      for (let i = 0; i < 3; i++) {
        const [t] = await db.select('harness_tasks', `select=*&${db.eq('agent_id', agent)}&${db.eq('status', 'queued')}&order=created_at.asc&limit=1`);
        if (!t) return null;
        const rows = await db.update('harness_tasks', `${db.eq('id', t.id)}&${db.eq('status', 'queued')}`, { status: 'claimed', claimed_at: new Date().toISOString() });
        if (rows.length) return rows[0];
      }
      return null;
    },
    /** 에이전트가 done/fail을 보고하면 진행 중이던 작업을 닫는다 */
    async closeClaimed(agent, status) {
      return db.update('harness_tasks', `${db.eq('agent_id', agent)}&${db.eq('status', 'claimed')}`, { status, closed_at: new Date().toISOString() });
    },

    /** 렌더된 모션 클립의 임시 재생 주소. 클립이 없으면 null */
    async motionUrl(agentId, state) {
      const [m] = await db.select('harness_agent_motions', `select=storage_path&${db.eq('agent_id', agentId)}&${db.eq('state', state)}`);
      const path = m?.storage_path?.replace(new RegExp(`^${BUCKET}/`), '');
      return path ? db.signStorageUrl(BUCKET, path, 3600) : null;
    },
  };
}
