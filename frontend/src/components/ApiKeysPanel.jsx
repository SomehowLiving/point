import { useEffect, useState } from "react";
import { Key } from "@phosphor-icons/react";
import { toast } from "sonner";
import { getSettings, saveSettings } from "@/lib/api";

const FIELDS = [
  { key: "OPENAI_API_KEY", label: "OpenAI", hint: "Used by the GPT-5.5 model", url: "https://platform.openai.com/api-keys" },
  { key: "GEMINI_API_KEY", label: "Google Gemini", hint: "Used by Gemini 3.1 Pro", url: "https://aistudio.google.com/apikey" },
  { key: "OPENROUTER_API_KEY", label: "OpenRouter", hint: "Used by the OpenRouter model", url: "https://openrouter.ai/keys" },
  { key: "GROQ_API_KEY", label: "Groq", hint: "Used by the Groq model", url: "https://console.groq.com/keys" },
  { key: "NOTION_API_KEY", label: "Notion", hint: "Optional, for Send to Notion", url: "https://www.notion.so/my-integrations" },
  { key: "GITHUB_PAT_TOKEN", label: "GitHub", hint: "Optional, for Create GitHub issue (Issues: read & write)", url: "https://github.com/settings/personal-access-tokens" },
];

// Keys are sent to the backend running on this machine and saved there; the page never reads a
// saved key back, only whether one is set.
export function ApiKeysPanel() {
  const [status, setStatus] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getSettings().then((data) => setStatus(data.keys)).catch((err) => setError(err.message));
  }, []);

  const save = async (changes) => {
    setSaving(true);
    try {
      const data = await saveSettings(changes);
      setStatus(data.keys);
      setDrafts((current) => { const next = { ...current }; Object.keys(changes).forEach((key) => delete next[key]); return next; });
      toast.success("Saved");
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  };

  const pending = Object.fromEntries(Object.entries(drafts).filter(([, value]) => value.trim()));
  const anyModelKey = status && FIELDS.slice(0, 4).some(({ key }) => status[key]?.configured);

  return (
    <div className="api-keys" data-testid="api-keys-panel">
      <div className="api-keys-head">
        <Key />
        <div>
          <strong>API keys</strong>
          <p>Point uses your own AI provider key. Keys are stored only on this computer. {status && !anyModelKey && <b className="api-keys-warn">Add at least one model key to start asking.</b>}</p>
        </div>
      </div>
      {error && <p className="api-keys-error" data-testid="api-keys-error">{error}</p>}
      {status && FIELDS.map(({ key, label, hint, url }) => {
        const current = status[key];
        return (
          <label key={key} className="api-key-row" data-testid={`api-key-row-${key}`}>
            <span className="api-key-label"><b>{label}</b><small>{hint} · <a href={url} target="_blank" rel="noreferrer">get a key</a></small></span>
            <input
              type="password" autoComplete="off" spellCheck="false"
              placeholder={current.configured ? `Saved (${current.hint})${current.source === "environment" ? " from .env" : ""}` : "Paste key"}
              value={drafts[key] || ""} onChange={(event) => setDrafts((d) => ({ ...d, [key]: event.target.value }))}
              data-testid={`api-key-input-${key}`}
            />
            {current.source === "settings" && <button type="button" onClick={() => save({ [key]: "" })} disabled={saving} data-testid={`api-key-remove-${key}`}>Remove</button>}
          </label>
        );
      })}
      {status && <button className="api-keys-save" type="button" disabled={saving || !Object.keys(pending).length} onClick={() => save(pending)} data-testid="api-keys-save-button">{saving ? "Saving…" : "Save keys"}</button>}
    </div>
  );
}
