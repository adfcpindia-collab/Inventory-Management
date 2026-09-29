import { useEffect, useState } from 'react';
import { settingsSchema } from '@inventory/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { errText } from '../components/DocPages';

export default function Settings() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole('ADMIN');
  const [threshold, setThreshold] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    api
      .get<{ conversionApprovalThreshold: number | null }>('/settings')
      .then((s) =>
        setThreshold(
          s.conversionApprovalThreshold === null ? '' : String(s.conversionApprovalThreshold),
        ),
      )
      .catch((e) => setMsg({ ok: false, text: errText(e) }));
  }, []);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const parsed = settingsSchema.safeParse({
      conversionApprovalThreshold: threshold.trim() === '' ? null : Number(threshold),
    });
    if (!parsed.success)
      return setMsg({
        ok: false,
        text: 'Enter a number greater than 0, or leave blank to disable approvals',
      });
    try {
      await api.put('/settings', parsed.data);
      setMsg({ ok: true, text: 'Settings saved.' });
    } catch (err) {
      setMsg({ ok: false, text: errText(err) });
    }
  }
  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      {msg && (
        <p
          role={msg.ok ? 'status' : 'alert'}
          className={`rounded p-2 text-sm ${msg.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}
        >
          {msg.text}
        </p>
      )}
      <form onSubmit={save} className="space-y-3 rounded-lg border bg-white p-4">
        <h2 className="font-medium">Conversion approval</h2>
        <p className="text-sm text-slate-600">
          When the total input quantity of a conversion is above this value, a store user's confirm
          is sent to a manager for approval. Leave blank to disable.
        </p>
        <label className="label" htmlFor="thr">
          Approval threshold (total input quantity)
        </label>
        <input
          id="thr"
          type="number"
          step="0.001"
          min="0"
          className="input"
          value={threshold}
          disabled={!isAdmin}
          onChange={(e) => setThreshold(e.target.value)}
        />
        {isAdmin ? (
          <button className="btn-primary">Save</button>
        ) : (
          <p className="text-sm text-slate-500">Only an admin can change settings.</p>
        )}
      </form>
    </div>
  );
}
