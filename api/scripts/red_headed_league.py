"""Build "The Red-Headed League" through the public API, then report what the tool catches.

A real story as a test of the product rather than of the code. Conan Doyle's 1891 story is
public domain, and it is a useful subject precisely because it is *not* a tidy three-act
novel: it is first-person, its protagonist has no arc, and it has no "All Is Lost". Those are
the places a structural tool should either say something useful or embarrass itself.

Run with the API on :8000.

    uv run python scripts/red_headed_league.py
"""

import asyncio
import os

import httpx

BASE = os.getenv("STORYTOOL_BASE_URL", "http://localhost:8000")


async def main() -> None:
    async with httpx.AsyncClient(base_url=BASE, timeout=120.0) as client:

        async def post(path: str, body: dict | None = None) -> dict:
            response = await client.post(path, json=body or {})
            response.raise_for_status()
            return response.json() if response.content else {}

        async def patch(path: str, body: dict) -> dict:
            response = await client.patch(path, json=body)
            response.raise_for_status()
            return response.json()

        async def get(path: str) -> dict | list:
            response = await client.get(path)
            response.raise_for_status()
            return response.json()

        # ---------------------------------------------------------- level 1
        story = await post(
            "/api/stories",
            {
                "title": "The Red-Headed League",
                "premise": (
                    "A pawnbroker's absurdly generous new job is a ruse to empty his shop so "
                    "thieves can tunnel from his cellar into the bank vault next door."
                ),
                "genre": "detective short fiction",
                "pov_style": "first",
                "structure_framework": "three_act",
                "authoring_mode": "plotter",
            },
        )
        sid = story["id"]
        s = f"/api/stories/{sid}"

        # ---------------------------------------------------------- level 2
        turning_points = [
            ("Wilson answers the League's advertisement", 20, False),
            ("The League is abruptly dissolved", 60, False),
            ("Holmes taps the pavement outside the shop", 72, True),
            ("Clay breaks through the vault floor", 90, True),
        ]
        events = {}
        for label, ordinal, on_page in turning_points:
            events[label] = await post(
                f"{s}/events",
                {
                    "label": label,
                    "sort_ordinal": ordinal,
                    "is_turning_point": True,
                    "is_on_page": on_page,
                },
            )

        # ---------------------------------------------------------- level 3
        cast = {
            "Sherlock Holmes": {
                "role": "protagonist",
                "want": "To find the pattern behind an absurd arrangement",
                "need": "Work enough to keep the boredom at bay",
                "arc_type": "flat",
            },
            "John Watson": {
                "role": "supporting",
                "want": "To follow Holmes's reasoning as it happens",
                "need": "To be useful rather than merely present",
                "arc_type": "flat",
            },
            "Jabez Wilson": {
                "role": "supporting",
                "want": "To keep the easy four pounds a week coming",
                "need": "To see that he was being used",
                "arc_type": "positive",
            },
            "John Clay": {
                "role": "antagonist",
                "want": "To reach the French gold through the cellar wall",
                "need": "To be taken for more than a common thief",
                "arc_type": "negative",
            },
            "Duncan Ross": {
                "role": "supporting",
                "want": "To keep Wilson in his chair for four hours a day",
                "need": "To get clear before the work is finished",
            },
            "Peter Jones": {
                "role": "supporting",
                "want": "To make an arrest that will be noticed",
                "need": "To admit Holmes was ahead of him",
            },
            "Mr Merryweather": {
                "role": "supporting",
                "want": "To keep thirty thousand napoleons in his vault",
                "need": "To stop treating the night as an inconvenience",
            },
        }
        characters = {}
        for name, fields in cast.items():
            characters[name] = await post(f"{s}/characters", {"name": name, **fields})

        # ------------------------------------------------- levels 4 and 5
        scaffold = await post(f"{s}/scaffold")
        acts = await get(f"{s}/acts")
        beats = {b["label"]: b for b in await get(f"{s}/beats")}

        shifts = {
            1: ("idle curiosity", "a case worth having"),
            2: ("a puzzle", "a certainty"),
            3: ("certainty", "quiet satisfaction"),
        }
        for act in acts:
            frm, to = shifts[act["number"]]
            await patch(
                f"{s}/acts/{act['id']}",
                {
                    "summary": {
                        1: "A ridiculous story arrives at Baker Street and turns out to matter.",
                        2: "Holmes reads the shop, the knees, and the pavement.",
                        3: "The trap closes in the dark of the bank vault.",
                    }[act["number"]],
                    "emotional_shift_from": frm,
                    "emotional_shift_to": to,
                },
            )

        # Acts turn on the events that end them.
        act_by_number = {a["number"]: a for a in acts}
        await patch(
            f"{s}/acts/{act_by_number[1]['id']}",
            {"closing_turning_point_id": events["The League is abruptly dissolved"]["id"]},
        )
        await patch(
            f"{s}/acts/{act_by_number[2]['id']}",
            {
                "closing_turning_point_id": events[
                    "Holmes taps the pavement outside the shop"
                ]["id"]
            },
        )
        await patch(
            f"{s}/acts/{act_by_number[3]['id']}",
            {"closing_turning_point_id": events["Clay breaks through the vault floor"]["id"]},
        )

        # ---------------------------------------------------------- level 6
        threads = {
            "The tunnel to the vault": await post(
                f"{s}/threads", {"type": "a_story", "title": "The tunnel to the vault"}
            ),
            "Wilson's easy money": await post(
                f"{s}/threads", {"type": "b_story", "title": "Wilson's easy money"}
            ),
        }

        # ------------------------------------------------------- locations
        places = {}
        for name, description in [
            ("221B Baker Street", "Holmes's sitting room, pipe smoke and newspapers."),
            ("Saxe-Coburg Square", "A shabby square of brick, with Wilson's pawnshop on one side."),
            ("Pope's Court", "A poky office off Fleet Street with a card on the door."),
            ("City and Suburban Bank", "A cellar under Saxe-Coburg Square, stacked with crates of gold."),
            ("St James's Hall", "A concert hall where Holmes sits through Sarasate."),
        ]:
            places[name] = await post(f"{s}/locations", {"name": name, "description": description})

        # ------------------------------------------------- levels 7 and 8
        chapter_plan = [
            (1, "A Client with Red Hair", 1),
            (2, "Saxe-Coburg Square", 2),
            (3, "In the Vault", 3),
        ]
        chapters = {}
        for number, title, act_number in chapter_plan:
            chapters[number] = await post(
                f"{s}/chapters",
                {
                    "number": number,
                    "title": title,
                    "act_id": act_by_number[act_number]["id"],
                    "pov_character_id": characters["John Watson"]["id"],
                    "summary": f"Chapter {number}.",
                    "sort_key": number * 100,
                },
            )

        scene_plan = [
            {
                "title": "Wilson's story",
                "chapter": 1,
                "sort_key": 100,
                "story_time_ordinal": 70,
                "location": "221B Baker Street",
                "goal": "Get the whole account out of Wilson without leading him",
                "conflict": "Wilson is proud, rambling, and offended by being laughed at",
                "outcome": "Holmes takes a case that sounds like nothing",
                "emotional_value_from": "idle curiosity",
                "emotional_value_to": "sharp interest",
                "beat": "Inciting Incident",
                "thread": "Wilson's easy money",
                "content": (
                    "Mr Jabez Wilson sat in the chair by the window, and the light fell on hair "
                    "the colour of flame. He had answered an advertisement, he said, and for "
                    "eight weeks he had been paid four pounds a week to copy out the "
                    "Encyclopaedia Britannica in a little office off Fleet Street. Holmes put "
                    "his fingertips together and asked him, very mildly, about his assistant."
                ),
            },
            {
                "title": "The advertisement",
                "chapter": 1,
                "sort_key": 200,
                "story_time_ordinal": 20,
                "is_flashback": True,
                "location": "Pope's Court",
                "goal": "Secure the post before the queue of red-headed men does",
                "conflict": "A crowd of every shade of red fills the stair",
                "outcome": "Duncan Ross tugs his hair, declares him genuine, and hires him",
                "emotional_value_from": "doubt",
                "emotional_value_to": "disbelieving luck",
                "beat": "Plot Point One",
                "thread": "Wilson's easy money",
                "content": (
                    "The stair was packed with red-headed men. Duncan Ross took Mr Wilson by "
                    "the hair with both hands and tugged until he cried out, and then "
                    "pronounced himself satisfied, and the rest of them were sent away down "
                    "into Pope's Court."
                ),
            },
            {
                "title": "Tapping the pavement",
                "chapter": 2,
                "sort_key": 100,
                "story_time_ordinal": 72,
                "location": "Saxe-Coburg Square",
                "goal": "Learn how far the cellar runs without alerting the assistant",
                "conflict": "The assistant must not suspect he has been looked at",
                "outcome": "Holmes knows which way the tunnel goes, and knows the knees",
                "emotional_value_from": "a puzzle",
                "emotional_value_to": "a certainty",
                "beat": "Midpoint",
                "thread": "The tunnel to the vault",
                "content": (
                    "Holmes walked up and down in front of the shop and struck the pavement "
                    "two or three times with his stick. Then he knocked at the door, and it "
                    "was opened by a bright-looking fellow with trousers worn at the knee. "
                    "Vincent Spaulding told him the way to the Strand and shut the door."
                ),
            },
            {
                "title": "Sarasate at St James's Hall",
                "chapter": 2,
                "sort_key": 200,
                "story_time_ordinal": 74,
                "location": "St James's Hall",
                "goal": "Let the afternoon pass before the night's work",
                "conflict": "Watson cannot see how music helps a bank robbery",
                "outcome": "Watson understands that Holmes is already certain",
                "emotional_value_from": "impatience",
                "emotional_value_to": "trust",
                "beat": "Plot Point Two",
                "thread": "The tunnel to the vault",
                "content": (
                    "Holmes sat in the stalls with his long thin fingers waving in time to the "
                    "music, and his gentle smiling face was as unlike that of the hunter as it "
                    "could be. Sarasate played, and nothing whatever was said about Saxe-Coburg "
                    "Square."
                ),
            },
            {
                "title": "Waiting in the dark",
                "chapter": 3,
                "sort_key": 100,
                "story_time_ordinal": 88,
                "location": "City and Suburban Bank",
                "goal": "Take the thieves in the act, in the cellar, with the gold in reach",
                "conflict": "The dark, the cold, and Merryweather's impatience",
                "outcome": "A scraping begins under the floor",
                "emotional_value_from": "nerves",
                "emotional_value_to": "readiness",
                "beat": "Climax",
                "thread": "The tunnel to the vault",
                "content": (
                    "Mr Merryweather sat on a crate and was told, rather sharply, not to strike "
                    "a light. Peter Jones breathed heavily in the dark beside him. Then a line "
                    "of light showed in the flagstones of the cellar floor, and a hand came "
                    "through, and the hand was white and womanly."
                ),
            },
            {
                "title": "John Clay",
                "chapter": 3,
                "sort_key": 200,
                "story_time_ordinal": 90,
                "location": "City and Suburban Bank",
                "goal": "Take Clay alive and hold him",
                "conflict": "His accomplice is already away up the tunnel",
                "outcome": "Clay is taken; the napoleons are untouched",
                "emotional_value_from": "readiness",
                "emotional_value_to": "quiet satisfaction",
                "beat": "Resolution",
                "thread": "The tunnel to the vault",
                "content": (
                    "John Clay stood very still with the revolver at his head and asked that "
                    "they would not touch him with their filthy hands. Peter Jones put the "
                    "handcuffs on him anyway. Mr Merryweather counted his crates and found "
                    "every one of the thirty thousand napoleons where it should be."
                ),
            },
        ]

        scenes = {}
        for plan in scene_plan:
            scene = await post(
                f"{s}/scenes",
                {
                    "title": plan["title"],
                    "chapter_id": chapters[plan["chapter"]]["id"],
                    "sort_key": plan["sort_key"],
                    "story_time_ordinal": plan["story_time_ordinal"],
                    "is_flashback": plan.get("is_flashback", False),
                    "location_id": places[plan["location"]]["id"],
                    "pov_character_id": characters["John Watson"]["id"],
                    "goal": plan["goal"],
                    "conflict": plan["conflict"],
                    "outcome": plan["outcome"],
                    "emotional_value_from": plan["emotional_value_from"],
                    "emotional_value_to": plan["emotional_value_to"],
                    "status": "drafted",
                },
            )
            scenes[plan["title"]] = scene
            await client.put(
                f"{s}/scenes/{scene['id']}/content", json={"content": plan["content"]}
            )
            await post(f"{s}/scenes/{scene['id']}/beats", {"beat_id": beats[plan["beat"]]["id"]})
            await post(
                f"{s}/scenes/{scene['id']}/threads",
                {"thread_id": threads[plan["thread"]]["id"], "is_primary": True},
            )

        # The two on-page turning points get the scenes that depict them.
        await patch(
            f"{s}/events/{events['Holmes taps the pavement outside the shop']['id']}",
            {"scene_id": scenes["Tapping the pavement"]["id"]},
        )
        await patch(
            f"{s}/events/{events['Clay breaks through the vault floor']['id']}",
            {"scene_id": scenes["John Clay"]["id"]},
        )

        # Wilson is the only character who changes; Holmes and Watson are flat by design.
        wilson_arc = await post(
            f"{s}/arcs",
            {
                "character_id": characters["Jabez Wilson"]["id"],
                "resolution": "He gets his pawnshop back and rather less of his dignity.",
            },
        )
        stage_trusting = await post(
            f"/api/arcs/{wilson_arc['id']}/stages", {"label": "trusting", "sort_key": 1}
        )
        await post(
            f"/api/arcs/{wilson_arc['id']}/stages", {"label": "chastened", "sort_key": 2}
        )
        wilson_scene = scenes["Wilson's story"]
        await post(
            f"{s}/scenes/{wilson_scene['id']}/arc-stages",
            {"arc_stage_id": stage_trusting["id"]},
        )

        # ------------------------------------------------------- the report
        await post(f"{s}/notice")

        ladder = await get(f"{s}/ladder")
        health = await get(f"{s}/health")
        continuity = await get(f"{s}/continuity")
        suggestions = await get(f"{s}/suggestions")
        progress = await get(f"{s}/progress")
        noticer = await get("/api/noticing")

        line = "=" * 78
        print(line)
        print(f'THE RED-HEADED LEAGUE   {BASE.replace("8000", "5173")}/stories/{sid}')
        print(line)
        print(
            f"scaffolded: {scaffold['acts_created']} acts, {scaffold['beats_created']} beats  |  "
            f"{progress['word_count']} words across {progress['scene_count']} scenes  |  "
            f"noticer: {noticer['noticer']}"
        )
        print(f"\nLADDER  furthest ready level: {ladder['furthest_ready_level']}/8")
        for rung in ladder["levels"]:
            mark = "ok " if rung["is_ready"] else "-- "
            blocked = f"   ({'; '.join(rung['blocked_by'])})" if rung["blocked_by"] else ""
            print(f"  {mark}{rung['level']} {rung['label']}{blocked}")

        print(f"\nHEALTH  {health['warning_count']} warnings, {health['info_count']} notes")
        for finding in health["findings"]:
            print(f"  [{finding['severity']:7}] L{finding['level']} {finding['code']}")
            print(f"            {finding['message']}")

        print(
            f"\nCONTINUITY  {continuity['contradiction_count']} contradictions, "
            f"{continuity['possible_count']} to check"
        )
        for anomaly in continuity["anomalies"]:
            print(f"  [{anomaly['kind']}] {anomaly['code']}")
            print(f"            {anomaly['message']}")
        if not continuity["anomalies"]:
            print("  (nothing contradicts itself)")

        print(f"\nNOTICED  {len(suggestions)} observations")
        for suggestion in suggestions:
            print(f"  {suggestion['code']}")
            print(f"            {suggestion['message']}")

        print(f"\n{line}")


if __name__ == "__main__":
    asyncio.run(main())
