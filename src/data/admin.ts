export type MemberStatus = "Active" | "Suspended" | "Disabled";
export type InviteStatus = "Pending" | "Accepted" | "Expired" | "Revoked";
export const members = [
  { id: 1, name: "Koko Fibo", email: "koko@kokofibo.com", status: "Active" as MemberStatus, quotaGB: 100, usedGB: 48.2, created: "2026-01-12", last: "Today" },
  { id: 2, name: "Sarah Wijaya", email: "sarah@example.com", status: "Active" as MemberStatus, quotaGB: 50, usedGB: 31.4, created: "2026-03-02", last: "2 days ago" },
  { id: 3, name: "Dimas Pratama", email: "dimas@example.com", status: "Active" as MemberStatus, quotaGB: 50, usedGB: 12.9, created: "2026-03-02", last: "Yesterday" },
  { id: 4, name: "Nadia Kusuma", email: "nadia@example.com", status: "Suspended" as MemberStatus, quotaGB: 20, usedGB: 19.6, created: "2026-05-18", last: "3 weeks ago" },
  { id: 5, name: "Arya Pratama", email: "arya@example.com", status: "Active" as MemberStatus, quotaGB: 20, usedGB: 3.1, created: "2026-09-30", last: "5 days ago" },
];
export const invites = [
  { id: 1, email: "lina@example.com", quotaGB: 20, status: "Pending" as InviteStatus, created: "2026-11-03", expires: "2026-11-10", accepted: "" },
  { id: 2, email: "arya@example.com", quotaGB: 20, status: "Accepted" as InviteStatus, created: "2026-09-28", expires: "2026-10-05", accepted: "2026-09-30" },
  { id: 3, email: "budi@example.com", quotaGB: 50, status: "Expired" as InviteStatus, created: "2026-10-01", expires: "2026-10-08", accepted: "" },
  { id: 4, email: "mira@example.com", quotaGB: 20, status: "Revoked" as InviteStatus, created: "2026-10-12", expires: "2026-10-19", accepted: "" },
];
export const statusStyle: Record<string, string> = { Active: "bg-emerald-500/15 text-emerald-600", Accepted: "bg-emerald-500/15 text-emerald-600", Pending: "bg-amber-500/15 text-amber-600", Suspended: "bg-amber-500/15 text-amber-600", Expired: "bg-slate-500/15 text-muted", Revoked: "bg-red-500/15 text-red-600", Disabled: "bg-red-500/15 text-red-600" };
