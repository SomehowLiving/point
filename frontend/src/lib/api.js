const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export async function analyzeCapture(payload, onDelta, onSearchResults) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 150000);
  const response = await fetch(`${API}/captures/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: controller.signal,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || "Analysis could not start");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = null;
  const consume = (raw) => {
      const line = raw.split("\n").find((item) => item.startsWith("data: "));
      if (!line) return;
      const event = JSON.parse(line.slice(6));
      if (event.type === "delta") onDelta(event.content);
      if (event.type === "search_results") onSearchResults?.(event.results);
      if (event.type === "done") completed = event;
      if (event.type === "error") throw new Error(event.message);
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";
      for (const raw of events) consume(raw);
    }
    if (buffer.trim()) consume(buffer);
    if (!completed) throw new Error("Analysis stream ended before completion. Please retry or switch models.");
    return completed;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Analysis timed out. Please retry or switch models.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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

export async function extractOcr(payload) {
  const response = await fetch(`${API}/ocr/extract`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.detail || "OCR failed"); }
  return response.json();
}

export async function renderExport(payload) {
  const response = await fetch(`${API}/exports/render`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.detail || "Export failed"); }
  return response.json();
}

export async function sendToNotion(payload) {
  const response = await fetch(`${API}/integrations/notion/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.detail || "Sending to Notion failed"); }
  return response.json();
}

export async function createGitHubIssue(payload) {
  const response = await fetch(`${API}/integrations/github/create-issue`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.detail || "Creating the GitHub issue failed"); }
  return response.json();
}