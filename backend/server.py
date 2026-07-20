from dotenv import load_dotenv
import os
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from contextlib import asynccontextmanager
from fastapi import FastAPI, APIRouter, HTTPException, Query
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import StreamingResponse
from motor.motor_asyncio import AsyncIOMotorClient
import logging
import base64
import io
import json
import re
from pydantic import BaseModel, Field, ConfigDict, field_validator
from typing import List, Literal, Optional, Tuple
import uuid
from datetime import datetime, timezone
from openai import AsyncOpenAI
from PIL import Image
import httpx
from ocr_service import extract_ocr
from export_service import render_export
from notion_service import NOTION_API_VERSION, build_notion_page_payload, parse_notion_page_id

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    client.close()


# Create the main app without a prefix
app = FastAPI(title="Spatial AI Context Layer", version="0.1.0", lifespan=lifespan)

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


SUPPORTED_MODELS = {
    "gpt-5.5": ("openai", os.environ.get("OPENAI_MODEL", "gpt-4o")),
    "gemini-3.1-pro-preview": ("gemini", os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")),
    "openrouter": ("openrouter", os.environ.get("OPENROUTER_MODEL", "openai/gpt-4o-mini")),
    "groq": ("groq", os.environ.get("GROQ_MODEL", "meta-llama/llama-4-scout-17b-16e-instruct")),
}
PROVIDER_KEY_ENV = {
    "openai": "OPENAI_API_KEY",
    "gemini": "GEMINI_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
    "groq": "GROQ_API_KEY",
}
# openai / openrouter / groq all speak the OpenAI chat-completions wire format; only the base
# URL (and key/model) differs, so they share stream_openai_deltas below. None means the SDK's
# own default (api.openai.com).
OPENAI_COMPATIBLE_BASE_URLS = {
    "openai": None,
    "openrouter": "https://openrouter.ai/api/v1",
    "groq": "https://api.groq.com/openai/v1",
}
SUPPORTED_MIME_TYPES = {"image/png", "image/jpeg", "image/webp"}
MAX_IMAGE_BYTES = 8 * 1024 * 1024


class Region(BaseModel):
    id: str
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)
    label: Optional[str] = Field(default=None, max_length=80)


class Point(BaseModel):
    id: str
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    label: Optional[str] = Field(default=None, max_length=80)


class SearchResult(BaseModel):
    title: str = Field(default="", max_length=300)
    url: str = Field(default="", max_length=2000)
    snippet: str = Field(default="", max_length=500)
    engine: str = Field(default="", max_length=60)


class Annotation(BaseModel):
    id: str
    type: Literal["freehand", "redaction", "label", "mask"]
    points: List[dict] = Field(default_factory=list, max_length=500)
    label: Optional[str] = Field(default=None, max_length=80)
    edge: Optional[Literal["hard", "soft"]] = None


class SourceContext(BaseModel):
    application: str = Field(default="Web dashboard", max_length=100)
    window_title: str = Field(default="", max_length=300)
    url: str = Field(default="", max_length=2000)
    displays: List[dict] = Field(default_factory=list, max_length=16)
    page_context: dict = Field(default_factory=dict)


class OCRRequest(BaseModel):
    image_data: str
    mime_type: str
    engine: Literal["auto", "tesseract", "paddle"] = "auto"
    language: str = Field(default="eng", pattern=r"^[a-zA-Z+_-]{2,40}$")
    regions: List[Region] = Field(default_factory=list, max_length=12)

    @field_validator("mime_type")
    @classmethod
    def validate_ocr_mime_type(cls, value: str) -> str:
        if value not in SUPPORTED_MIME_TYPES:
            raise ValueError("Only PNG, JPEG, and WEBP images are supported")
        return value


class ExportRequest(BaseModel):
    format: Literal["text", "markdown", "json", "csv", "html"]
    title: str = Field(default="Spatial AI extraction", max_length=200)
    source: SourceContext = Field(default_factory=SourceContext)
    payload: dict
    clean: bool = False


class NotionSendRequest(BaseModel):
    title: str = Field(default="Point capture", max_length=200)
    content: str = Field(min_length=1, max_length=100000)
    source_url: str = Field(default="", max_length=2000)
    parent_page: str = Field(min_length=1, max_length=2000)


class CaptureSource(BaseModel):
    """An extra image to reason across alongside the primary capture — e.g. a terminal window or
    a dashboard, captured separately from the primary browser/desktop screenshot (README 5.5,
    "cross-screen selection"). Mirrors AnalyzeRequest's own per-image fields (regions/annotations/
    points/source/ocr_text) so each source is independently selectable and OCR-grounded."""
    id: str
    label: str = Field(default="", max_length=80)
    image_data: str
    mime_type: str
    regions: List[Region] = Field(default_factory=list, max_length=12)
    annotations: List[Annotation] = Field(default_factory=list, max_length=30)
    points: List[Point] = Field(default_factory=list, max_length=12)
    source: SourceContext = Field(default_factory=SourceContext)
    ocr_text: str = Field(default="", max_length=100000)

    @field_validator("mime_type")
    @classmethod
    def validate_source_mime_type(cls, value: str) -> str:
        if value not in SUPPORTED_MIME_TYPES:
            raise ValueError("Only PNG, JPEG, and WEBP images are supported")
        return value


class AnalyzeRequest(BaseModel):
    image_data: str
    mime_type: str
    instruction: str = Field(min_length=1, max_length=4000)
    action: Literal["ask", "copy", "explain", "search", "translate", "summarize", "extract", "compare", "rewrite", "transform"] = "ask"
    extract_schema: Literal["auto", "table", "key_value", "contact_list", "task_list", "json_object"] = "auto"
    model: str = "gpt-5.5"
    regions: List[Region] = Field(default_factory=list, max_length=12)
    annotations: List[Annotation] = Field(default_factory=list, max_length=30)
    points: List[Point] = Field(default_factory=list, max_length=12)
    source: SourceContext = Field(default_factory=SourceContext)
    private_mode: bool = False
    ocr_text: str = Field(default="", max_length=100000)
    # Capped at 3 (4 sources total with the primary) to keep combined request size and provider
    # payload limits reasonable -- the README's own cross-screen example names exactly 3 sources
    # (browser, terminal, dashboard).
    additional_sources: List[CaptureSource] = Field(default_factory=list, max_length=3)

    @field_validator("mime_type")
    @classmethod
    def validate_mime_type(cls, value: str) -> str:
        if value not in SUPPORTED_MIME_TYPES:
            raise ValueError("Only PNG, JPEG, and WEBP images are supported")
        return value

    @field_validator("model")
    @classmethod
    def validate_model(cls, value: str) -> str:
        if value not in SUPPORTED_MODELS:
            raise ValueError("Unsupported model")
        return value


class Capture(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    created_at: str
    instruction: str
    action: str
    model: str
    result: str
    regions: List[Region]
    annotations: List[Annotation]
    points: List[Point] = Field(default_factory=list)
    source: SourceContext
    thumbnail: str = ""
    ocr_text: str = ""
    search_results: List[SearchResult] = Field(default_factory=list)


def parse_image_data(image_data: str) -> bytes:
    payload = re.sub(r"^data:image\/(png|jpeg|jpg|webp);base64,", "", image_data, flags=re.I)
    try:
        raw = base64.b64decode(payload, validate=True)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid base64 image data") from exc
    if not raw or len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image must be between 1 byte and 8 MB")
    return raw


def canonical_image_base64(raw: bytes) -> str:
    try:
        image = Image.open(io.BytesIO(raw))
        image.load()
        if image.mode not in {"RGB", "RGBA"}:
            image = image.convert("RGBA" if "transparency" in image.info else "RGB")
        if max(image.size) > 4096:
            image.thumbnail((4096, 4096), Image.Resampling.LANCZOS)
        output = io.BytesIO()
        image.save(output, format="PNG", optimize=True)
        return base64.b64encode(output.getvalue()).decode("ascii")
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Image bytes could not be decoded") from exc


# Each shape is deliberately wrapped as {"schema": ..., "data": ...} (rather than a bare
# per-schema object) so the frontend has exactly one wire format to parse regardless of which
# schema was requested or which one "auto" picked.
EXTRACT_SCHEMA_SHAPES = {
    "table": '{"schema": "table", "data": {"columns": ["<column name>", ...], "rows": [["<cell>", ...], ...]}}',
    "key_value": '{"schema": "key_value", "data": {"pairs": [{"key": "<label>", "value": "<value>"}, ...]}}',
    "contact_list": '{"schema": "contact_list", "data": {"contacts": [{"name": "<name>", "email": "<email or null>", '
                     '"phone": "<phone or null>", "role": "<role/title or null>"}, ...]}}',
    "task_list": '{"schema": "task_list", "data": {"tasks": [{"title": "<task text>", "done": <true|false>, '
                  '"assignee": "<name or null>", "due": "<date/deadline text or null>"}, ...]}}',
    "json_object": '{"schema": "json_object", "data": <any JSON value that best represents the requested information>}',
}


def _extract_action_guide(schema: str) -> str:
    if schema == "auto":
        options = "\n".join(f"- {shape}" for shape in EXTRACT_SCHEMA_SHAPES.values())
        return (
            "Extract the requested information as JSON. Pick whichever of the following shapes best fits what was "
            f"selected, and respond with ONLY that JSON object — no prose, no Markdown code fences:\n{options}"
        )
    return (
        f"Extract the requested information as JSON matching exactly this shape: {EXTRACT_SCHEMA_SHAPES[schema]}. "
        "Respond with ONLY that JSON object — no prose, no Markdown code fences. If a field isn't visible, use null "
        "rather than guessing."
    )


def _rect_overlap_area(a: dict, b: dict) -> float:
    left = max(a.get("x", 0), b.get("x", 0))
    top = max(a.get("y", 0), b.get("y", 0))
    right = min(a.get("x", 0) + a.get("width", 0), b.get("x", 0) + b.get("width", 0))
    bottom = min(a.get("y", 0) + a.get("height", 0), b.get("y", 0) + b.get("height", 0))
    if right <= left or bottom <= top:
        return 0.0
    return (right - left) * (bottom - top)


def _compact_dom_element(element: dict) -> dict:
    return {key: element[key] for key in ("tag", "role", "text", "href") if element.get(key)}


def _dom_elements_for_region(dom_elements: List[dict], region: dict, limit: int = 5) -> List[dict]:
    scored = [(overlap, element) for element in dom_elements if (overlap := _rect_overlap_area(region, element.get("box") or {})) > 0]
    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [_compact_dom_element(element) for _, element in scored[:limit]]


def _dom_elements_for_point(dom_elements: List[dict], point: dict, limit: int = 3) -> List[dict]:
    px, py = point.get("x", 0), point.get("y", 0)
    scored = []
    for element in dom_elements:
        box = element.get("box") or {}
        bx, by, bw, bh = box.get("x", 0), box.get("y", 0), box.get("width", 0), box.get("height", 0)
        inside = bx <= px <= bx + bw and by <= py <= by + bh
        center_x, center_y = bx + bw / 2, by + bh / 2
        distance = ((px - center_x) ** 2 + (py - center_y) ** 2) ** 0.5
        scored.append((0 if inside else 1, distance, element))
    scored.sort(key=lambda triple: (triple[0], triple[1]))
    return [_compact_dom_element(element) for _, _, element in scored[:limit]]


def _selected_dom_elements(source_context: SourceContext, regions: List[Region], points: List[Point]) -> dict:
    page_context = source_context.page_context or {}
    dom_elements = page_context.get("dom_elements")
    if not isinstance(dom_elements, list) or not dom_elements:
        return {"regions": [], "points": []}
    return {
        "regions": [
            {"region_id": region.id, "elements": _dom_elements_for_region(dom_elements, region.model_dump())}
            for region in regions
        ],
        "points": [
            {"point_id": point.id, "elements": _dom_elements_for_point(dom_elements, point.model_dump())}
            for point in points
        ],
    }


def _source_bundle(
    index: int,
    label: str,
    regions: List[Region],
    annotations: List[Annotation],
    points: List[Point],
    ocr_text: str,
    source_context: SourceContext,
) -> dict:
    return {
        "label": label or f"Source {index + 1}",
        "source": source_context.model_dump(),
        "regions_normalized_to_image": [region.model_dump() for region in regions],
        "annotations": [annotation.model_dump() for annotation in annotations],
        "points_normalized_to_image": [point.model_dump() for point in points],
        "selected_dom_elements": _selected_dom_elements(source_context, regions, points),
        "deterministic_ocr": ocr_text,
    }


def build_prompt(request: AnalyzeRequest, search_results: Optional[List[dict]] = None) -> str:
    action_guides = {
        "copy": "Recover the requested text precisely, preserving layout. Return only copy-ready content.",
        "explain": "Explain the selected content clearly, grounding every claim in visible evidence.",
        "search": "Identify the selected subject. web_search_results below are REAL, retrieved results for an "
                   "automatically-extracted query — cite specific titles/URLs from them, note which look like "
                   "official sources, and say plainly if the results don't answer the question rather than guessing.",
        "translate": "Translate the selected content while preserving headings, lists, tables, and tone.",
        "summarize": "Summarize the selected content with key facts, decisions, and open questions.",
        "extract": _extract_action_guide(request.extract_schema),
        "compare": "Compare the numbered selected regions explicitly, listing similarities, differences, and a conclusion.",
        "ask": "Answer the instruction using only the supplied visual and source context. State uncertainty when needed.",
        "rewrite": "Rewrite the selected content per the user instruction (e.g. simplify, make professional, shorten, "
                   "improve grammar, change tone, turn into an email or message). Preserve the original meaning and "
                   "return only the rewritten content — no commentary about what changed.",
        "transform": "Transform the selected content into the format the user instruction names (e.g. notes, a "
                     "ticket description, an email, a report, code, test cases, documentation). Return only the "
                     "transformed artifact in that format, ready to use as-is.",
    }

    # sources[0] is always the primary capture; sources[1:] are additional cross-screen sources
    # (README 5.5) — e.g. a terminal window or a dashboard captured separately from the primary
    # browser/desktop screenshot. Same order as the images actually attached to the provider call.
    sources = [_source_bundle(0, "Primary", request.regions, request.annotations, request.points, request.ocr_text, request.source)]
    for index, extra in enumerate(request.additional_sources, start=1):
        sources.append(_source_bundle(index, extra.label, extra.regions, extra.annotations, extra.points, extra.ocr_text, extra.source))

    context = {
        "sources": sources,
        "web_search_results": search_results or [],
    }
    any_dom = any(bundle["selected_dom_elements"]["regions"] or bundle["selected_dom_elements"]["points"] for bundle in sources)
    dom_note = (
        "Each source's selected_dom_elements maps its region_id/point_id to the REAL DOM element(s) (tag, role, "
        "text, href) under it, captured by the browser extension at screenshot time — this is ground truth about "
        "the browser content, not a visual guess, and should be preferred over inferring an element's identity "
        "from pixels alone. It is only present for browser-extension captures; treat it as absent (not a signal) "
        "otherwise.\n"
        if any_dom
        else ""
    )
    # Reading small/dense text (counts, prices, table cells) from pixels alone is meaningfully
    # hallucination-prone — deterministic_ocr exists to ground exactly that case. But OCR itself
    # can misread a character, so this is additional grounding, not a silent replacement for
    # looking at the image: tell the model explicitly to use both and prefer the image on conflict.
    any_ocr = any(bundle["deterministic_ocr"].strip() for bundle in sources)
    ocr_note = (
        "Each source's deterministic_ocr contains text extracted from its image via OCR — treat it as strong "
        "grounding for exact wording, counts, and small text that's hard to read from pixels alone, but OCR can "
        "misread individual characters. Use both the image and deterministic_ocr together, and where they "
        "conflict, resolve using the image.\n"
        if any_ocr
        else ""
    )
    multi_source_note = (
        f'There are {len(sources)} sources in the "sources" array below, in the SAME ORDER as the images attached '
        "to this message (sources[0] is the first image, sources[1] is the second, and so on) — e.g. a browser "
        "error, a terminal log line, and a dashboard status, captured separately. Reason across all of them "
        "together when the instruction calls for it, rather than only looking at the first one.\n"
        if len(sources) > 1
        else ""
    )

    return (
        "You are the Spatial AI Context Layer. Analyze the provided screenshot(s) and prioritize only the "
        "user-marked regions. Each entry in a source's points_normalized_to_image marks one exact location the "
        "user pointed at (not an area) — ground your answer specifically on what is at that coordinate. "
        "Redacted areas are intentionally unavailable and must never be inferred. "
        f"{multi_source_note}"
        f"{dom_note}"
        f"{ocr_note}"
        f"Task mode: {request.action}. {action_guides[request.action]}\n\n"
        f"User instruction: {request.instruction}\n\n"
        f"Structured context bundle:\n{json.dumps(context, ensure_ascii=False)}"
    )


SEARXNG_URL = os.environ.get("SEARXNG_URL", "http://localhost:8888")


def extract_search_query(request: AnalyzeRequest) -> str:
    # Deterministic MVP heuristic: deterministic OCR text (what's actually visible in the
    # selection) makes a better query than the user's free-form instruction, when available.
    # A smarter LLM-based query rewrite is a reasonable future refinement, not required for the
    # core "make Search actually search" ask.
    ocr_snippet = request.ocr_text.strip()
    query = ocr_snippet if ocr_snippet else request.instruction.strip()
    return " ".join(query.split())[:150]


async def search_web(query: str, max_results: int = 6) -> List[dict]:
    if not query:
        return []
    try:
        async with httpx.AsyncClient(timeout=10) as http_client:
            response = await http_client.get(f"{SEARXNG_URL}/search", params={"q": query, "format": "json"})
            response.raise_for_status()
            payload = response.json()
    except Exception as exc:
        logger.warning("SearXNG search failed for query %r: %s", query, exc)
        return []
    results = []
    for item in payload.get("results", [])[:max_results]:
        engines = item.get("engines") or ([item["engine"]] if item.get("engine") else [])
        results.append({
            "title": (item.get("title") or "")[:300],
            "url": item.get("url") or "",
            "snippet": (item.get("content") or "")[:500],
            "engine": engines[0] if engines else "",
        })
    return results

# Add your routes to the router instead of directly to app
@api_router.get("/")
async def root():
    return {"message": "Spatial AI Context Layer API", "status": "ready"}

@api_router.get("/models")
async def models():
    return {
        "models": [
            {"id": "gpt-5.5", "name": "GPT-5.5", "provider": "OpenAI"},
            {"id": "gemini-3.1-pro-preview", "name": "Gemini 3.1 Pro", "provider": "Google"},
            {"id": "openrouter", "name": "OpenRouter", "provider": "OpenRouter"},
            {"id": "groq", "name": "Groq", "provider": "Groq"},
        ]
    }


@api_router.post("/ocr/extract")
async def ocr_extract(request: OCRRequest):
    image_bytes = parse_image_data(request.image_data)
    try:
        result = await __import__("asyncio").to_thread(
            extract_ocr,
            image_bytes,
            [region.model_dump() for region in request.regions],
            request.engine,
            request.language,
        )
        return result
    except Exception as exc:
        logger.exception("Deterministic OCR failed")
        raise HTTPException(status_code=500, detail=f"OCR failed: {exc}") from exc


@api_router.get("/ocr/status")
async def ocr_status():
    import importlib.util
    import shutil
    return {
        "default": "auto",
        "engines": [
            {"id": "tesseract", "available": bool(os.environ.get("TESSERACT_CMD") or shutil.which("tesseract")), "mode": "in-process"},
            {"id": "paddleocr", "available": bool(importlib.util.find_spec("paddleocr") and importlib.util.find_spec("paddle")), "mode": "isolated-worker"},
        ],
        "fallback_order": ["tesseract", "paddleocr", "tesseract"],
    }


@api_router.post("/exports/render")
async def export_render(request: ExportRequest):
    try:
        return render_export(request.payload, request.format, request.title, request.source.model_dump(), request.clean)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@api_router.post("/integrations/notion/send")
async def send_to_notion(request: NotionSendRequest):
    parent_page_id = parse_notion_page_id(request.parent_page)
    if not parent_page_id:
        raise HTTPException(status_code=400, detail="Could not find a Notion page ID in that URL")
    api_key = os.environ.get("NOTION_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="Notion integration is not configured (missing NOTION_API_KEY)")
    payload = build_notion_page_payload(parent_page_id, request.title, request.content, request.source_url)
    try:
        async with httpx.AsyncClient(timeout=15) as http_client:
            response = await http_client.post(
                "https://api.notion.com/v1/pages",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Notion-Version": NOTION_API_VERSION,
                    "Content-Type": "application/json",
                },
                json=payload,
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Could not reach Notion: {exc}") from exc
    if response.status_code >= 400:
        try:
            detail = response.json().get("message", response.text)
        except ValueError:
            detail = response.text
        raise HTTPException(status_code=response.status_code, detail=f"Notion error: {detail}")
    created = response.json()
    return {"ok": True, "page_id": created.get("id"), "url": created.get("url")}


SYSTEM_MESSAGE = "You are a precise multimodal assistant for visual screen context. Never reveal hidden or redacted content."


async def stream_openai_deltas(model_name: str, api_key: str, prompt: str, images: List[Tuple[str, str]], base_url: Optional[str] = None):
    client = AsyncOpenAI(api_key=api_key, base_url=base_url)
    content = [{"type": "text", "text": prompt}]
    for mime_type, image_payload in images:
        content.append({"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{image_payload}"}})
    stream = await client.chat.completions.create(
        model=model_name,
        stream=True,
        messages=[
            {"role": "system", "content": SYSTEM_MESSAGE},
            {"role": "user", "content": content},
        ],
    )
    async for chunk in stream:
        delta = chunk.choices[0].delta.content if chunk.choices else None
        if delta:
            yield delta


async def stream_gemini_deltas(model_name: str, api_key: str, prompt: str, images: List[Tuple[str, str]]):
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)
    parts = [types.Part.from_bytes(data=base64.b64decode(image_payload), mime_type=mime_type) for mime_type, image_payload in images]
    stream = await client.aio.models.generate_content_stream(
        model=model_name,
        contents=[*parts, prompt],
        config=types.GenerateContentConfig(system_instruction=SYSTEM_MESSAGE),
    )
    async for chunk in stream:
        if chunk.text:
            yield chunk.text


@api_router.post("/captures/analyze")
async def analyze_capture(request: AnalyzeRequest):
    raw_image = parse_image_data(request.image_data)
    provider, model_name = SUPPORTED_MODELS[request.model]
    api_key = os.environ.get(PROVIDER_KEY_ENV[provider])
    if not api_key:
        raise HTTPException(status_code=503, detail="AI service is not configured")

    image_payload = canonical_image_base64(raw_image)
    # Additional sources (README 5.5, cross-screen selection) ride along for this one analyze
    # call only -- their full images aren't persisted to capture history, to avoid every saved
    # capture growing by however many extra screenshots it was reasoned against.
    images: List[Tuple[str, str]] = [("image/png", image_payload)]
    for extra in request.additional_sources:
        images.append(("image/png", canonical_image_base64(parse_image_data(extra.image_data))))

    async def event_stream():
        collected = []
        search_results: List[dict] = []
        try:
            if request.action == "search":
                search_results = await search_web(extract_search_query(request))
                yield f"data: {json.dumps({'type': 'search_results', 'results': search_results})}\n\n"
            prompt = build_prompt(request, search_results)
            deltas = (
                stream_openai_deltas(model_name, api_key, prompt, images, base_url=OPENAI_COMPATIBLE_BASE_URLS[provider])
                if provider in OPENAI_COMPATIBLE_BASE_URLS
                else stream_gemini_deltas(model_name, api_key, prompt, images)
            )
            async for content in deltas:
                collected.append(content)
                yield f"data: {json.dumps({'type': 'delta', 'content': content})}\n\n"

            result = "".join(collected).strip()
            capture_id = str(uuid.uuid4())
            now = datetime.now(timezone.utc).isoformat()
            capture_payload = {
                "id": capture_id,
                "created_at": now,
                "instruction": request.instruction,
                "action": request.action,
                "model": request.model,
                "result": result,
                "regions": [region.model_dump() for region in request.regions],
                "annotations": [annotation.model_dump() for annotation in request.annotations],
                "points": [point.model_dump() for point in request.points],
                "source": request.source.model_dump(),
                "thumbnail": "" if request.private_mode else f"data:{request.mime_type};base64,{image_payload}",
                "ocr_text": request.ocr_text,
                "search_results": search_results,
            }
            if not request.private_mode:
                await db.captures.insert_one(dict(capture_payload))
            response_capture = Capture(**capture_payload).model_dump()
            yield f"data: {json.dumps({'type': 'done', 'capture': response_capture, 'saved': not request.private_mode})}\n\n"
        except Exception as exc:
            logger.exception("Capture analysis failed")
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@api_router.get("/captures", response_model=List[Capture])
async def list_captures(search: str = Query(default="", max_length=200), refresh: str = Query(default="", max_length=40)):
    query = {}
    if search.strip():
        safe = re.escape(search.strip())
        query = {"$or": [
            {"instruction": {"$regex": safe, "$options": "i"}},
            {"result": {"$regex": safe, "$options": "i"}},
            {"source.window_title": {"$regex": safe, "$options": "i"}},
        ]}
    captures = await db.captures.find(query, {"_id": 0}).sort("created_at", -1).to_list(100)
    return [Capture(**capture) for capture in captures]


@api_router.get("/captures/{capture_id}", response_model=Capture)
async def get_capture(capture_id: str):
    capture = await db.captures.find_one({"id": capture_id}, {"_id": 0})
    if not capture:
        raise HTTPException(status_code=404, detail="Capture not found")
    return Capture(**capture)


@api_router.delete("/captures/{capture_id}")
async def delete_capture(capture_id: str):
    result = await db.captures.delete_one({"id": capture_id})
    if not result.deleted_count:
        raise HTTPException(status_code=404, detail="Capture not found")
    return {"deleted": True, "id": capture_id}

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)