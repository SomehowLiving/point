# Spatial AI Context Layer
## 1. Product Definition
Spatial AI Context Layer is a system-wide interface that lets users point to, select, draw over, or capture anything visible on their screen and use it as structured context for AI.
It works like a combination of:
* Print Screen
* Snipping Tool
* visual search
* AI command bar
* automation layer
Instead of taking a screenshot, opening an AI tool, uploading the image, and explaining what part matters, the user directly selects the relevant region and asks the AI to understand or act on it.
The core interaction is:
> Press a shortcut → select anything on screen → give an instruction → get an answer or trigger an action.
---
# 2. Problem
AI models can understand screenshots, but the current workflow is fragmented.
Users usually need to:
1. take a screenshot
2. crop it manually
3. upload it to an AI tool
4. explain where the model should look
5. copy the result elsewhere
6. manually complete the next action
This becomes worse when:
* a website blocks text selection
* content is inside an image, video, canvas, PDF, remote desktop, or application
* the relevant information exists in multiple locations
* the user is working on a large or multi-monitor screen
* the user needs to transfer context between applications
* the content needs to be converted into a structured format
* the user wants an action, not only an explanation
The product removes the gap between seeing something and using it as AI context.
---
# 3. Core Value Proposition
## Primary value
Users can show AI exactly what they mean without describing it.
## Secondary value
Users can immediately search, extract, transform, compare, save, share, or act on whatever they selected.
## Positioning
> A universal AI snipping tool that turns anything visible on your screen into searchable, understandable, and actionable context.
Alternative positioning:
> Print Screen, but for AI.
> Point at anything on your screen and ask AI.
> The visual context layer between your screen and AI agents.
---
# 4. Core Interaction
## Basic flow
1. The user presses a global keyboard shortcut.
2. The screen dims or freezes temporarily.
3. The user selects one or more regions.
4. A small command bar appears near the selection.
5. The user types or speaks an instruction.
6. The system captures the relevant visual and application context.
7. The model returns an answer or performs an action.
Example commands:
* “Copy this text.”
* “Search for this product.”
* “Explain this chart.”
* “Translate this section.”
* “Compare these two regions.”
* “Convert this table to CSV.”
* “Create a bug report from this error.”
* “Send this UI issue to Linear.”
* “Find where this number came from.”
* “Extract all names and email addresses.”
* “Remember this for later.”
---
# 5. Selection Capabilities
## 5.1 Region selection
The user can select a rectangular area of the screen.
Useful for:
* text blocks
* product cards
* tables
* charts
* error messages
* UI components
* images
* code snippets
## 5.2 Freehand selection
The user can circle or draw around an irregular object or area.
Useful when:
* the target is not rectangular
* several UI elements overlap
* the user wants to indicate a specific visual object
* the selected region contains unnecessary surrounding content
## 5.3 Point selection
The user can click on one exact location or element.
Useful for:
* icons
* buttons
* individual values
* UI controls
* map elements
* data points
## 5.4 Multi-region selection
The user can select multiple disconnected regions from the same screen.
Useful for:
* comparing two products
* comparing charts
* combining a question and an answer
* selecting a label and a value
* connecting information from different parts of a dashboard
## 5.5 Cross-screen selection
The user can capture context across:
* multiple browser tabs
* multiple applications
* multiple monitors
* a sequence of screenshots
Example:
> Select an error in the browser, a log line in the terminal, and a deployment status in a dashboard, then ask the AI to diagnose the issue.
## 5.6 Full-window capture
The user can send an entire application window as context.
## 5.7 Full-page capture
For websites, the tool can capture an entire scrolling page rather than only the visible viewport.
## 5.8 Scrolling region capture
The user can select a region that extends beyond the visible area and capture it while scrolling.
Useful for:
* long conversations
* documentation
* tables
* reports
* social media threads
* PDFs
---
# 6. Understanding Capabilities
## 6.1 Visual understanding
The system can interpret:
* images
* interfaces
* charts
* diagrams
* products
* maps
* documents
* videos
* dashboards
* code screenshots
* application states
## 6.2 OCR and text recovery
The tool can extract text even when it cannot normally be selected.
This includes content inside:
* images
* scanned PDFs
* videos
* canvas elements
* remote desktop sessions
* games
* locked websites
* presentation slides
## 6.3 Layout understanding
The system understands relationships between visible elements, such as:
* headings and paragraphs
* labels and values
* rows and columns
* cards and metadata
* form fields
* charts and legends
* product names and prices
## 6.4 Structured data extraction
The user can convert selected content into:
* plain text
* Markdown
* JSON
* CSV
* spreadsheet rows
* key-value pairs
* tables
* contact lists
* task lists
* API-ready structured objects
## 6.5 Context-aware interpretation
When available, the tool combines the screenshot with additional metadata.
For browser content:
* page URL
* DOM element
* nearby text
* accessibility tree
* HTML attributes
* links
* page title
* selected element hierarchy
For desktop applications:
* application name
* window title
* screen coordinates
* active file
* accessibility metadata
* clipboard context
This produces more accurate results than screenshot-only analysis.
---
# 7. Search Capabilities
## 7.1 Visual search
Users can select an object or image and find:
* similar products
* visually similar images
* source websites
* brand information
* related designs
* matching components
## 7.2 Text search
The system can extract selected text and search it automatically.
## 7.3 Semantic search
The user can search based on meaning rather than exact text.
Example:
> Select an error and ask, “Find documentation that explains why this happens.”
## 7.4 Source discovery
The tool can attempt to find:
* the original source of an image
* the source article
* a referenced document
* the official product page
* related technical documentation
## 7.5 Search within the current page
Users can visually select an example and ask the tool to find similar elements elsewhere on the page.
Example:
> “Find all cards with the same status as this one.”
---
# 8. Copy and Extraction Capabilities
## 8.1 Universal copy
Users can copy text from anything visible, even when native selection is unavailable.
## 8.2 Smart copy
Instead of copying raw OCR output, the system preserves:
* formatting
* paragraphs
* headings
* lists
* table structure
* code indentation
* links where available
## 8.3 Clean copy
The tool can remove:
* navigation labels
* advertisements
* watermarks
* repeated headers
* irrelevant surrounding content
* formatting noise
## 8.4 Copy as format
Users can copy content as:
* Markdown
* HTML
* JSON
* CSV
* plain text
* code
* spreadsheet-ready data
## 8.5 Copy with source
The copied result can include:
* page URL
* timestamp
* application
* screenshot
* selected coordinates
* citation or source reference
---
# 9. AI Actions
## 9.1 Explain
The AI can explain:
* technical errors
* charts
* complex UI states
* mathematical content
* legal or financial text
* code
* product information
* unfamiliar terminology
## 9.2 Summarize
Users can summarize:
* selected sections
* long pages
* multiple screen regions
* documents
* conversations
* dashboards
## 9.3 Translate
The tool can translate visible content while preserving structure and context.
## 9.4 Rewrite
Users can select text and ask the AI to:
* simplify it
* make it professional
* shorten it
* improve grammar
* change tone
* turn it into an email or message
## 9.5 Compare
Users can select multiple regions and compare them based on:
* price
* features
* design
* performance
* meaning
* data differences
* textual changes
## 9.6 Transform
The system can transform visual content into:
* notes
* tickets
* emails
* reports
* code
* test cases
* documentation
* summaries
* structured datasets
## 9.7 Question answering
The user can ask questions grounded specifically in the selected region.
## 9.8 Reasoning across regions
The AI can reason over several selections together.
Example:
> “Does the error shown here correspond to the failed API request shown in the other region?”
---
# 10. Action and Automation Capabilities
The product should not stop at answering questions. It should allow users to act on the selected context.
## 10.1 Share or send
Users can send selected context to:
* ChatGPT
* Claude
* Gemini
* Cursor
* VS Code
* Slack
* Discord
* Gmail
* Notion
* Linear
* Jira
* GitHub
* Google Docs
* spreadsheets
## 10.2 Create tasks
Selected content can become:
* a Linear issue
* a Jira ticket
* a GitHub issue
* a Notion task
* a calendar task
* a follow-up reminder
## 10.3 Developer workflows
A developer can select an error or broken UI and automatically collect:
* screenshot
* URL
* console errors
* failed network requests
* browser metadata
* source component
* reproduction steps
* environment information
The system can then generate:
* a bug report
* a debugging prompt
* a GitHub issue
* a test case
* an implementation task
## 10.4 Commerce workflows
A user can select a product and:
* find similar items
* compare prices
* extract product details
* save it to a wishlist
* check reviews
* track price changes
## 10.5 Research workflows
A user can select a section and:
* save it with a source
* summarize it
* add it to research notes
* connect it to related captures
* search for supporting or conflicting information
## 10.6 Support workflows
A support agent can select a customer error and generate:
* a response
* a troubleshooting checklist
* an internal escalation
* a support ticket
* a knowledge-base search
---
# 11. Spatial Annotation Features
## 11.1 Draw to direct attention
Users can draw arrows, circles, boxes, or lines to show the model exactly what matters.
## 11.2 Add labels
Users can label selected regions:
* “error”
* “expected result”
* “current result”
* “customer input”
* “compare with this”
* “ignore this area”
## 11.3 Mark relationships
Users can connect two regions with arrows.
Example:
> Connect a chart anomaly to a corresponding log entry.
## 11.4 Redact sensitive information
Before sending a capture to a model, users can blur or remove:
* passwords
* email addresses
* names
* API keys
* financial information
* private messages
## 11.5 Pin context
Users can pin a selection on screen while continuing to work elsewhere.
---
# 12. Context Memory
## 12.1 Capture history
The tool stores recent selections with:
* screenshot
* extracted text
* source application
* URL
* timestamp
* user instruction
* AI result
* follow-up action
## 12.2 Search previous captures
Users can search previous context using natural language.
Examples:
* “Find the Stripe error I captured yesterday.”
* “Show me the product table I copied last week.”
* “What was the dashboard metric I selected during the incident?”
## 12.3 Persistent work context
Users can group captures by:
* project
* task
* customer
* incident
* research topic
* browser session
## 12.4 Context linking
The system can link related items such as:
* screenshot → bug report
* UI issue → GitHub commit
* error → fix
* product → purchase decision
* research excerpt → source article
## 12.5 Temporary mode
For privacy-sensitive use cases, captures can be processed without being saved.
---
# 13. Platform Modes
## 13.1 Browser extension
Provides deeper context for websites.
Capabilities:
* DOM extraction
* webpage text access
* full-page capture
* link extraction
* browser tab metadata
* element-level selection
* webpage-specific actions
## 13.2 Desktop application
Provides universal access across the operating system.
Capabilities:
* global keyboard shortcut
* region capture
* multi-monitor support
* application awareness
* overlay and annotation
* cross-application workflows
## 13.3 Mobile application
A future mobile version could allow users to:
* circle anything visible on screen
* extract text from apps
* search images or products
* explain UI elements
* share selected context to AI
* capture camera-based context
## 13.4 SDK and API
Developers could embed the selection layer into their own products.
Possible APIs:
* capture region
* retrieve context bundle
* run AI action
* register custom action
* integrate application metadata
* store or retrieve context history
---
# 14. Context Bundle
Each selection should become a structured context bundle rather than only an image.
Example:
```json
{
  "capture": {
    "image": "selected-region.png",
    "coordinates": {
      "x": 420,
      "y": 170,
      "width": 640,
      "height": 380
    },
    "display": 1
  },
  "source": {
    "application": "Google Chrome",
    "windowTitle": "Production Dashboard",
    "url": "https://example.com/dashboard"
  },
  "content": {
    "ocrText": "Payment failure rate: 12.8%",
    "domText": "Payment failure rate",
    "elementType": "chart"
  },
  "annotations": [
    {
      "type": "circle",
      "label": "unexpected spike"
    }
  ],
  "instruction": "Explain what may have caused this increase"
}
```
This context bundle can be passed to:
* AI models
* agents
* developer tools
* workflow automation systems
* enterprise applications
---
# 15. Privacy and Security Capabilities
Because the product observes screen content, privacy cannot be treated as an optional feature.
## Required capabilities
* local-first screenshot processing where possible
* explicit capture rather than continuous recording
* application allowlists and blocklists
* automatic sensitive-data detection
* manual redaction
* temporary processing mode
* encrypted capture history
* configurable data retention
* no capture of password fields
* enterprise model-provider controls
* audit logs for automated actions
The initial product should avoid continuous background screen recording. Explicit user-triggered capture is easier to trust and easier to ship.
---
# 16. Target Users
## Initial target users
### Developers
They frequently move context between:
* browser
* terminal
* IDE
* logs
* dashboards
* issue trackers
### Designers
They need to:
* reference UI elements
* communicate design changes
* extract design inspiration
* compare interfaces
* create implementation notes
### Support and operations teams
They need to:
* capture customer issues
* understand dashboards
* create tickets
* explain errors
* transfer visual context into internal tools
### Researchers and knowledge workers
They need to:
* extract content
* save sources
* summarize sections
* compare documents
* organize visual information
### General users
They need to:
* copy blocked text
* search products
* translate visible content
* understand unfamiliar interfaces
* extract information from images
---
# 17. Initial MVP
The first release should focus on one clear interaction.
## MVP features
1. Global keyboard shortcut
2. Rectangular region selection
3. Freehand drawing and annotation
4. OCR
5. Screenshot-based multimodal understanding
6. Command bar
7. Core actions:
   * copy
   * explain
   * search
   * translate
   * summarize
   * extract
8. Multi-region comparison
9. Browser URL and page-title capture
10. Copy result to clipboard
11. Recent capture history
12. Sensitive-information redaction
## Initial platform
Start with:
* Windows desktop application
* Chrome extension for browser enrichment
The desktop application provides the universal interaction.
The browser extension provides more accurate website context.
---
# 18. Features That Should Not Be in the First Version
Avoid initially:
* continuous screen recording
* autonomous clicking across every application
* support for every operating system
* complex multi-agent workflows
* enterprise administration
* full knowledge graphs
* long-term automatic memory
* dozens of integrations
* voice-first interaction
* mobile support
* live video understanding
These features increase complexity before the core behavior has been validated.
---
# 19. Product Evolution
## Phase 1: AI capture tool
Select anything and ask AI.
Core value:
* copy
* understand
* search
* transform
## Phase 2: Context transfer layer
Move selected context directly into other applications.
Core value:
* create tickets
* send to developer tools
* save to notes
* share with teams
## Phase 3: Reusable visual workflows
Users create actions such as:
> “Whenever I select an error, collect browser logs and create a Linear issue.”
Core value:
* repeatable automation
* application integrations
* workflow templates
## Phase 4: Context memory
The system remembers previous selections and their outcomes.
Core value:
* searchable visual work history
* project memory
* context retrieval
## Phase 5: Agent interaction layer
AI agents can use user selections as precise instructions for actions.
Core value:
* visual grounding
* safe agent control
* human-directed automation
---
# 20. Long-Term Vision
The long-term vision is not merely a smarter screenshot tool.
It is a universal spatial interface for communicating with AI.
Today, users communicate with AI primarily through text.
This product introduces another interaction primitive:
> Pointing.
The user should be able to point at anything visible, show the AI exactly what matters, and immediately continue the workflow.
The product becomes the missing layer between:
* human visual attention
* screen context
* AI reasoning
* software actions
In the long term, it can function as a standard context interface for operating systems, browsers, applications, and AI agents.