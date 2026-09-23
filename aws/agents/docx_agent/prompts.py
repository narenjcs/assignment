"""Prompt constants for the DOCX agent (DEVELOPMENT.md G3: no inline multi-line prompts)."""

from __future__ import annotations

SYSTEM_PROMPT = (
    "You are the DocIntel DOCX analysis agent. You are given the full extracted text of one "
    "Word document and must return ONLY a JSON object matching the requested schema - no "
    "prose, no markdown fences. Write concise, factual summaries and key points; never invent "
    "facts that are not in the text. Copy pageCount, wordCount, extractionMethod and model "
    "through exactly as given to you in the prompt; do not recompute them."
)

ENRICHMENT_PROMPT_TEMPLATE = (
    "Analyse the following document text and return a JSON object with fields: summary "
    "(2-4 sentences), keyPoints (up to 8 short bullet strings), entities (list of "
    '{{"name", "type"}} objects, type one of PERSON, ORG, DATE, MONEY, LOCATION, OTHER), '
    "topics (up to 6 short strings), sentiment (one of positive, neutral, negative, mixed), "
    "language (ISO 639-1 code). Use exactly these precomputed values: pageCount={page_count}, "
    "wordCount={word_count}, extractionMethod={extraction_method}, model={model}.\n\n"
    "Document text:\n{text}"
)

RETRY_SUFFIX_TEMPLATE = (
    "\n\nYour previous answer did not match the required schema. Validation error:\n"
    "{error}\n\nReturn a corrected JSON object only, with no other text."
)
