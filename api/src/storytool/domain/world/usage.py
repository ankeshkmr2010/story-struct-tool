"""Where locations are used. Pure, derived from the graph."""

from storytool.domain.graph import StoryGraph
from storytool.domain.world.schemas import LocationUsageOut


def location_usage(graph: StoryGraph) -> list[LocationUsageOut]:
    """Per location: which scenes, which chapters, who was there, and the story-time span.

    All derived -- a location stores nothing about its own use, so this cannot go stale.
    """
    present = graph.characters_in_scene()
    chapter_numbers = {chapter.id: chapter.number for chapter in graph.chapters}

    usage = []
    for location in sorted(graph.locations, key=lambda loc: (loc.sort_key, loc.name)):
        scenes = [scene for scene in graph.scenes if scene.location_id == location.id]
        times = [s.story_time_ordinal for s in scenes if s.story_time_ordinal is not None]
        characters: set = set()
        for scene in scenes:
            characters |= present.get(scene.id, set())

        usage.append(
            LocationUsageOut(
                location_id=location.id,
                name=location.name,
                scene_count=len(scenes),
                chapter_numbers=sorted(
                    {
                        chapter_numbers[s.chapter_id]
                        for s in scenes
                        if s.chapter_id in chapter_numbers
                    }
                ),
                character_ids=sorted(characters, key=str),
                first_story_time=min(times) if times else None,
                last_story_time=max(times) if times else None,
            )
        )
    return usage
