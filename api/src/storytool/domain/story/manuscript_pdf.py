"""Submission manuscript PDF with optional, compact reference appendices."""

import io
from html import escape

from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer

from storytool.domain.story.manuscript_formats import Block, blocks, inline_html


def manuscript_pdf(
    markdown: str, title: str, author_name: str | None, word_count: int,
    appendices: list[tuple[str, list[Block]]],
) -> bytes:
    # The standard Times faces use WinAnsi. Refuse unsupported text rather than
    # silently replacing manuscript characters with boxes or question marks.
    texts = [markdown, title, author_name or ""]
    texts.extend(block.text for _, section in appendices for block in section)
    try:
        "".join(texts).encode("cp1252")
    except UnicodeEncodeError:
        raise ValueError(
            "Submission PDF currently supports Latin-script text. This manuscript contains "
            "unsupported characters; Word and EPUB preserve them."
        ) from None

    body = ParagraphStyle(
        "Body", fontName="Times-Roman", fontSize=12, leading=24,
        firstLineIndent=36, spaceAfter=0, allowWidows=0, allowOrphans=0,
    )
    chapter = ParagraphStyle(
        "Chapter", parent=body, fontName="Times-Bold", alignment=TA_CENTER,
        firstLineIndent=0, spaceBefore=48, spaceAfter=24, keepWithNext=True,
    )
    title_style = ParagraphStyle("Title", parent=chapter, fontSize=20, leading=28)
    centered = ParagraphStyle("Centered", parent=body, firstLineIndent=0, alignment=TA_CENTER)
    quote = ParagraphStyle("Quote", parent=body, fontName="Times-Italic", firstLineIndent=0, leftIndent=36)
    reference = ParagraphStyle(
        "Reference", parent=body, firstLineIndent=0, leading=16, spaceAfter=10,
        alignment=TA_LEFT,
    )
    reference_heading = ParagraphStyle(
        "ReferenceHeading", parent=reference, fontName="Times-Bold",
        spaceBefore=12, spaceAfter=4, keepWithNext=True,
    )
    flow = [Spacer(1, 144), Paragraph(escape(title), title_style)]
    if author_name:
        flow.append(Paragraph(f"By {escape(author_name)}", centered))
    flow.extend([Spacer(1, 24), Paragraph(f"{word_count:,} words", centered), PageBreak()])
    manuscript_blocks = blocks(markdown)
    # The title/byline already have their own page.
    if manuscript_blocks and manuscript_blocks[0].kind == "heading":
        manuscript_blocks = manuscript_blocks[1:]
    if author_name and manuscript_blocks and manuscript_blocks[0].text == f"*By {author_name}*":
        manuscript_blocks = manuscript_blocks[1:]
    seen_chapter = False
    for block in manuscript_blocks:
        if block.kind == "heading":
            if block.level == 2:
                if seen_chapter:
                    flow.append(PageBreak())
                seen_chapter = True
            style = chapter
        elif block.kind == "break":
            flow.append(Paragraph("#", centered))
            continue
        else:
            style = quote if block.kind == "quote" else body
        flow.append(Paragraph(inline_html(block.text), style))
    for index, (label, section) in enumerate(appendices):
        flow.append(PageBreak())
        flow.append(Paragraph(f"Appendix {chr(65 + index)}: {escape(label)}", chapter))
        for block in section:
            style = reference_heading if block.kind == "heading" else reference
            flow.append(Paragraph(inline_html(block.text), style))

    short_title = title if len(title) <= 50 else title[:47] + "..."
    header = " / ".join(part for part in (author_name, short_title) if part)
    if stringWidth(header, "Times-Roman", 10) > 420:
        while stringWidth(header + "...", "Times-Roman", 10) > 420:
            header = header[:-1]
        header += "..."

    def page_header(canvas: Canvas, document: SimpleDocTemplate) -> None:
        if document.page == 1:
            return
        canvas.saveState()
        canvas.setFont("Times-Roman", 10)
        canvas.drawRightString(letter[0] - 72, letter[1] - 40, f"{header} / {document.page - 1}")
        canvas.restoreState()

    buffer = io.BytesIO()
    document = SimpleDocTemplate(
        buffer, pagesize=letter, leftMargin=72, rightMargin=72,
        topMargin=72, bottomMargin=72, title=title, author=author_name or "",
    )
    document.build(flow, onFirstPage=page_header, onLaterPages=page_header)
    return buffer.getvalue()
