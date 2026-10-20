import { useCallback, useEffect, useState } from 'react';
import {
  Ban, CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, KeyRound, Lightbulb, PauseCircle, Pencil, Plus,
  RefreshCw, Search, Trash2, Users,
} from 'lucide-react';
import { api } from '../utils/api.js';
import { MODES, formatDate } from '../utils/helpers.js';
import { ConfirmModal, Modal } from './Modals.jsx';

const STATUS_STYLE = {
  active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  suspended: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  blocked: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  expired: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
};
const toInputDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

function Stat({ icon: Icon, label, value, tone = 'text-blue-500' }) {
  return (
    <div className="rounded-2xl bg-white p-4 dark:bg-surface-darkside">
      <Icon size={18} className={tone} />
      <div className="mt-2 text-2xl font-semibold">{value ?? '—'}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

/* ───── Edit user modal ───── */
function EditUser({ user, onClose, onSaved }) {
  const [expiry, setExpiry] = useState(toInputDate(user?.expiryDate));
  const [daily, setDaily] = useState(user?.limits?.daily ?? 0);
  const [hourly, setHourly] = useState(user?.limits?.hourly ?? 0);
  const [role, setRole] = useState(user?.role || 'user');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!user) return;
    setExpiry(toInputDate(user.expiryDate));
    setDaily(user.limits?.daily ?? 0);
    setHourly(user.limits?.hourly ?? 0);
    setRole(user.role);
    setErr('');
  }, [user]);

  const patch = async (body) => {
    setBusy(true);
    setErr('');
    try {
      const { user: u } = await api.patch(`/admin/users/${user.id}`, body);
      onSaved(u);
      setExpiry(toInputDate(u.expiryDate));
      return u;
    } catch (e) {
      setErr(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const u = await patch({ expiryDate: expiry || null, limits: { daily: Number(daily), hourly: Number(hourly) }, role });
    if (u) onClose();
  };

  return (
    <Modal open={Boolean(user)} onClose={onClose} title={user ? `Edit ${user.name}` : ''}>
      {user && (
        <div className="space-y-5 text-sm">
          <div className="text-gray-500">{user.email}</div>

          <section>
            <div className="mb-2 flex items-center gap-2 font-medium"><CalendarClock size={16} /> Validity</div>
            <div className="flex gap-2">
              <input type="date" className="input" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
              <button className="btn-ghost shrink-0" onClick={() => setExpiry('')} title="No expiry">Lifetime</button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {[-7, 7, 30, 90, 365].map((d) => (
                <button key={d} disabled={busy} onClick={() => patch({ extendDays: d })}
                  className={`rounded-full px-3 py-1.5 text-xs ${d < 0 ? 'bg-red-50 text-red-600 dark:bg-red-900/20' : 'bg-surface-card dark:bg-surface-darkcard'}`}>
                  {d > 0 ? `+${d}` : d} days
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Quick buttons apply instantly. Current: {user.expiryDate ? formatDate(user.expiryDate) : 'Lifetime'}
            </p>
          </section>

          <section>
            <div className="mb-2 font-medium">Rate limits <span className="font-normal text-gray-500">(0 = unlimited)</span></div>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1"><span className="text-xs text-gray-500">Per hour</span>
                <input type="number" min="0" className="input" value={hourly} onChange={(e) => setHourly(e.target.value)} /></label>
              <label className="space-y-1"><span className="text-xs text-gray-500">Per day</span>
                <input type="number" min="0" className="input" value={daily} onChange={(e) => setDaily(e.target.value)} /></label>
            </div>
            <button className="mt-2 text-xs text-blue-600 hover:underline dark:text-blue-400" disabled={busy} onClick={() => patch({ resetUsage: true })}>
              Reset current usage counters ({user.usage?.hourCount || 0}/h, {user.usage?.dayCount || 0}/day)
            </button>
          </section>

          <section>
            <div className="mb-2 font-medium">Role</div>
            <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </section>

          {err && <p className="rounded-xl bg-red-50 px-3 py-2 text-red-600 dark:bg-red-900/20 dark:text-red-300">{err}</p>}
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={busy} onClick={save}>Save changes</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ───── Templates manager ───── */
function Templates() {
  const [list, setList] = useState([]);
  const [form, setForm] = useState({ title: '', prompt: '', mode: 'general', category: 'General' });
  const load = () => api.get('/templates').then((r) => setList(r.templates)).catch(() => {});
  useEffect(() => { load(); }, []);

  const add = async (e) => {
    e.preventDefault();
    if (!form.title || !form.prompt) return;
    await api.post('/admin/templates', form);
    setForm({ title: '', prompt: '', mode: 'general', category: 'General' });
    load();
  };

  return (
    <section className="mt-8 rounded-3xl bg-white p-5 dark:bg-surface-darkside">
      <h2 className="mb-4 flex items-center gap-2 font-semibold"><Lightbulb size={18} className="text-yellow-500" /> Prompt templates</h2>
      <form onSubmit={add} className="mb-4 grid gap-2 md:grid-cols-[1fr_1fr_140px_140px_auto]">
        <input className="input" placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <input className="input" placeholder="Prompt text" value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} />
        <select className="input" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
          {MODES.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
        <input className="input" placeholder="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
        <button className="btn-primary"><Plus size={16} /> Add</button>
      </form>
      <div className="grid gap-2 md:grid-cols-2">
        {list.map((t) => (
          <div key={t._id} className="flex items-start gap-3 rounded-2xl bg-surface-card p-3 text-sm dark:bg-surface-darkcard">
            <div className="min-w-0 flex-1">
              <div className="font-medium">{t.title} <span className="text-xs font-normal text-gray-500">· {t.category} · {t.mode}</span></div>
              <div className="truncate text-xs text-gray-500">{t.prompt}</div>
            </div>
            <button className="btn-icon h-8 w-8 text-red-500" onClick={async () => { await api.del(`/admin/templates/${t._id}`); load(); }}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ───── Main panel ───── */
export default function AdminPanel() {
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [toast, setToast] = useState('');

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2500); };

  const loadStats = useCallback(() => api.get('/admin/stats').then(setStats).catch(() => {}), []);
  const loadUsers = useCallback(async () => {
    const q = new URLSearchParams({ page: String(page), search, status });
    const r = await api.get(`/admin/users?${q}`);
    setUsers(r.users);
    setPages(r.pages);
  }, [page, search, status]);

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => {
    const t = setTimeout(() => { loadUsers().catch((e) => flash(e.message)); }, 250);
    return () => clearTimeout(t);
  }, [loadUsers]);

  const replaceUser = (u) => setUsers((list) => list.map((x) => (x.id === u.id ? u : x)));

  const setUserStatus = async (u, s) => {
    try {
      const { user } = await api.patch(`/admin/users/${u.id}`, { status: s });
      replaceUser(user);
      loadStats();
      flash(`${u.name} is now ${s}`);
    } catch (e) { flash(e.message); }
  };

  const remove = async (u) => {
    try {
      await api.del(`/admin/users/${u.id}`);
      setUsers((l) => l.filter((x) => x.id !== u.id));
      loadStats();
      flash('User deleted');
    } catch (e) { flash(e.message); }
  };

  return (
    <div>
      {/* stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat icon={Users} label="Total users" value={stats?.users.total} />
        <Stat icon={CheckCircle2} label="Active" value={stats?.users.active} tone="text-emerald-500" />
        <Stat icon={PauseCircle} label="Suspended" value={stats?.users.suspended} tone="text-amber-500" />
        <Stat icon={Ban} label="Blocked" value={stats?.users.blocked} tone="text-red-500" />
        <Stat icon={CalendarClock} label="Expired" value={stats?.users.expired} tone="text-gray-500" />
        <Stat icon={Lightbulb} label="Chats" value={stats?.chats} tone="text-violet-500" />
      </div>

      {/* provider pool */}
      <section className="mt-6 rounded-3xl bg-white p-5 dark:bg-surface-darkside">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold"><KeyRound size={18} className="text-blue-500" /> AI provider key pools</h2>
          <button className="btn-icon h-8 w-8" onClick={loadStats} title="Refresh"><RefreshCw size={16} /></button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {stats?.providers.map((p, i) => (
            <div key={p.provider} className="rounded-2xl bg-surface-card p-4 text-sm dark:bg-surface-darkcard">
              <div className="flex items-center justify-between">
                <span className="font-semibold capitalize">{i + 1}. {p.provider}</span>
                <span className={`h-2.5 w-2.5 rounded-full ${p.totalKeys === 0 ? 'bg-gray-400' : p.coolingDown === p.totalKeys ? 'bg-red-500' : 'bg-emerald-500'}`} />
              </div>
              <div className="mt-1 truncate font-mono text-xs text-gray-500">{p.label ? `${p.label} · ` : ''}{p.model}</div>
              <div className="mt-3 text-xs">
                {p.totalKeys} keys · {p.coolingDown} cooling down<br />
                ✓ {p.stats.success} · ✕ {p.stats.failed} · 429 {p.stats.rateLimited}
              </div>
            </div>
          ))}
        </div>
        {stats?.chains && (
          <div className="mt-5 space-y-2 rounded-2xl bg-surface-card p-4 text-xs dark:bg-surface-darkcard">
            <div className="mb-1 text-sm font-semibold">Fallback chains (tried left → right)</div>
            {Object.entries(stats.chains).map(([feature, list]) => (
              <div key={feature} className="flex flex-wrap items-center gap-1">
                <span className="w-16 font-semibold uppercase text-gray-500">{feature}</span>
                {list.map((e, i) => (
                  <span key={`${e.provider}-${e.model}`} className="flex items-center gap-1">
                    {i > 0 && <span className="text-gray-400">→</span>}
                    <span className={`rounded-full px-2 py-0.5 font-mono ${e.hasKeys ? 'bg-white dark:bg-surface-dark' : 'bg-transparent text-gray-400 line-through'}`} title={e.hasKeys ? '' : 'No keys configured — skipped'}>
                      {e.provider}{e.model && e.provider !== 'pollinations' ? `:${e.model}` : ''}
                    </span>
                  </span>
                ))}
              </div>
            ))}
            <p className="pt-1 text-gray-500">Change with CHAIN_TEXT / CHAIN_CODE / CHAIN_VISION / CHAIN_IMAGE env variables. Struck-through entries have no keys and are skipped.</p>
          </div>
        )}
        <p className="mt-3 text-xs text-gray-500">Counters reset when the server restarts. Keys are managed in your hosting environment variables.</p>
      </section>

      {/* users */}
      <section className="mt-6 rounded-3xl bg-white p-5 dark:bg-surface-darkside">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="font-semibold">Users</h2>
          <div className="flex gap-2">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input className="input w-56 py-2 pl-9" placeholder="Search name or email" value={search} onChange={(e) => { setPage(1); setSearch(e.target.value); }} />
            </div>
            <select className="input w-36 py-2" value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}>
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="blocked">Blocked</option>
              <option value="expired">Expired</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Valid until</th>
                <th className="px-3 py-2">Usage today</th>
                <th className="px-3 py-2">Joined</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const st = u.expired && u.status === 'active' ? 'expired' : u.status;
                return (
                  <tr key={u.id} className="border-t border-gray-100 dark:border-gray-800">
                    <td className="px-3 py-3">
                      <div className="font-medium">{u.name} {u.role === 'admin' && <span className="ml-1 rounded bg-blue-600 px-1.5 py-0.5 text-[10px] text-white">ADMIN</span>}</div>
                      <div className="text-xs text-gray-500">{u.email}</div>
                    </td>
                    <td className="px-3 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${STATUS_STYLE[st]}`}>{st}</span></td>
                    <td className="px-3 py-3">{u.expiryDate ? formatDate(u.expiryDate) : <span className="text-gray-500">Lifetime</span>}</td>
                    <td className="px-3 py-3 text-xs">
                      {u.usage?.dayCount || 0} / {u.limits?.daily || '∞'} <span className="text-gray-500">(hr {u.usage?.hourCount || 0}/{u.limits?.hourly || '∞'})</span>
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-500">{formatDate(u.createdAt)}</td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-1">
                        <button title="Activate" disabled={u.status === 'active'} onClick={() => setUserStatus(u, 'active')} className="btn-icon h-8 w-8 text-emerald-600 disabled:opacity-30"><CheckCircle2 size={16} /></button>
                        <button title="Suspend" disabled={u.status === 'suspended'} onClick={() => setUserStatus(u, 'suspended')} className="btn-icon h-8 w-8 text-amber-600 disabled:opacity-30"><PauseCircle size={16} /></button>
                        <button title="Block" disabled={u.status === 'blocked'} onClick={() => setUserStatus(u, 'blocked')} className="btn-icon h-8 w-8 text-red-600 disabled:opacity-30"><Ban size={16} /></button>
                        <button title="Edit validity & limits" onClick={() => setEditing(u)} className="btn-icon h-8 w-8"><Pencil size={16} /></button>
                        <button title="Delete" onClick={() => setDeleting(u)} className="btn-icon h-8 w-8 text-red-600"><Trash2 size={16} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!users.length && <tr><td colSpan={6} className="px-3 py-10 text-center text-gray-500">No users found</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2 text-sm">
          <button className="btn-icon h-8 w-8" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft size={16} /></button>
          Page {page} of {pages}
          <button className="btn-icon h-8 w-8" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}><ChevronRight size={16} /></button>
        </div>
      </section>

      <Templates />

      <EditUser user={editing} onClose={() => setEditing(null)} onSaved={(u) => { replaceUser(u); setEditing(u); loadStats(); flash('Saved'); }} />
      <ConfirmModal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => remove(deleting)}
        title="Delete user?"
        message={deleting ? `${deleting.name} (${deleting.email}) and all their chats will be permanently deleted.` : ''}
        confirmText="Delete user"
      />

      {toast && <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-gray-900 px-5 py-2.5 text-sm text-white shadow-lg dark:bg-white dark:text-black">{toast}</div>}
    </div>
  );
}
