"""Typed outline/prose checks; only assigned context accompanies each scene."""

import asyncio

from storytool.config import get_settings
from storytool.domain.decisions.service import DecisionService, DecisionUnavailable
from storytool.domain.decisions.types import Noul


async def read_outline_matches(service: DecisionService | None, model: str, state: dict) -> dict:
    characters = {str(row["id"]): row["name"] for row in state["character"]}
    locations = {str(row["id"]): row["name"] for row in state["location"]}
    beats = {str(row["id"]): row for row in state["beat"]}
    present, assigned = {}, {}
    for row in state["scene_presence"]:
        if not row.get("is_rejected"):
            present.setdefault(str(row["scene_id"]), []).append(
                characters.get(str(row["character_id"]), "")
            )
    for row in state.get("scene_beat", []):
        assigned.setdefault(str(row["scene_id"]), []).append(str(row["beat_id"]))
    gate = asyncio.Semaphore(8)
    threshold = get_settings().decision_evaluation_confidence

    async def assess(scene):
        identifier = str(scene["id"])
        if service is None:
            return identifier, {"status": "unavailable", "stale_beats": []}
        selected = [beats[key] for key in assigned.get(identifier, []) if key in beats]
        context = {
            "prose": scene["content"],
            "summary": scene.get("summary"),
            "cast": present.get(identifier, []),
            "location": locations.get(str(scene.get("location_id"))) or scene.get("location"),
            "pov": characters.get(str(scene.get("pov_character_id"))),
            "beats": [
                {
                    "id": str(beat["id"]),
                    "label": beat["label"],
                    "description": beat.get("description"),
                }
                for beat in selected
            ],
        }
        questions = {
            "match": Noul(
                instructions=(
                    "Does the assigned outline still match this scene's prose? Assess "
                    "supplied summary, cast, place and POV. Ignore missing fields "
                    "and minor differences; "
                    "do not require exact wording. If no meaningful outline is supplied, answer "
                    "uncertain rather than treating it as a match."
                )
            )
        }
        for beat in selected:
            if beat.get("description"):
                questions[f"beat_{beat['id']}"] = Noul(
                    instructions=(
                        f"Does the prose still fulfil assigned beat {beat['id']}? "
                        "Use its description, not merely its label. Intentional changes are "
                        "still an outline mismatch, not a prose defect."
                    )
                )
        async with gate:
            try:
                reading = await service.evaluate(model=model, state=context, questions=questions)
            except DecisionUnavailable:
                return identifier, {"status": "unavailable", "stale_beats": []}
        probability = reading.answers["match"].noul
        stale = [
            str(beat["id"])
            for beat in selected
            if f"beat_{beat['id']}" in reading.answers
            and reading.answers[f"beat_{beat['id']}"].noul <= 1 - threshold
        ]
        status = (
            "match"
            if probability >= threshold
            else "mismatch"
            if probability <= 1 - threshold
            else "uncertain"
        )
        if stale:
            status = "mismatch"
        return identifier, {
            "status": status,
            "probability": probability,
            "stale_beats": stale,
            "stale_beat_labels": [beat["label"] for beat in selected if str(beat["id"]) in stale],
        }

    return dict(
        await asyncio.gather(
            *(assess(scene) for scene in state["scene"] if (scene.get("content") or "").strip())
        )
    )
