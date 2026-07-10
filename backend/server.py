from fastapi import FastAPI, APIRouter, HTTPException, Query
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import StreamingResponse
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import base64
import json
import re
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict, field_validator
from typing import List, Literal, Optional
import uuid
from datetime import datetime, timezone
from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent, TextDelta, StreamDone


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI(title="Spatial AI Context Layer", version="0.1.0")

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


SUPPORTED_MODELS = {
    "gpt-5.5": ("openai", "gpt-5.5"),
    "gemini-3.1-pro-preview": ("gemini", "gemini-3.1-pro-preview"),
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


class Annotation(BaseModel):
    id: str
    type: Literal["freehand", "redaction", "label"]
    points: List[dict] = Field(default_factory=list, max_length=500)
    label: Optional[str] = Field(default=None, max_length=80)


class SourceContext(BaseModel):
    application: str = Field(default="Web dashboard", max_length=100)
    window_title: str = Field(default="", max_length=300)
    url: str = Field(default="", max_length=2000)


class AnalyzeRequest(BaseModel):
    image_data: str
    mime_type: str
    instruction: str = Field(min_length=1, max_length=4000)
    action: Literal["ask", "copy", "explain", "search", "translate", "summarize", "extract", "compare"] = "ask"
    model: str = "gpt-5.5"
    regions: List[Region] = Field(default_factory=list, max_length=12)
    annotations: List[Annotation] = Field(default_factory=list, max_length=30)
    source: SourceContext = Field(default_factory=SourceContext)
    private_mode: bool = False

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
    source: SourceContext
    thumbnail: str = ""


def parse_image_data(image_data: str) -> bytes:
    payload = re.sub(r"^data:image\/(png|jpeg|jpg|webp);base64,", "", image_data, flags=re.I)
    try:
        raw = base64.b64decode(payload, validate=True)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid base64 image data") from exc
    if not raw or len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image must be between 1 byte and 8 MB")
    return raw


def build_prompt(request: AnalyzeRequest) -> str:
    action_guides = {
        "copy": "Recover the requested text precisely, preserving layout. Return only copy-ready content.",
        "explain": "Explain the selected content clearly, grounding every claim in visible evidence.",
        "search": "Identify the selected subject and produce specific search queries, likely official sources, and verification cues.",
        "translate": "Translate the selected content while preserving headings, lists, tables, and tone.",
        "summarize": "Summarize the selected content with key facts, decisions, and open questions.",
        "extract": "Extract the requested information into valid, concise JSON or a Markdown table when more appropriate.",
        "compare": "Compare the numbered selected regions explicitly, listing similarities, differences, and a conclusion.",
        "ask": "Answer the instruction using only the supplied visual and source context. State uncertainty when needed.",
    }
    regions = [region.model_dump() for region in request.regions]
    annotations = [annotation.model_dump() for annotation in request.annotations]
    context = {
        "source": request.source.model_dump(),
        "regions_normalized_to_image": regions,
        "annotations": annotations,
    }
    return (
        "You are the Spatial AI Context Layer. Analyze the screenshot and prioritize only the user-marked regions. "
        "Redacted areas are intentionally unavailable and must never be inferred. "
        f"Task mode: {request.action}. {action_guides[request.action]}\n\n"
        f"User instruction: {request.instruction}\n\n"
        f"Structured context bundle:\n{json.dumps(context, ensure_ascii=False)}"
    )

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
        ]
    }

@api_router.post("/captures/analyze")
async def analyze_capture(request: AnalyzeRequest):
    parse_image_data(request.image_data)
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="AI service is not configured")

    provider, model_name = SUPPORTED_MODELS[request.model]
    session_id = str(uuid.uuid4())
    image_payload = re.sub(r"^data:image\/(png|jpeg|jpg|webp);base64,", "", request.image_data, flags=re.I)

    async def event_stream():
        collected = []
        try:
            chat = LlmChat(
                api_key=api_key,
                session_id=session_id,
                system_message="You are a precise multimodal assistant for visual screen context. Never reveal hidden or redacted content.",
            ).with_model(provider, model_name)
            message = UserMessage(
                text=build_prompt(request),
                file_contents=[ImageContent(image_base64=image_payload)],
            )
            async for event in chat.stream_message(message):
                if isinstance(event, TextDelta):
                    collected.append(event.content)
                    yield f"data: {json.dumps({'type': 'delta', 'content': event.content})}\n\n"
                elif isinstance(event, StreamDone):
                    break

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
                "source": request.source.model_dump(),
                "thumbnail": "" if request.private_mode else f"data:{request.mime_type};base64,{image_payload}",
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

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()