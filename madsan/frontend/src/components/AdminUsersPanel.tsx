"use client";

/** Admin user management: list, create, role/active toggle, password reset, session revoke. */
import { useCallback, useEffect, useState } from "react";
import { authFetchOpts } from "@/lib/auth";
import { apiBase } from "@/lib/layers";

type AdminUser = {
  id: string;
  email: string;
  display_name?: string;
  is_active: boolean;
  role: string;
  tenant?: string | null;
  created_at?: string;
  active_sessions?: number;
  last_activity?: string | null;
};

const ROLES = ["viewer", "broker", "analyst", "admin", "owner"] as const;

const inputStyle: React.CSSProperties = {
  padding: 7,
  fontSize: 12,
  background: "var(--bg)",
  border: "1px solid var(--border)",
  color: "var(--text)",
};

export default function AdminUsersPanel() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [msg, setMsg] = useState("");
  const [forbidden, setForbidden] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<string>("viewer");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch(`${apiBase()}/api/admin/users`, authFetchOpts);
    if (res.status === 403) {
      setForbidden(true);
      return;
    }
    if (!res.ok) return;
    const data = await res.json();
    setUsers((data.users ?? []) as AdminUser[]);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function createUser() {
    setMsg("");
    setBusy(true);
    const res = await fetch(`${apiBase()}/api/admin/users`, {
      ...authFetchOpts,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: newEmail, password: newPassword, display_name: newName, role: newRole }),
    });
    setBusy(false);
    if (!res.ok) {
      setMsg(await res.text());
      return;
    }
    setMsg(`User ${newEmail} created (${newRole}).`);
    setNewEmail("");
    setNewName("");
    setNewPassword("");
    await refresh();
  }

  async function patchUser(id: string, patch: Record<string, unknown>) {
    setMsg("");
    const res = await fetch(`${apiBase()}/api/admin/users/${id}`, {
      ...authFetchOpts,
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      setMsg(await res.text());
      return;
    }
    await refresh();
  }

  async function resetPassword(u: AdminUser) {
    const pw = prompt(`New password for ${u.email} (min 8 chars):`);
    if (!pw) return;
    setMsg("");
    const res = await fetch(`${apiBase()}/api/admin/users/${u.id}/reset-password`, {
      ...authFetchOpts,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    setMsg(res.ok ? `Password reset for ${u.email}; all sessions revoked.` : await res.text());
  }

  async function revokeSessions(u: AdminUser) {
    setMsg("");
    const res = await fetch(`${apiBase()}/api/admin/users/${u.id}/revoke-sessions`, {
      ...authFetchOpts,
      method: "POST",
    });
    if (res.ok) {
      const data = await res.json();
      setMsg(`Revoked ${data.sessions ?? 0} session(s) for ${u.email}.`);
      await refresh();
    } else {
      setMsg(await res.text());
    }
  }

  if (forbidden) {
    return <p style={{ color: "var(--muted)", fontSize: 12 }}>User management requires an admin role.</p>;
  }

  return (
    <div>
      <h2 style={{ fontSize: 15, margin: "0 0 8px" }}>Users &amp; access</h2>
      {msg && <p style={{ fontSize: 12, color: "var(--accent)" }}>{msg}</p>}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
        <input placeholder="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} style={{ ...inputStyle, width: 180 }} />
        <input placeholder="display name" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ ...inputStyle, width: 140 }} />
        <input placeholder="password (min 8)" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} style={{ ...inputStyle, width: 140 }} />
        <select value={newRole} onChange={(e) => setNewRole(e.target.value)} style={inputStyle}>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <button
          type="button"
          onClick={createUser}
          disabled={busy || !newEmail || newPassword.length < 8}
          style={{ padding: "7px 14px", fontSize: 12, background: "var(--accent)", color: "#000", border: 0, fontWeight: 600, cursor: "pointer" }}
        >
          Add user
        </button>
      </div>

      <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", color: "var(--muted)" }}>
            <th style={{ padding: "4px 6px" }}>Email</th>
            <th style={{ padding: "4px 6px" }}>Name</th>
            <th style={{ padding: "4px 6px" }}>Role</th>
            <th style={{ padding: "4px 6px" }}>Status</th>
            <th style={{ padding: "4px 6px" }}>Sessions</th>
            <th style={{ padding: "4px 6px" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} style={{ borderTop: "1px solid var(--border)" }}>
              <td style={{ padding: "6px" }}>{u.email}</td>
              <td style={{ padding: "6px", color: "var(--muted)" }}>{u.display_name || "—"}</td>
              <td style={{ padding: "6px" }}>
                <select
                  value={u.role}
                  onChange={(e) => void patchUser(u.id, { role: e.target.value })}
                  style={{ ...inputStyle, padding: 4 }}
                >
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </td>
              <td style={{ padding: "6px" }}>
                <span className={`badge ${u.is_active ? "verified" : "warn"}`}>{u.is_active ? "active" : "disabled"}</span>
              </td>
              <td style={{ padding: "6px", color: "var(--muted)" }}>{u.active_sessions ?? 0}</td>
              <td style={{ padding: "6px", whiteSpace: "nowrap" }}>
                <button
                  type="button"
                  onClick={() => void patchUser(u.id, { is_active: !u.is_active })}
                  style={{ marginRight: 6, padding: "3px 8px", fontSize: 11, background: "var(--bg)", border: "1px solid var(--border)", color: u.is_active ? "#f87171" : "var(--accent)", cursor: "pointer" }}
                >
                  {u.is_active ? "Disable" : "Enable"}
                </button>
                <button
                  type="button"
                  onClick={() => void resetPassword(u)}
                  style={{ marginRight: 6, padding: "3px 8px", fontSize: 11, background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)", cursor: "pointer" }}
                >
                  Reset pw
                </button>
                <button
                  type="button"
                  onClick={() => void revokeSessions(u)}
                  style={{ padding: "3px 8px", fontSize: 11, background: "var(--bg)", border: "1px solid var(--border)", color: "var(--muted)", cursor: "pointer" }}
                >
                  Sign out
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ color: "var(--muted)", fontSize: 11, marginTop: 8 }}>
        Disabling a user revokes all their sessions immediately. Password resets force re-login on every device.
      </p>
    </div>
  );
}
