const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export async function analyzeCapture(payload, onDelta) {
  const response = await fetch(`${API}/captures/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || "Analysis could not start");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";
    for (const raw of events) {
      const line = raw.split("\n").find((item) => item.startsWith("data: "));
      if (!line) continue;
      const event = JSON.parse(line.slice(6));
      if (event.type === "delta") onDelta(event.content);
      if (event.type === "done") completed = event;
      if (event.type === "error") throw new Error(event.message);
    }
  }
  return completed;
}

export async function getCaptures(search = "") {
  const params = new URLSearchParams({ search, refresh: Date.now().toString() });
  const response = await fetch(`${API}/captures?${params}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Capture history could not be loaded");
  return response.json();
}

export async function deleteCapture(id) {
  const response = await fetch(`${API}/captures/${id}`, { method: "DELETE" });
  if (!response.ok) throw new Error("Capture could not be deleted");
}