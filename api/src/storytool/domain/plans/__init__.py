"""Access tiers: which features and limits each account has (paywall foundation).

`catalogue` names every feature and limit that can be moved behind a tier; `service` works out an
account's effective access from its own tier, its groups' tiers and its overrides; `middleware`
enforces it on every request (browser and MCP alike); `controller` is the admin API and
`/api/me/access`. With no tiers configured every account has everything.
"""
