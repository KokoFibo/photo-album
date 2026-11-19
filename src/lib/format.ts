const GB = 1073741824, MB = 1048576;
export const bytes = (n: number) => (n >= GB ? `${(n / GB).toFixed(2)} GB` : n >= MB ? `${(n / MB).toFixed(1)} MB` : `${Math.round((n || 0) / 1024)} KB`);
export const when = (d: string | null) => (d ? new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
export const ago = (d: string | null) => {
  if (!d) return "never";
  const m = Math.round((Date.now() - +new Date(d)) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};
