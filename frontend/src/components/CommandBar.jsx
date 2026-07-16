import { ArrowRight, Copy, MagnifyingGlass, Translate, TextAlignLeft, BracketsCurly, Scales, Sparkle } from "@phosphor-icons/react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const actions = [{ id: "explain", label: "Explain", icon: Sparkle },{ id: "copy", label: "Copy", icon: Copy },{ id: "search", label: "Search", icon: MagnifyingGlass },{ id: "translate", label: "Translate", icon: Translate },{ id: "summarize", label: "Summarize", icon: TextAlignLeft },{ id: "extract", label: "Extract", icon: BracketsCurly },{ id: "compare", label: "Compare", icon: Scales }];

export const CommandBar = ({ action, setAction, command, setCommand, model, setModel, onSubmit, disabled, processing }) => (
  <div className={`command-dock ${processing ? "analyzing" : ""}`} data-testid="ai-command-bar">
    <div className="action-strip" data-testid="quick-action-list">{actions.map(({ id, label, icon: Icon }) => <button key={id} className={action === id ? "selected" : ""} onClick={() => setAction(id)} data-testid={`quick-action-${id}-button`}><Icon />{label}</button>)}</div>
    <div className="command-entry">
      <Select value={model} onValueChange={setModel}><SelectTrigger data-testid="model-selector-trigger" className="model-select"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="gpt-5.5" data-testid="model-option-gpt-5-5">GPT-5.5</SelectItem><SelectItem value="gemini-3.1-pro-preview" data-testid="model-option-gemini-3-1-pro">Gemini 3.1 Pro</SelectItem><SelectItem value="openrouter" data-testid="model-option-openrouter">OpenRouter</SelectItem><SelectItem value="groq" data-testid="model-option-groq">Groq</SelectItem></SelectContent></Select>
      <input value={command} onChange={(event) => setCommand(event.target.value)} onKeyDown={(event) => event.key === "Enter" && !event.shiftKey && onSubmit()} placeholder="Ask about the selected context…" data-testid="command-input" />
      <button className="submit-command" onClick={onSubmit} disabled={disabled} data-testid="run-analysis-button" aria-label="Run analysis"><ArrowRight weight="bold" /></button>
    </div>
  </div>
);