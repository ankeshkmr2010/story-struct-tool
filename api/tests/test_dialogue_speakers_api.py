"""Stored dialogue speakers through MCP: empty by default, filled by the code pass without
guessing, set and cleared by an agent with stale lines refused, and read by Dialogue voice."""

from tests.test_mcp import connect, tool

STORIES = "/api/stories"


async def test_dialogue_speakers_populate_attribute_and_feed_the_voice_check(client) -> None:
    sid, _, headers = await connect(client)
    base = f"{STORIES}/{sid}"
    ids = {}
    for name in ("Tian", "Grandfather"):
        ids[name] = (await client.post(f"{base}/characters", json={"name": name})).json()["id"]
    chapter = (await client.post(f"{base}/chapters", json={"title": "One"})).json()
    scene = (
        await client.post(f"{base}/scenes", json={"title": "Tree", "chapter_id": chapter["id"]})
    ).json()
    prose = "\n\n".join(
        [
            "“No, Grandfather,” said Tian. “No tunes.”",
            "“That is a pity. I am fond of the flute.” He put his hand on Tian's head.",
        ]
    )
    await client.put(f"{base}/scenes/{scene['id']}/content", json={"content": prose})

    listed = await tool(client, headers, "list_dialogue")
    assert listed["total"] == 3 and listed["attributed"] == 0
    assert all(line["speaker_id"] is None for line in listed["lines"])

    counts = await tool(client, headers, "populate_dialogue_speakers")
    assert (counts["by_code"], counts["by_reader"], counts["empty"]) == (2, 0, 1)
    empty = (await tool(client, headers, "list_dialogue", {"only_empty": True}))["lines"]
    assert [line["text"] for line in empty] == ["That is a pity. I am fond of the flute."]

    flute = empty[0]
    result = await tool(
        client,
        headers,
        "attribute_dialogue",
        {
            "lines": [
                {**{k: flute[k] for k in ("line_id", "text")}, "character_id": ids["Grandfather"]},
                {"line_id": flute["line_id"], "text": "Something else", "character_id": None},
            ]
        },
    )
    assert (result["updated"], result["cleared"], result["stale"]) == (1, 0, [flute["line_id"]])
    lines = (await tool(client, headers, "list_dialogue"))["lines"]
    assert [(line["speaker"], line["source"]) for line in lines] == [
        ("Tian", "code"),
        ("Tian", "code"),
        ("Grandfather", "agent"),
    ]
    # A second pass keeps what is set.
    again = await tool(client, headers, "populate_dialogue_speakers")
    assert (again["by_code"], again["empty"]) == (0, 0)

    check = (await client.get(f"{base}/evaluations/dialogue_voice")).json()
    assert check["visual"]["attributed"] == 3

    cleared = await tool(
        client,
        headers,
        "attribute_dialogue",
        {"lines": [{**{k: flute[k] for k in ("line_id", "text")}, "character_id": None}]},
    )
    assert cleared["cleared"] == 1
