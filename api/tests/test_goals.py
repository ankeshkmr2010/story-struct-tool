"""Writing goals: daily habit, story goals with pace, sprints, and what counts as writing."""

from datetime import date, timedelta

from tests.test_library import _story_with_scene


async def _type(client, story_id, scene_id, text, headers=None):
    url = f"/api/stories/{story_id}/scenes/{scene_id}/content"
    return await client.put(url, json={"content": text}, headers=headers or {})


async def test_daily_goal_counts_typed_words_not_agent_words(client):
    story_id, scene_id = await _story_with_scene(client, "Habit")
    assert (await client.get("/api/goals")).json()["has_goal"] is False
    saved = await client.put("/api/goals", json={"daily_words": 5, "timezone": "Europe/Paris"})
    assert saved.status_code == 200 and saved.json()["timezone"] == "Europe/Paris"
    assert (await client.put("/api/goals", json={"timezone": "Mars/Base"})).status_code == 400

    await _type(client, story_id, scene_id, "one two three four five six")
    goals = (await client.get("/api/goals")).json()
    assert goals["today_words"] >= 6 and goals["streak"] == 1 and goals["week"][-1]["met"]
    assert goals["week_sessions"] == 1

    token = (await client.post("/api/ai/agent-tokens", json={"story_id": story_id})).json()
    headers = {"Authorization": "Bearer " + token["token"]}
    await _type(client, story_id, scene_id, "agent " * 80, headers)
    assert (await client.get("/api/goals")).json()["today_words"] == goals["today_words"]
    # Opting in counts the agent's words too; deleting never subtracts.
    await client.put(
        "/api/goals", json={"daily_words": 5, "timezone": "Europe/Paris", "count_ai": True}
    )
    assert (await client.get("/api/goals")).json()["today_words"] > goals["today_words"]
    # Agents can read the story goal envelope but never reach the account's goals.
    assert (await client.get("/api/goals", headers=headers)).status_code in {401, 403}
    assert (await client.get(f"/api/stories/{story_id}/goal", headers=headers)).status_code == 200


async def test_paste_is_capped(client):
    story_id, scene_id = await _story_with_scene(client, "Paste")
    await _type(client, story_id, scene_id, "word " * 3000)
    assert (await client.get("/api/goals")).json()["today_words"] <= 1000


async def test_story_goal_pace_and_status(client):
    story_id, scene_id = await _story_with_scene(client, "Book")
    url = f"/api/stories/{story_id}/goal"
    assert (await client.get(url)).json()["goal"] is None
    deadline = (date.today() + timedelta(days=9)).isoformat()
    goal = (await client.put(url, json={"target_words": 1000, "deadline": deadline})).json()["goal"]
    assert goal["status"] == "on_track" and goal["needed_today"] > 0 and goal["days_left"] >= 9
    await _type(client, story_id, scene_id, "word " * 40)
    after = (await client.get(url)).json()["goal"]
    assert after["today_words"] > 0 and after["words_now"] >= 40
    done = (await client.put(url, json={"target_words": 10})).json()["goal"]
    assert done["status"] == "done" and done["percent"] == 100 and done["needed_today"] is None
    cards = (await client.get("/api/library/overview")).json()["cards"]
    card = next(card for card in cards if card["story_id"] == story_id)
    assert card["goal_status"] == "done" and card["goal_percent"] == 100
    assert (await client.delete(url)).status_code == 204
    assert (await client.get(url)).json()["goal"] is None


async def test_sprint_collects_typed_words(client):
    story_id, scene_id = await _story_with_scene(client, "Sprint")
    sprint = (
        await client.post(
            "/api/goals/sprints", json={"story_id": story_id, "minutes": 25, "target_words": 50}
        )
    ).json()
    assert (await client.get("/api/goals")).json()["active_sprint"]["id"] == sprint["id"]
    await _type(client, story_id, scene_id, "word " * 12)
    ended = (await client.post(f"/api/goals/sprints/{sprint['id']}/end")).json()
    assert ended["words"] == 12 and ended["ended_at"]
    goals = (await client.get("/api/goals")).json()
    assert goals["active_sprint"] is None and goals["week_sprints"] == 1
    assert goals["last_sprint"]["words"] == 12


async def test_connected_ai_reads_goals_but_cannot_set_them(client):
    from tests.test_mcp import connect, tool

    sid, _token, headers = await connect(client)
    await client.put(f"/api/stories/{sid}/goal", json={"target_words": 500})
    result = await tool(client, headers, "get_writing_goals")
    assert result["goal"]["target_words"] == 500 and "habit" in result
    blocked = await client.put(
        f"/api/stories/{sid}/goal", json={"target_words": 9}, headers=headers
    )
    assert blocked.status_code in {401, 403}
