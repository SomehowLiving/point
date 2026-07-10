# Real-site Validation Matrix

Validate the unpacked extension on each site by clicking the toolbar action and confirming that the Capture workspace opens with a visible screenshot, correct URL/title, and page enrichment.

| Category | Site | Expected enrichment |
| --- | --- | --- |
| Source code | `https://github.com/tauri-apps/tauri` | Repository title, headings, visible README text, links |
| Reference | `https://en.wikipedia.org/wiki/Optical_character_recognition` | Article title, headings, body text, canonical URL |
| Commerce | `https://www.amazon.com/` | Visible screenshot and metadata; enrichment may vary with consent/region pages |
| Q&A | `https://stackoverflow.com/questions/tagged/python` | Question-list headings, visible text, links |
| Hosting | `https://vercel.com/` | Marketing page metadata, headings, links |
| Observability | `https://play.grafana.org/` | Dashboard screenshot; limited DOM text is acceptable for canvas-rendered panels |
| Canvas-heavy | `https://threejs.org/examples/` | Screenshot required; sparse DOM enrichment is expected |

Restricted browser pages such as `chrome://extensions` are intentionally unsupported by `activeTab` and should fail without capturing private browser UI.