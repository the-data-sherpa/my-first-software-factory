---
status: accepted
accepted: 2026-11-06
---

# Use capped Anthropic OAuth for Phase 1

The owner requires existing Pi OAuth and declines API keys. The pinned Pi 1.5.0 OpenAI sign-in transport omits the requested output cap; its Anthropic OAuth transport preserves it. Firstmate selected the fixed `anthropic/claude-sonnet-5-5` route with explicit low adaptive effort, superseding the initial Q23 OpenAI route. There is no model router or fallback to Opus, OpenAI, API keys or another provider.

Keep the original 1,024-token smoke and 8,192-token normal requested output caps, including thinking, and all attempt/tool/time/containment limits. Pi owns credential resolution; no custom loader, credential replacement or cap relaxation is introduced. Source/profile changes invalidate older execution evidence. Controlled SDK packets establish compatibility of the local transport, not live authorization, server cap acceptance, billing, owner readiness or the real Phase 1 result; those still require the coordinated live run.
