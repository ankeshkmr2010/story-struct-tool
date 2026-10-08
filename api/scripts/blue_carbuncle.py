"""Seed the configured owner's Blue Carbuncle example without replacing stories."""

import asyncio

from storytool.examples.blue_carbuncle import main

if __name__ == "__main__":
    asyncio.run(main())
