import { useState } from "react";
import { ArrowRight, CaretDown, Copy, MagnifyingGlass, MagicWand, NotePencil, Question, Translate, TextAlignLeft, BracketsCurly, Scales, Sparkle } from "@phosphor-icons/react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const actions = [{ id: "ask", label: "Ask", icon: Question },{ id: "explain", label: "Explain", icon: Sparkle },{ id: "copy", label: "Copy", icon: Copy },{ id: "search", label: "Search", icon: MagnifyingGlass },{ id: "translate", label: "Translate", icon: Translate },{ id: "rewrite", label: "Rewrite", icon: NotePencil },{ id: "transform", label: "Transform", icon: MagicWand },{ id: "summarize", label: "Summarize", icon: TextAlignLeft },{ id: "extract", label: "Extract", icon: BracketsCurly },{ id: "compare", label: "Compare", icon: Scales }];

const extractSchemas = [
  { id: "auto", label: "Auto" },
  { id: "table", label: "Table" },
  { id: "key_value", label: "Key-value" },
  { id: "contact_list", label: "Contacts" },
  { id: "task_list", label: "Tasks" },
  { id: "json_object", label: "JSON object" },
];

const DEFAULT_MODELS = [
  { id: "gpt-5.5", name: "GPT-5.5" },
  { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro" },
  { id: "openrouter", name: "OpenRouter" },
  { id: "groq", name: "Groq" },
];

// primaryActions: when given, only those actions show up front and the rest sit behind "More",
// so a first-time user sees a handful of clear choices instead of ten.
// models: when given, only these appear in the picker (e.g. the ones the user has a key for).
export const CommandBar = ({ action, setAction, command, setCommand, model, setModel, extractSchema, setExtractSchema, onSubmit, disabled, processing, primaryActions, models, placeholder }) => {
  const [showMore, setShowMore] = useState(false);
  const front = primaryActions ? actions.filter((a) => primaryActions.includes(a.id)) : actions;
  const rest = primaryActions ? actions.filter((a) => !primaryActions.includes(a.id)) : [];
  // Collapsed: the primary actions, plus the active one if it lives under "More".
  const visible = showMore ? actions : [...front, ...rest.filter((a) => a.id === action)];
  const modelOptions = models && models.length ? models : DEFAULT_MODELS;
  return (
    <div className={`command-dock ${processing ? "analyzing" : ""}`} data-testid="ai-command-bar">
      <div className="action-strip" data-testid="quick-action-list">
        {visible.map(({ id, label, icon: Icon }) => <button key={id} className={action === id ? "selected" : ""} onClick={() => setAction(id)} data-testid={`quick-action-${id}-button`}><Icon />{label}</button>)}
        {rest.length > 0 && (
          <button className="more-actions" onClick={() => setShowMore((v) => !v)} aria-expanded={showMore} data-testid="more-actions-button">
            {showMore ? "Less" : "More"}<CaretDown style={{ transform: showMore ? "rotate(180deg)" : "none" }} />
          </button>
        )}
      </div>
      {action === "extract" && (
        <div className="extract-schema-strip" data-testid="extract-schema-list">
          {extractSchemas.map(({ id, label }) => (
            <button key={id} className={extractSchema === id ? "selected" : ""} onClick={() => setExtractSchema(id)} data-testid={`extract-schema-${id}-button`}>{label}</button>
          ))}
        </div>
      )}
      <div className="command-entry">
        <Select value={model} onValueChange={setModel}>
          <SelectTrigger data-testid="model-selector-trigger" className="model-select"><SelectValue /></SelectTrigger>
          <SelectContent>
            {modelOptions.map((m) => <SelectItem key={m.id} value={m.id} data-testid={`model-option-${m.id.replace(/\./g, "-")}`}>{m.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <input value={command} onChange={(event) => setCommand(event.target.value)} onKeyDown={(event) => event.key === "Enter" && !event.shiftKey && onSubmit()} placeholder={placeholder || "Ask about the selected context…"} data-testid="command-input" />
        <button className="submit-command" onClick={onSubmit} disabled={disabled} data-testid="run-analysis-button" aria-label="Run analysis"><ArrowRight weight="bold" /></button>
      </div>
    </div>
  );
};
