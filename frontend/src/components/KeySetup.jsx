import { useState } from "react";
import { ArrowSquareOut, CheckCircle, Key, SpinnerGap } from "@phosphor-icons/react";
import { saveSettings, testKey } from "@/lib/api";
import { openExternal } from "@/lib/native";

// First-run setup: Point uses the user's own AI key (BYOK). One screen, three steps: pick a
// provider, open its key page, paste the key. The key is checked with the provider before it's
// saved, so a typo is caught here instead of as a failed answer later.
export const PROVIDERS = [
  { id: "gemini", name: "Google Gemini", env: "GEMINI_API_KEY", model: "gemini-3.1-pro-preview", url: "https://aistudio.google.com/apikey", note: "Free key in a minute. Free tier: a limited number of questions a day, and Google may use them to improve its products", recommended: true },
  { id: "openai", name: "OpenAI", env: "OPENAI_API_KEY", model: "gpt-5.5", url: "https://platform.openai.com/api-keys", note: "Pay as you go" },
  { id: "groq", name: "Groq", env: "GROQ_API_KEY", model: "groq", url: "https://console.groq.com/keys", note: "Free tier is small for screenshots" },
  { id: "openrouter", name: "OpenRouter", env: "OPENROUTER_API_KEY", model: "openrouter", url: "https://openrouter.ai/keys", note: "Many models, needs credit" },
];

export function KeySetup({ onDone, compact = false }) {
  const [provider, setProvider] = useState(PROVIDERS[0]);
  const [key, setKey] = useState("");
  const [status, setStatus] = useState(null); // {ok, message} | "testing"

  const connect = async () => {
    if (!key.trim()) return;
    setStatus("testing");
    const result = await testKey(provider.id, key.trim()).catch(() => ({ ok: false, message: "Couldn't reach Point's backend." }));
    if (!result.ok) { setStatus(result); return; }
    try {
      await saveSettings({ [provider.env]: key.trim() });
      setStatus({ ok: true, message: "Connected." });
      setKey("");
      onDone?.(provider.model);
    } catch (error) {
      setStatus({ ok: false, message: error.message });
    }
  };

  return (
    <div className={`key-setup ${compact ? "compact" : ""}`} data-testid="key-setup">
      <div className="key-setup-head">
        <Key weight="duotone" />
        <div>
          <strong>Connect an AI model</strong>
          <p>Point uses your own API key. It stays on this computer, and screenshots go only to the provider you pick.</p>
        </div>
      </div>
      <div className="key-setup-providers" role="radiogroup" aria-label="AI provider">
        {PROVIDERS.map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={provider.id === p.id} className={provider.id === p.id ? "selected" : ""}
            onClick={() => { setProvider(p); setStatus(null); }} data-testid={`key-provider-${p.id}`}>
            <b>{p.name}{p.recommended && <em>Recommended</em>}</b>
            <span>{p.note}</span>
          </button>
        ))}
      </div>
      <ol className="key-setup-steps">
        <li>
          <span>Get a key from {provider.name}</span>
          <button type="button" className="key-setup-link" onClick={() => openExternal(provider.url)} data-testid="key-get-link">
            Open key page <ArrowSquareOut />
          </button>
        </li>
        <li>
          <span>Paste it here</span>
          <div className="key-setup-input">
            <input type="password" autoComplete="off" spellCheck="false" value={key} placeholder={`${provider.name} API key`}
              onChange={(event) => { setKey(event.target.value); setStatus(null); }}
              onKeyDown={(event) => event.key === "Enter" && connect()} data-testid="key-input" autoFocus />
            <button type="button" onClick={connect} disabled={!key.trim() || status === "testing"} data-testid="key-connect-button">
              {status === "testing" ? <><SpinnerGap className="spin" /> Checking…</> : "Connect"}
            </button>
          </div>
        </li>
      </ol>
      {status && status !== "testing" && (
        <p className={`key-setup-status ${status.ok ? "ok" : "error"}`} data-testid="key-status">
          {status.ok && <CheckCircle weight="fill" />}{status.message}
        </p>
      )}
    </div>
  );
}
