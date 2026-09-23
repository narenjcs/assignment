"""Generate the two 2-page sample documents used in the demo.

uv run --with python-docx --with reportlab python samples/make_samples.py
"""

from __future__ import annotations

from pathlib import Path

from docx import Document
from docx.enum.text import WD_BREAK
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer

HERE = Path(__file__).parent
Block = tuple[str, str]  # (text, kind) where kind is title | h | body

CONTRACT_P1: list[Block] = [
    ("Master Services Agreement", "title"),
    (
        'This Master Services Agreement (the "Agreement") is entered into on 1 September 2026 '
        "between Technium Labs Pty Ltd (ABN 41 197 860 613), of Sydney, New South Wales "
        '("Provider"), and Harbourline Logistics Ltd, of Auckland, New Zealand ("Customer").',
        "body",
    ),
    ("1. Services", "h"),
    (
        "Provider will deliver cloud data-platform engineering services, including migration of "
        "Customer's freight-tracking warehouse to Databricks on AWS, implementation of Unity "
        "Catalog governance, and an agentic document-processing pipeline built on Amazon Bedrock "
        "AgentCore.",
        "body",
    ),
    ("2. Term and Fees", "h"),
    (
        "The initial term is twelve (12) months commencing 1 October 2026. Fees are AUD 48,000 "
        "per month, invoiced monthly in arrears, payable within 30 days. A 2% late fee applies to "
        "overdue amounts.",
        "body",
    ),
    ("3. Service Levels", "h"),
    (
        "Provider commits to 99.5% monthly availability of the production pipeline and a "
        "four-hour response time for Severity-1 incidents. Service credits of 5% of monthly fees "
        "apply per breached objective.",
        "body",
    ),
]
CONTRACT_P2: list[Block] = [
    ("4. Data Protection", "h"),
    (
        "Customer data remains in the ap-southeast-2 region. Provider will encrypt data at rest "
        "and in transit, and will not use Customer data to train foundation models. Both parties "
        "comply with the Australian Privacy Act 1988 and the NZ Privacy Act 2020.",
        "body",
    ),
    ("5. Intellectual Property", "h"),
    (
        "Pre-existing IP remains with its owner. Deliverables created specifically for Customer "
        "are assigned to Customer on payment. Provider retains rights to generic tooling, "
        "including its MCP tool library.",
        "body",
    ),
    ("6. Termination", "h"),
    (
        "Either party may terminate for convenience on ninety (90) days' written notice, or "
        "immediately for material breach not cured within 30 days. Sections 4, 5 and 7 survive "
        "termination.",
        "body",
    ),
    ("7. Governing Law", "h"),
    (
        "This Agreement is governed by the laws of New South Wales, Australia. Signed by Priya "
        "Raman (Chief Executive, Technium Labs) and Tom Whitford (Chief Operating Officer, "
        "Harbourline Logistics).",
        "body",
    ),
]

REPORT_P1: list[Block] = [
    ("Quarterly Operations Report - Q3 2026", "title"),
    (
        "Prepared by the Harbourline Logistics analytics team for the executive committee, "
        "15 September 2026.",
        "body",
    ),
    ("Executive Summary", "h"),
    (
        "Freight volume grew 11.4% quarter-on-quarter to 182,000 TEU, driven by strong "
        "trans-Tasman demand. On-time delivery improved to 94.1% (from 91.8%), while fuel costs "
        "rose 7% following the August surcharge increase. Net operating margin held at 12.6%.",
        "body",
    ),
    ("Key Risks", "h"),
    (
        "Port congestion in Tauranga added an average of 1.6 days of dwell time. Two customers "
        "representing 9% of revenue are renegotiating contracts. Cyber-insurance premiums "
        "increased 18% at renewal.",
        "body",
    ),
]
REPORT_P2: list[Block] = [
    ("Technology Initiatives", "h"),
    (
        "The document-intelligence pilot processed 3,200 bills of lading using an AWS and "
        "Databricks agentic pipeline; OCR accuracy on scanned PDFs reached 97.2% using "
        "ai_parse_document, and summaries were available to operations staff within 40 seconds "
        "on average.",
        "body",
    ),
    ("Outlook for Q4", "h"),
    (
        "Management expects volume growth of 6-8%, a new Melbourne cross-dock opening in "
        "November, and the rollout of real-time container tracking to all enterprise customers "
        "by December 2026.",
        "body",
    ),
    ("Recommendations", "h"),
    (
        "1) Approve the AUD 1.2M capital request for cross-dock automation. 2) Extend the "
        "document-intelligence pilot to customs declarations. 3) Hedge 50% of Q4 fuel exposure.",
        "body",
    ),
]


def make_docx(path: Path) -> None:
    """Write the two-page contract as DOCX."""
    doc = Document()
    for i, page in enumerate((CONTRACT_P1, CONTRACT_P2)):
        for text, kind in page:
            if kind == "title":
                doc.add_heading(text, level=0)
            elif kind == "h":
                doc.add_heading(text, level=2)
            else:
                doc.add_paragraph(text)
        if i == 0:
            doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
    doc.save(path)


def make_pdf(path: Path) -> None:
    """Write the two-page operations report as PDF."""
    styles = getSampleStyleSheet()
    style_for = {"title": styles["Title"], "h": styles["Heading2"]}
    story: list[Paragraph | Spacer | PageBreak] = []
    for i, page in enumerate((REPORT_P1, REPORT_P2)):
        for text, kind in page:
            story.append(Paragraph(text, style_for.get(kind, styles["BodyText"])))
            story.append(Spacer(1, 10))
        if i == 0:
            story.append(PageBreak())
    SimpleDocTemplate(str(path), pagesize=A4, title="Quarterly Operations Report").build(story)


if __name__ == "__main__":
    make_docx(HERE / "sample-contract.docx")
    make_pdf(HERE / "sample-report.pdf")
    print("wrote", HERE / "sample-contract.docx", "and", HERE / "sample-report.pdf")
